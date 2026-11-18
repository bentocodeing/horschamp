//! Job lifecycle: quote (upload + estimate) → confirm → submit → poll with backoff → download.
//! Jobs persist in SQLite so polling resumes after a restart.

use crate::db::{new_id, now, Asset, Attachment, Db, Job};
use crate::error::{AppError, AppResult};
use crate::hf::{HfClient, RemoteStatus};
use crate::registry::{self, Registry};
use crate::secrets::{SecretStore, HIGGSFIELD};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tokio::io::AsyncWriteExt;

pub trait Events: Send + Sync {
    fn job(&self, job: &Job);
}

#[derive(Debug, Clone, Deserialize)]
pub struct JobRequest {
    pub model_id: String,
    /// User params without uploaded media URLs.
    pub params: Map<String, Value>,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub brief_id: Option<String>,
    #[serde(default)]
    pub shot_index: Option<i64>,
    #[serde(default)]
    pub retry_of: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Quote {
    pub est_usd: Option<f64>,
    pub estimate_error: Option<String>,
    pub needs_confirm: bool,
    pub threshold_usd: f64,
    pub issues: Vec<registry::Issue>,
}

#[derive(Clone)]
pub struct PollConfig {
    pub initial: Duration,
    pub factor: f64,
    pub max: Duration,
    pub max_submit_attempts: u32,
}

impl Default for PollConfig {
    fn default() -> Self {
        Self {
            initial: Duration::from_secs(2),
            factor: 1.5,
            max: Duration::from_secs(10),
            max_submit_attempts: 30,
        }
    }
}

pub struct JobManager {
    pub db: Arc<Db>,
    pub secrets: Arc<dyn SecretStore>,
    pub registry: Arc<RwLock<Registry>>,
    pub events: Arc<dyn Events>,
    pub base_url: String,
    pub poll: PollConfig,
    library_dir: RwLock<PathBuf>,
    runners: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
    estimates: Mutex<HashMap<String, (f64, Instant)>>,
}

pub const SETTING_THRESHOLD: &str = "confirm_over_usd";
const UPLOAD_TTL_SECS: i64 = 50 * 60; // presigned/public URLs: treat as fresh for 50 of the documented 60 minutes

pub fn content_type_for(path: &Path) -> AppResult<String> {
    let ct = mime_guess::from_path(path)
        .first_raw()
        .unwrap_or("application/octet-stream");
    let ok = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "audio/wav",
        "audio/x-wav",
        "video/mp4",
    ];
    let ct = if ct == "audio/vnd.wave" {
        "audio/wav"
    } else {
        ct
    };
    if !ok.contains(&ct) {
        return Err(AppError::Validation(format!(
            "{} is {ct}; Higgsfield accepts JPEG, PNG, WebP, GIF, WAV and MP4",
            path.file_name().and_then(|s| s.to_str()).unwrap_or("file")
        )));
    }
    Ok(ct.to_string())
}

/// Put attachment URLs into the params map. Array params get appended, string params set.
pub fn merge_attachments(
    model: &registry::Model,
    params: &Map<String, Value>,
    atts: &[Attachment],
) -> AppResult<Map<String, Value>> {
    let mut body = registry::clean_body(params);
    for a in atts {
        let url = a
            .public_url
            .clone()
            .ok_or_else(|| AppError::Other("attachment not uploaded".into()))?;
        let input = model
            .inputs
            .iter()
            .find(|i| i.name == a.param)
            .ok_or_else(|| {
                AppError::Validation(format!("{} has no input '{}'", model.id, a.param))
            })?;
        if input.kind.starts_with("array") {
            let entry = body
                .entry(a.param.clone())
                .or_insert_with(|| Value::Array(vec![]));
            if !entry.is_array() {
                *entry = Value::Array(vec![]);
            }
            entry.as_array_mut().unwrap().push(Value::String(url));
        } else {
            body.insert(a.param.clone(), Value::String(url));
        }
    }
    Ok(body)
}

impl JobManager {
    pub fn new(
        db: Arc<Db>,
        secrets: Arc<dyn SecretStore>,
        registry: Arc<RwLock<Registry>>,
        events: Arc<dyn Events>,
        library_dir: PathBuf,
        base_url: String,
        poll: PollConfig,
    ) -> Arc<Self> {
        Arc::new(Self {
            db,
            secrets,
            registry,
            events,
            base_url,
            poll,
            library_dir: RwLock::new(library_dir),
            runners: Mutex::new(HashMap::new()),
            estimates: Mutex::new(HashMap::new()),
        })
    }

    pub fn library_dir(&self) -> PathBuf {
        self.library_dir.read().unwrap().clone()
    }
    pub fn set_library_dir(&self, p: PathBuf) {
        *self.library_dir.write().unwrap() = p;
    }

    pub fn client(&self) -> AppResult<HfClient> {
        let key = self.secrets.get(HIGGSFIELD)?.ok_or(AppError::NoKey)?;
        Ok(HfClient::with_base(key, self.base_url.clone()))
    }

    pub fn threshold(&self) -> f64 {
        self.db
            .setting(SETTING_THRESHOLD)
            .ok()
            .flatten()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0)
    }

    fn model(&self, id: &str) -> AppResult<registry::Model> {
        self.registry
            .read()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("model {id}")))
    }

    /// Upload any attachments that are not cached yet. Returns attachments with public URLs.
    pub async fn upload_attachments(
        &self,
        client: &HfClient,
        atts: &[Attachment],
    ) -> AppResult<Vec<Attachment>> {
        let mut out = Vec::with_capacity(atts.len());
        for a in atts {
            let path = PathBuf::from(&a.path);
            let bytes = tokio::fs::read(&path)
                .await
                .map_err(|e| AppError::Io(format!("{}: {e}", a.path)))?;
            let sha = hex::encode(Sha256::digest(&bytes));
            let url = match self.db.cached_upload(&sha, UPLOAD_TTL_SECS)? {
                Some(u) => u,
                None => {
                    let ct = content_type_for(&path)?;
                    let u = client.upload(bytes, &ct).await?;
                    self.db.put_upload(&sha, &u, &ct)?;
                    u
                }
            };
            out.push(Attachment {
                public_url: Some(url),
                ..a.clone()
            });
        }
        Ok(out)
    }

    async fn build_body(
        &self,
        client: &HfClient,
        req: &JobRequest,
    ) -> AppResult<(Map<String, Value>, Vec<Attachment>)> {
        let model = self.model(&req.model_id)?;
        let atts = self.upload_attachments(client, &req.attachments).await?;
        let body = merge_attachments(&model, &req.params, &atts)?;
        Ok((body, atts))
    }

    /// Validate, upload, estimate. Free: no generation is started.
    pub async fn quote(&self, req: &JobRequest) -> AppResult<Quote> {
        let model = self.model(&req.model_id)?;
        let threshold = self.threshold();
        // Validate with placeholders for media first so we don't upload for an invalid form.
        let mut pre = registry::clean_body(&req.params);
        for a in &req.attachments {
            let ph = Value::String(format!("@{}", a.path));
            if model
                .inputs
                .iter()
                .any(|i| i.name == a.param && i.kind.starts_with("array"))
            {
                pre.entry(a.param.clone())
                    .or_insert_with(|| Value::Array(vec![]))
                    .as_array_mut()
                    .map(|v| v.push(ph));
            } else {
                pre.insert(a.param.clone(), ph);
            }
        }
        let issues = registry::validate(&model, &pre, true);
        if !issues.is_empty() {
            return Ok(Quote {
                est_usd: None,
                estimate_error: None,
                needs_confirm: true,
                threshold_usd: threshold,
                issues,
            });
        }
        let client = self.client()?;
        let (body, _) = self.build_body(&client, req).await?;
        let (est, err) = match self.estimate_cached(&client, &req.model_id, &body).await {
            Ok(v) => (Some(v), None),
            Err(e @ (AppError::Unauthorized | AppError::NoKey)) => return Err(e),
            Err(e) => (None, Some(e.to_string())),
        };
        let needs_confirm = est.map(|v| v > threshold).unwrap_or(true);
        Ok(Quote {
            est_usd: est,
            estimate_error: err,
            needs_confirm,
            threshold_usd: threshold,
            issues,
        })
    }

    async fn estimate_cached(
        &self,
        client: &HfClient,
        model: &str,
        body: &Map<String, Value>,
    ) -> AppResult<f64> {
        let key = format!("{model}|{}", Value::Object(body.clone()));
        if let Some((v, at)) = self.estimates.lock().unwrap().get(&key) {
            if at.elapsed() < Duration::from_secs(600) {
                return Ok(*v);
            }
        }
        let v = client.estimate(model, body).await?;
        self.estimates
            .lock()
            .unwrap()
            .insert(key, (v, Instant::now()));
        Ok(v)
    }

    /// Create the job and start it. `confirmed_usd` is the price the user approved; the job is
    /// refused if confirmation is needed and missing, or if the estimate rose above it.
    pub async fn submit(
        self: &Arc<Self>,
        req: JobRequest,
        confirmed_usd: Option<f64>,
    ) -> AppResult<Job> {
        let q = self.quote(&req).await?;
        if !q.issues.is_empty() {
            let msg = q
                .issues
                .iter()
                .map(|i| format!("{} {}", i.param, i.message))
                .collect::<Vec<_>>()
                .join("; ");
            return Err(AppError::Validation(msg));
        }
        if q.needs_confirm {
            match (confirmed_usd, q.est_usd) {
                (None, _) => return Err(AppError::NeedsConfirmation),
                (Some(ok), Some(est)) if est > ok + 1e-9 => {
                    return Err(AppError::NeedsConfirmation)
                }
                _ => {}
            }
        }
        let model = self.model(&req.model_id)?;
        let t = now();
        let prompt = req
            .params
            .get("prompt")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let job = Job {
            id: new_id(),
            project_id: req.project_id.clone(),
            model_id: model.id.clone(),
            model_name: model.name.clone(),
            category: model.category.clone(),
            prompt,
            params: Value::Object(req.params.clone()),
            attachments: req.attachments.clone(),
            status: "submitting".into(),
            request_id: None,
            idempotency_key: new_id(),
            est_usd: q.est_usd,
            cost_usd: None,
            error: None,
            source: req.source.clone().unwrap_or_else(|| "generate".into()),
            brief_id: req.brief_id.clone(),
            shot_index: req.shot_index,
            retry_of: req.retry_of.clone(),
            created_at: t.clone(),
            updated_at: t,
            finished_at: None,
            thread_id: req.thread_id.clone(),
            assets: vec![],
        };
        self.db.insert_job(&job)?;
        self.events.job(&job);
        self.spawn(job.id.clone());
        Ok(job)
    }

    /// Restart runners for jobs that were active when the app closed.
    pub fn resume_all(self: &Arc<Self>) -> AppResult<usize> {
        let jobs = self.db.active_jobs()?;
        for j in &jobs {
            self.spawn(j.id.clone());
        }
        Ok(jobs.len())
    }

    pub fn spawn(self: &Arc<Self>, job_id: String) {
        let mut runners = self.runners.lock().unwrap();
        if runners.get(&job_id).is_some_and(|h| !h.is_finished()) {
            return;
        }
        let me = Arc::clone(self);
        let id = job_id.clone();
        let handle = tokio::spawn(async move {
            if let Err(e) = me.run(&id).await {
                let _ = me.db.set_job_status(&id, "failed", Some(&e.to_string()));
                me.emit(&id);
            }
            me.runners.lock().unwrap().remove(&id);
        });
        runners.insert(job_id, handle);
    }

    pub fn is_running(&self, job_id: &str) -> bool {
        self.runners
            .lock()
            .unwrap()
            .get(job_id)
            .is_some_and(|h| !h.is_finished())
    }

    fn emit(&self, id: &str) {
        if let Ok(j) = self.db.job(id) {
            self.events.job(&j);
        }
    }

    fn set(&self, id: &str, status: &str, err: Option<&str>) -> AppResult<()> {
        self.db.set_job_status(id, status, err)?;
        self.emit(id);
        Ok(())
    }

    async fn run(&self, id: &str) -> AppResult<()> {
        let job = self.db.job(id)?;
        let client = self.client()?;
        let mut request_id = job.request_id.clone();

        if request_id.is_none() {
            let req = JobRequest {
                model_id: job.model_id.clone(),
                params: job.params.as_object().cloned().unwrap_or_default(),
                attachments: job.attachments.clone(),
                project_id: job.project_id.clone(),
                source: None,
                brief_id: None,
                shot_index: None,
                retry_of: None,
                thread_id: None,
            };
            let (body, atts) = self.build_body(&client, &req).await?;
            self.db.set_job_attachments(id, &atts, &job.params)?;
            let mut attempt = 0u32;
            let mut backoff = self.poll.initial;
            let resp = loop {
                attempt += 1;
                // Same idempotency key on every attempt, so a retry can never double-charge.
                match client
                    .submit(&job.model_id, &body, &job.idempotency_key)
                    .await
                {
                    Ok(r) => break r,
                    Err(AppError::QueueFull(secs)) if attempt < self.poll.max_submit_attempts => {
                        self.db.set_job_status(
                            id,
                            "submitting",
                            Some(&format!("Higgsfield queue is full, retrying in {secs}s")),
                        )?;
                        self.emit(id);
                        let wait = if self.poll.initial < Duration::from_secs(1) {
                            self.poll.initial
                        } else {
                            Duration::from_secs(secs)
                        };
                        tokio::time::sleep(wait).await;
                    }
                    Err(e @ (AppError::Network(_) | AppError::ModelBlocked(_))) if attempt < 5 => {
                        log::warn!("submit attempt {attempt} for job {id} failed: {e}");
                        tokio::time::sleep(backoff).await;
                        backoff = backoff.mul_f64(2.0).min(Duration::from_secs(30));
                    }
                    Err(AppError::Api { status, detail }) if status >= 500 && attempt < 5 => {
                        log::warn!("submit attempt {attempt} for job {id}: {status} {detail}");
                        tokio::time::sleep(backoff).await;
                        backoff = backoff.mul_f64(2.0).min(Duration::from_secs(30));
                    }
                    Err(e) => return Err(e),
                }
            };
            self.db.set_job_submitted(id, &resp.request_id)?;
            self.clear_error(id)?;
            self.emit(id);
            request_id = Some(resp.request_id);
        }

        let rid = request_id.unwrap();
        let mut delay = self.poll.initial;
        let mut last = String::new();
        loop {
            match client.status(&rid).await {
                Ok(s) => {
                    let local = match s.status {
                        RemoteStatus::Queued | RemoteStatus::NotReady => "queued",
                        RemoteStatus::InProgress => "running",
                        RemoteStatus::Completed => "completed",
                        RemoteStatus::Failed => "failed",
                        RemoteStatus::Nsfw => "nsfw",
                        RemoteStatus::Canceled => "canceled",
                    };
                    if s.status == RemoteStatus::Completed {
                        self.set(id, "downloading", None)?;
                        self.download_outputs(&client, id, &s.outputs).await?;
                        self.db.set_job_cost(id, job.est_usd)?;
                        self.set(id, "completed", None)?;
                        return Ok(());
                    }
                    if s.status.is_terminal() {
                        self.db.set_job_cost(id, Some(0.0))?;
                        let err = s.error.clone().or_else(|| match s.status {
                            RemoteStatus::Nsfw => {
                                Some("Rejected by moderation. Not charged.".into())
                            }
                            RemoteStatus::Failed => Some("Generation failed. Not charged.".into()),
                            _ => None,
                        });
                        self.set(id, local, err.as_deref())?;
                        return Ok(());
                    }
                    if local != last {
                        self.set(id, local, None)?;
                        last = local.to_string();
                    }
                }
                Err(AppError::Unauthorized) => return Err(AppError::Unauthorized),
                Err(AppError::Api { status: 404, .. }) => {
                    return Err(AppError::Other(
                        "Higgsfield no longer has this request (expired or deleted).".into(),
                    ))
                }
                Err(e) => log::warn!("poll {id}: {e}"),
            }
            tokio::time::sleep(delay).await;
            delay = delay.mul_f64(self.poll.factor).min(self.poll.max);
        }
    }

    fn clear_error(&self, id: &str) -> AppResult<()> {
        // set_job_status keeps old errors via COALESCE; clear explicitly once submitted.
        self.db.set_job_status(id, "queued", Some(""))
    }

    async fn download_outputs(
        &self,
        client: &HfClient,
        id: &str,
        outputs: &[crate::hf::OutputFile],
    ) -> AppResult<()> {
        let job = self.db.job(id)?;
        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
        let dir = self.library_dir().join(day);
        tokio::fs::create_dir_all(&dir).await?;
        let existing: Vec<String> = job
            .assets
            .iter()
            .filter_map(|a| a.remote_url.clone())
            .collect();
        for (i, o) in outputs.iter().enumerate() {
            if existing.contains(&o.url) {
                continue;
            }
            let ext = ext_for(&o.url, &o.kind);
            let short: String = id.chars().take(8).collect();
            let path = dir.join(format!("{short}_{i}.{ext}"));
            let tmp = path.with_extension(format!("{ext}.part"));
            let mut resp = client.download(&o.url).await?;
            let mut f = tokio::fs::File::create(&tmp).await?;
            while let Some(chunk) = resp.chunk().await? {
                f.write_all(&chunk).await?;
            }
            f.flush().await?;
            drop(f);
            tokio::fs::rename(&tmp, &path).await?;
            self.db.insert_asset(&Asset {
                id: new_id(),
                job_id: id.into(),
                project_id: job.project_id.clone(),
                kind: o.kind.clone(),
                path: path.to_string_lossy().into(),
                remote_url: Some(o.url.clone()),
                favorite: false,
                created_at: now(),
            })?;
        }
        Ok(())
    }

    /// Cancel. Returns a message for the user.
    pub async fn cancel(&self, id: &str) -> AppResult<String> {
        let job = self.db.job(id)?;
        if crate::db::TERMINAL.contains(&job.status.as_str()) {
            return Ok("Job already finished.".into());
        }
        match &job.request_id {
            None => {
                // Not sent yet (or still uploading). Stop the runner. If a submit was in flight,
                // its idempotency key is kept so nothing is double-charged.
                if let Some(h) = self.runners.lock().unwrap().remove(id) {
                    h.abort();
                }
                self.set(id, "canceled", Some("Canceled before submitting."))?;
                Ok("Canceled before it was sent.".into())
            }
            Some(rid) => {
                let client = self.client()?;
                if client.cancel(rid).await? {
                    self.db.set_job_cost(id, Some(0.0))?;
                    if let Some(h) = self.runners.lock().unwrap().remove(id) {
                        h.abort();
                    }
                    self.set(id, "canceled", Some("Canceled while queued. Refunded."))?;
                    Ok("Canceled. Queued jobs are refunded.".into())
                } else {
                    Ok("Already rendering on Higgsfield, so it can't be canceled. It will finish and be charged.".into())
                }
            }
        }
    }

    /// Delete a job locally and its files. Remote copies expire on their own.
    pub async fn delete(&self, id: &str) -> AppResult<()> {
        if let Some(h) = self.runners.lock().unwrap().remove(id) {
            h.abort();
        }
        for a in self.db.delete_job(id)? {
            let _ = tokio::fs::remove_file(&a.path).await;
        }
        Ok(())
    }
}

pub fn ext_for(url: &str, kind: &str) -> String {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let ext = path
        .rsplit('/')
        .next()
        .and_then(|f| f.rsplit_once('.'))
        .map(|(_, e)| e.to_lowercase());
    match ext {
        Some(e) if e.len() <= 5 && e.chars().all(|c| c.is_ascii_alphanumeric()) => e,
        _ => match kind {
            "video" => "mp4".into(),
            "audio" => "wav".into(),
            "image" => "png".into(),
            _ => "bin".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemoryStore;
    use serde_json::json;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[derive(Default)]
    struct Recorder(Mutex<Vec<String>>);
    impl Events for Recorder {
        fn job(&self, job: &Job) {
            let mut v = self.0.lock().unwrap();
            if v.last() != Some(&job.status) {
                v.push(job.status.clone());
            }
        }
    }

    const MODEL: &str = "higgsfield-ai/soul/v2/standard";

    async fn setup(server: &MockServer) -> (Arc<JobManager>, Arc<Recorder>, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let secrets = Arc::new(MemoryStore::default());
        secrets.set(HIGGSFIELD, "id:secret").unwrap();
        let reg = Registry::parse(include_str!("../../models.json")).unwrap();
        let rec = Arc::new(Recorder::default());
        let poll = PollConfig {
            initial: Duration::from_millis(5),
            factor: 1.5,
            max: Duration::from_millis(20),
            max_submit_attempts: 5,
        };
        let jm = JobManager::new(
            Arc::new(Db::memory().unwrap()),
            secrets,
            Arc::new(RwLock::new(reg)),
            rec.clone(),
            dir.path().to_path_buf(),
            server.uri(),
            poll,
        );
        (jm, rec, dir)
    }

    fn req(prompt: &str) -> JobRequest {
        JobRequest {
            model_id: MODEL.into(),
            params: json!({"prompt": prompt}).as_object().unwrap().clone(),
            attachments: vec![],
            project_id: None,
            source: None,
            brief_id: None,
            shot_index: None,
            retry_of: None,
            thread_id: None,
        }
    }

    async fn wait_terminal(jm: &JobManager, id: &str) -> Job {
        for _ in 0..400 {
            let j = jm.db.job(id).unwrap();
            if crate::db::TERMINAL.contains(&j.status.as_str()) && !jm.is_running(id) {
                return j;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("job did not finish: {:?}", jm.db.job(id).unwrap());
    }

    async fn mount_estimate(server: &MockServer, usd: &str) {
        Mock::given(method("POST"))
            .and(path(format!("/estimate/{MODEL}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"usd": usd})))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn full_lifecycle_downloads_outputs() {
        let server = MockServer::start().await;
        mount_estimate(&server, "0.09").await;
        Mock::given(method("POST"))
            .and(path(format!("/{MODEL}")))
            .and(header("Authorization", "Key id:secret"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"status":"queued","request_id":"r1"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let st = |s: &str| {
            ResponseTemplate::new(200).set_body_json(json!({"status": s, "request_id":"r1"}))
        };
        Mock::given(path("/requests/r1/status"))
            .respond_with(st("queued"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(path("/requests/r1/status"))
            .respond_with(st("in_progress"))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        let img = format!("{}/cdn/out.jpg", server.uri());
        Mock::given(path("/requests/r1/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                json!({"status":"completed","request_id":"r1","images":[{"url": img}]}),
            ))
            .mount(&server)
            .await;
        Mock::given(path("/cdn/out.jpg"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0xff, 0xd8, 0xff]))
            .mount(&server)
            .await;

        let (jm, rec, _dir) = setup(&server).await;
        // Needs confirmation by default (threshold $0).
        assert!(matches!(
            jm.submit(req("lake"), None).await,
            Err(AppError::NeedsConfirmation)
        ));
        // Confirmed at a lower price than the estimate → still refused.
        assert!(matches!(
            jm.submit(req("lake"), Some(0.05)).await,
            Err(AppError::NeedsConfirmation)
        ));
        let job = jm.submit(req("lake"), Some(0.09)).await.unwrap();
        let done = wait_terminal(&jm, &job.id).await;
        assert_eq!(done.status, "completed");
        assert_eq!(done.request_id.as_deref(), Some("r1"));
        assert_eq!(done.cost_usd, Some(0.09));
        assert_eq!(done.assets.len(), 1);
        assert!(done.assets[0].path.ends_with(".jpg"));
        assert_eq!(
            std::fs::read(&done.assets[0].path).unwrap(),
            vec![0xff, 0xd8, 0xff]
        );
        let seen = rec.0.lock().unwrap().clone();
        assert_eq!(
            seen,
            vec![
                "submitting",
                "queued",
                "running",
                "downloading",
                "completed"
            ]
        );
    }

    #[tokio::test]
    async fn threshold_allows_cheap_jobs_without_confirmation() {
        let server = MockServer::start().await;
        mount_estimate(&server, "0.09").await;
        Mock::given(method("POST"))
            .and(path(format!("/{MODEL}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"request_id":"r2"})))
            .mount(&server)
            .await;
        Mock::given(path("/requests/r2/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status":"nsfw"})))
            .mount(&server)
            .await;
        let (jm, _, _d) = setup(&server).await;
        jm.db.set_setting(SETTING_THRESHOLD, "1.00").unwrap();
        let q = jm.quote(&req("x")).await.unwrap();
        assert!(!q.needs_confirm);
        let job = jm.submit(req("x"), None).await.unwrap();
        let done = wait_terminal(&jm, &job.id).await;
        assert_eq!(done.status, "nsfw");
        assert_eq!(done.cost_usd, Some(0.0));
    }

    #[tokio::test]
    async fn queue_full_retries_with_same_idempotency_key() {
        let server = MockServer::start().await;
        mount_estimate(&server, "0.09").await;
        Mock::given(method("POST"))
            .and(path(format!("/{MODEL}")))
            .respond_with(ResponseTemplate::new(429).set_body_json(
                json!({"detail":{"code":"account_queue_full","retry_after_seconds":1}}),
            ))
            .up_to_n_times(2)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(format!("/{MODEL}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"request_id":"r3"})))
            .mount(&server)
            .await;
        Mock::given(path("/requests/r3/status"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!({"status":"failed","error":"boom"})),
            )
            .mount(&server)
            .await;
        let (jm, _, _d) = setup(&server).await;
        let job = jm.submit(req("x"), Some(0.09)).await.unwrap();
        let done = wait_terminal(&jm, &job.id).await;
        assert_eq!(done.status, "failed");
        assert_eq!(done.error.as_deref(), Some("boom"));
        let keys: Vec<String> = server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.method.as_str() == "POST" && r.url.path() == format!("/{MODEL}"))
            .map(|r| {
                r.headers
                    .get("idempotency-key")
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(keys.len(), 3);
        assert!(keys.iter().all(|k| k == &job.idempotency_key));
    }

    #[tokio::test]
    async fn resume_after_restart_polls_existing_request() {
        let server = MockServer::start().await;
        Mock::given(path("/requests/old/status"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"status":"canceled"})))
            .mount(&server)
            .await;
        let (jm, _, _d) = setup(&server).await;
        let mut j = crate::db::sample_job(MODEL);
        j.status = "running".into();
        j.request_id = Some("old".into());
        jm.db.insert_job(&j).unwrap();
        assert_eq!(jm.resume_all().unwrap(), 1);
        let done = wait_terminal(&jm, &j.id).await;
        assert_eq!(done.status, "canceled");
        // No submit happened.
        assert!(server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|r| r.method.as_str() == "GET"));
    }

    #[tokio::test]
    async fn cancel_running_job_is_refused_politely() {
        let server = MockServer::start().await;
        Mock::given(path("/requests/r9/cancel"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"detail":"started"})))
            .mount(&server)
            .await;
        let (jm, _, _d) = setup(&server).await;
        let mut j = crate::db::sample_job(MODEL);
        j.status = "running".into();
        j.request_id = Some("r9".into());
        jm.db.insert_job(&j).unwrap();
        let msg = jm.cancel(&j.id).await.unwrap();
        assert!(msg.contains("can't be canceled"));
        assert_eq!(jm.db.job(&j.id).unwrap().status, "running");
    }

    #[tokio::test]
    async fn invalid_params_are_reported_before_any_request() {
        let server = MockServer::start().await;
        let (jm, _, _d) = setup(&server).await;
        let mut r = req("x");
        r.model_id = "kling-video/v3.0/pro/image-to-video".into();
        let q = jm.quote(&r).await.unwrap();
        assert!(q.issues.iter().any(|i| i.param == "image_url"));
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[test]
    fn merges_attachments_into_params() {
        let reg = Registry::parse(include_str!("../../models.json")).unwrap();
        let m = reg.get("kling-video/v3.0/pro/image-to-video").unwrap();
        let atts = vec![Attachment {
            path: "/a.png".into(),
            param: "image_url".into(),
            public_url: Some("https://cdn/a.png".into()),
        }];
        let body = merge_attachments(
            m,
            &json!({"prompt":"p","duration":null})
                .as_object()
                .unwrap()
                .clone(),
            &atts,
        )
        .unwrap();
        assert_eq!(body["image_url"], "https://cdn/a.png");
        assert!(!body.contains_key("duration"));
    }

    #[test]
    fn extensions() {
        assert_eq!(ext_for("https://cdn/x/abc.MP4?sig=1", "video"), "mp4");
        assert_eq!(ext_for("https://cdn/x/abc", "video"), "mp4");
        assert_eq!(ext_for("https://cdn/x/abc", "image"), "png");
    }
}
