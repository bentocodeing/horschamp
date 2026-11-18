//! Tauri commands. Nothing here returns a secret; the webview only ever sees a masked hint.

use crate::db::{self, Brief, BriefMessage, Job, LibraryFilter, LibraryItem, Project, Thread};
use crate::director::{self, DirectorStatus, Shot};
use crate::error::{AppError, AppResult};
use crate::hf::{self, HfClient};
use crate::jobs::{JobRequest, Quote, SETTING_THRESHOLD};
use crate::registry::{self, Registry, RegistryDiff};
use crate::secrets::{self, ANTHROPIC, HIGGSFIELD};
use crate::{export, media, AppState};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

type S<'a> = State<'a, AppState>;

// ---------- keys ----------

#[derive(Serialize)]
pub struct KeyStatus {
    present: bool,
    hint: Option<String>,
    anthropic_present: bool,
}

#[tauri::command]
pub fn key_status(s: S) -> AppResult<KeyStatus> {
    let k = s.secrets.get(HIGGSFIELD)?;
    Ok(KeyStatus {
        present: k.is_some(),
        hint: k.as_deref().map(secrets::mask),
        anthropic_present: s.secrets.get(ANTHROPIC)?.is_some(),
    })
}

#[derive(Serialize)]
pub struct KeyTest {
    ok: bool,
    message: String,
}

/// Checks a key without spending: asks for the status of a random request id.
/// 404 means auth passed; 401/403 means the key is rejected.
async fn test_key(key: &str) -> KeyTest {
    let c = HfClient::new(key.to_string());
    let probe = uuid::Uuid::new_v4().to_string();
    match c.status(&probe).await {
        Err(AppError::Api { status: 404, .. }) | Err(AppError::Api { status: 422, .. }) | Ok(_) => {
            KeyTest {
                ok: true,
                message: "Key accepted by Higgsfield.".into(),
            }
        }
        Err(AppError::Unauthorized) => KeyTest {
            ok: false,
            message: "Higgsfield rejected this key (401).".into(),
        },
        Err(AppError::InsufficientBalance) => KeyTest {
            ok: false,
            message: "Key is disabled or has no access (403).".into(),
        },
        Err(e) => KeyTest {
            ok: false,
            message: format!("Could not verify: {e}"),
        },
    }
}

#[tauri::command]
pub async fn key_set(s: S<'_>, value: String) -> AppResult<KeyTest> {
    let key = secrets::normalise_hf_key(&value)?;
    let t = test_key(&key).await;
    if t.ok {
        s.secrets.set(HIGGSFIELD, &key)?;
    }
    Ok(t)
}

#[tauri::command]
pub async fn key_test(s: S<'_>) -> AppResult<KeyTest> {
    let key = s.secrets.get(HIGGSFIELD)?.ok_or(AppError::NoKey)?;
    Ok(test_key(&key).await)
}

#[tauri::command]
pub fn key_delete(s: S) -> AppResult<()> {
    s.secrets.delete(HIGGSFIELD)
}

#[tauri::command]
pub fn anthropic_key_set(s: S, value: String) -> AppResult<()> {
    let v = value.trim();
    if !v.starts_with("sk-ant-") || v.contains(char::is_whitespace) {
        return Err(AppError::Validation(
            "That doesn't look like an Anthropic API key (sk-ant-…).".into(),
        ));
    }
    s.secrets.set(ANTHROPIC, v)
}

#[tauri::command]
pub fn anthropic_key_delete(s: S) -> AppResult<()> {
    s.secrets.delete(ANTHROPIC)
}

// ---------- models ----------

#[tauri::command]
pub fn models_list(s: S) -> Registry {
    s.registry.read().unwrap().clone()
}

#[tauri::command]
pub fn models_preview_import(s: S, path: String) -> AppResult<RegistryDiff> {
    let new = Registry::parse(&std::fs::read_to_string(&path)?)?;
    Ok(registry::diff(&s.registry.read().unwrap(), &new))
}

#[tauri::command]
pub fn models_apply_import(s: S, path: String) -> AppResult<RegistryDiff> {
    let text = std::fs::read_to_string(&path)?;
    let new = Registry::parse(&text)?;
    let d = registry::diff(&s.registry.read().unwrap(), &new);
    std::fs::write(&s.models_override, text)?;
    *s.registry.write().unwrap() = new;
    Ok(d)
}

#[tauri::command]
pub fn models_reset(s: S) -> AppResult<()> {
    let _ = std::fs::remove_file(&s.models_override);
    *s.registry.write().unwrap() = Registry::parse(&std::fs::read_to_string(&s.bundled_models)?)?;
    Ok(())
}

/// Crawl the docs for the latest models, save the result next to the app data and return its
/// path plus a diff. Nothing changes until the user applies it with `models_apply_import`.
#[tauri::command]
pub async fn models_fetch_latest(s: S<'_>) -> AppResult<FetchedModels> {
    let current = s.registry.read().unwrap().clone();
    let text = crate::refresh::fetch_latest(&current).await?;
    let new = Registry::parse(&text)?;
    let path = s.data_dir.join("models.refreshed.json");
    std::fs::write(&path, text)?;
    Ok(FetchedModels {
        path: path.to_string_lossy().into_owned(),
        diff: registry::diff(&current, &new),
    })
}

#[derive(serde::Serialize)]
pub struct FetchedModels {
    pub path: String,
    pub diff: RegistryDiff,
}

// ---------- projects ----------

#[tauri::command]
pub fn projects_list(s: S) -> AppResult<Vec<Project>> {
    s.db.projects()
}
#[tauri::command]
pub fn project_create(s: S, name: String) -> AppResult<Project> {
    s.db.create_project(&name)
}
#[tauri::command]
pub fn project_rename(s: S, id: String, name: String) -> AppResult<()> {
    s.db.rename_project(&id, &name)
}
#[tauri::command]
pub fn project_delete(s: S, id: String) -> AppResult<()> {
    s.db.delete_project(&id)
}

// ---------- jobs ----------

#[tauri::command]
pub async fn job_quote(s: S<'_>, req: JobRequest) -> AppResult<Quote> {
    s.jobs.quote(&req).await
}

/// `confirmed_usd` is the estimate the user approved in the confirmation dialog.
#[tauri::command]
pub async fn job_submit(s: S<'_>, req: JobRequest, confirmed_usd: Option<f64>) -> AppResult<Job> {
    s.jobs.submit(req, confirmed_usd).await
}

#[tauri::command]
pub fn jobs_list(s: S, project_id: Option<String>, limit: Option<i64>) -> AppResult<Vec<Job>> {
    s.db.jobs(project_id.as_deref(), limit.unwrap_or(100))
}

#[tauri::command]
pub fn thread_jobs(
    s: S,
    thread_id: Option<String>,
    project_id: Option<String>,
    limit: Option<i64>,
) -> AppResult<Vec<Job>> {
    s.db.thread_jobs(
        thread_id.as_deref(),
        project_id.as_deref(),
        limit.unwrap_or(200),
    )
}

#[tauri::command]
pub fn threads_list(s: S, project_id: Option<String>) -> AppResult<Vec<Thread>> {
    s.db.threads(project_id.as_deref())
}

#[tauri::command]
pub fn thread_create(s: S, project_id: Option<String>) -> AppResult<Thread> {
    s.db.create_thread(project_id.as_deref())
}

#[tauri::command]
pub fn thread_rename(s: S, id: String, title: String) -> AppResult<()> {
    s.db.rename_thread(&id, title.trim())
}

#[tauri::command]
pub fn thread_delete(s: S, id: String) -> AppResult<()> {
    s.db.delete_thread(&id)
}

#[tauri::command]
pub fn job_get(s: S, id: String) -> AppResult<Job> {
    s.db.job(&id)
}

#[tauri::command]
pub async fn job_cancel(s: S<'_>, id: String) -> AppResult<String> {
    s.jobs.cancel(&id).await
}

#[tauri::command]
pub async fn job_delete(s: S<'_>, id: String) -> AppResult<()> {
    s.jobs.delete(&id).await
}

// ---------- library ----------

#[tauri::command]
pub fn library_list(s: S, filter: LibraryFilter) -> AppResult<Vec<LibraryItem>> {
    s.db.library(&filter)
}

#[tauri::command]
pub fn asset_favorite(s: S, id: String, favorite: bool) -> AppResult<()> {
    s.db.set_favorite(&id, favorite)
}

#[tauri::command]
pub fn asset_delete(s: S, id: String) -> AppResult<()> {
    let a = s.db.delete_asset(&id)?;
    let _ = std::fs::remove_file(&a.path);
    Ok(())
}

#[tauri::command]
pub fn asset_reveal(s: S, id: String) -> AppResult<()> {
    let a = s.db.asset(&id)?;
    tauri_plugin_opener::reveal_item_in_dir(&a.path).map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn asset_open(app: AppHandle, s: S, id: String) -> AppResult<()> {
    let a = s.db.asset(&id)?;
    app.opener()
        .open_path(&a.path, None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

/// Reveal an exported file in Finder / the file manager.
#[tauri::command]
pub fn reveal_path(path: String) -> AppResult<()> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(AppError::NotFound(path));
    }
    tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| AppError::Other(e.to_string()))
}

/// Allow the webview to preview files the user picked or dropped (asset protocol scope).
#[tauri::command]
pub fn preview_allow(app: AppHandle, paths: Vec<String>) -> AppResult<()> {
    for p in paths {
        let p = PathBuf::from(p);
        if p.is_file() {
            app.asset_protocol_scope()
                .allow_file(&p)
                .map_err(|e| AppError::Other(e.to_string()))?;
        }
    }
    Ok(())
}

// ---------- settings & spending ----------

const SETTINGS: &[&str] = &[
    SETTING_THRESHOLD,
    "starting_balance_usd",
    "balance_set_at",
    "library_dir",
    "claude_path",
    "ffmpeg_path",
];

#[tauri::command]
pub fn settings_get(app: AppHandle, s: S) -> AppResult<HashMap<String, String>> {
    let mut m = HashMap::new();
    for k in SETTINGS {
        if let Some(v) = s.db.setting(k)? {
            m.insert(k.to_string(), v);
        }
    }
    m.entry("library_dir".into())
        .or_insert_with(|| s.jobs.library_dir().to_string_lossy().into());
    m.entry(SETTING_THRESHOLD.into())
        .or_insert_with(|| "0".into());
    let _ = app;
    Ok(m)
}

#[tauri::command]
pub fn settings_set(app: AppHandle, s: S, key: String, value: String) -> AppResult<()> {
    if !SETTINGS.contains(&key.as_str()) {
        return Err(AppError::Validation(format!("unknown setting {key}")));
    }
    match key.as_str() {
        SETTING_THRESHOLD | "starting_balance_usd" => {
            let v: f64 = value
                .trim()
                .trim_start_matches('$')
                .parse()
                .map_err(|_| AppError::Validation("Enter a dollar amount".into()))?;
            if v < 0.0 {
                return Err(AppError::Validation("Amount can't be negative".into()));
            }
            s.db.set_setting(&key, &format!("{v}"))?;
            if key == "starting_balance_usd" {
                s.db.set_setting("balance_set_at", &db::now())?;
            }
            return Ok(());
        }
        "library_dir" => {
            let p = PathBuf::from(&value);
            std::fs::create_dir_all(&p)?;
            let _ = app.asset_protocol_scope().allow_directory(&p, true);
            s.jobs.set_library_dir(p);
        }
        _ => {}
    }
    s.db.set_setting(&key, &value)
}

#[derive(Serialize)]
pub struct Spending {
    starting_balance_usd: Option<f64>,
    balance_set_at: Option<String>,
    usage_spent_usd: Option<f64>,
    usage_synced_at: Option<String>,
    local_spent_usd: f64,
    remaining_est_usd: Option<f64>,
    threshold_usd: f64,
    director_spent_usd: f64,
}

#[tauri::command]
pub fn spending_summary(s: S) -> AppResult<Spending> {
    let start =
        s.db.setting("starting_balance_usd")?
            .and_then(|v| v.parse().ok());
    let since = s.db.setting("balance_set_at")?;
    let local = s.db.local_spend(since.as_deref())?;
    let usage = s.db.last_usage_sync()?;
    let usage_spent = usage.as_ref().map(|u| u.3);
    let spent = usage_spent
        .unwrap_or(local)
        .max(local.min(usage_spent.unwrap_or(local)));
    let director: f64 =
        s.db.briefs(None)?
            .iter()
            .filter(|b| b.backend.as_deref() == Some("anthropic-api"))
            .map(|b| b.director_cost_usd)
            .sum();
    Ok(Spending {
        starting_balance_usd: start,
        balance_set_at: since,
        usage_spent_usd: usage_spent,
        usage_synced_at: usage.map(|u| u.0),
        local_spent_usd: local,
        remaining_est_usd: start.map(|b: f64| b - spent),
        threshold_usd: s.jobs.threshold(),
        director_spent_usd: director,
    })
}

/// Write every job with its estimate and charged amount to a CSV file the user picked.
/// Returns the number of jobs written.
#[tauri::command]
pub fn spending_export_csv(s: S, out_path: String) -> AppResult<usize> {
    let out = PathBuf::from(&out_path);
    if out.extension().and_then(|e| e.to_str()) != Some("csv") {
        return Err(AppError::Validation("Export file must end in .csv".into()));
    }
    let jobs = s.db.jobs(None, i64::MAX)?;
    let projects: HashMap<String, String> =
        s.db.projects()?
            .into_iter()
            .map(|p| (p.id, p.name))
            .collect();
    std::fs::write(&out, export::jobs_csv(&jobs, &projects))?;
    Ok(jobs.len())
}

/// Show the folder with the daily database backups in Finder.
#[tauri::command]
pub fn backups_reveal(s: S) -> AppResult<()> {
    let dir = s.data_dir.join("backups");
    std::fs::create_dir_all(&dir)?;
    tauri_plugin_opener::reveal_item_in_dir(&dir).map_err(|e| AppError::Other(e.to_string()))
}

/// Sum `/models/usage` from when the starting balance was set (or the last 30 days) until now,
/// in ≤31-day windows. Documented as Enterprise; returns a clear error if this key can't use it.
#[tauri::command]
pub async fn usage_sync(s: S<'_>) -> AppResult<Value> {
    let client = s.jobs.client()?;
    let now = chrono::Utc::now();
    let since =
        s.db.setting("balance_set_at")?
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(&v).ok())
            .map(|d| d.with_timezone(&chrono::Utc))
            .unwrap_or(now - chrono::Duration::days(30));
    let mut start = since;
    let mut total = 0.0;
    let mut by: std::collections::BTreeMap<String, f64> = Default::default();
    while start < now {
        let end = (start + chrono::Duration::days(31)).min(now);
        let fmt =
            |d: chrono::DateTime<chrono::Utc>| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        let v = client.usage(&fmt(start), &fmt(end)).await.map_err(|e| match e {
            AppError::Api { status: 403 | 404, .. } | AppError::InsufficientBalance => {
                AppError::Other("This key can't read Higgsfield usage (the endpoint may be Enterprise-only). Using the local log instead.".into())
            }
            e => e,
        })?;
        let (t, models) = hf::sum_usage(&v);
        total += t;
        for (m, c) in models {
            *by.entry(m).or_default() += c;
        }
        start = end;
    }
    let by_json = json!(by);
    s.db.record_usage_sync(&since.to_rfc3339(), &now.to_rfc3339(), total, &by_json)?;
    Ok(json!({"total_usd": total, "by_model": by_json}))
}

// ---------- director ----------

#[tauri::command]
pub async fn director_status(s: S<'_>) -> AppResult<DirectorStatus> {
    Ok(s.director.status().await)
}

#[tauri::command]
pub fn director_prompt_open(app: AppHandle, s: S) -> AppResult<()> {
    app.opener()
        .open_path(s.director.prompt_path.to_string_lossy(), None::<&str>)
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub fn director_prompt_reset(s: S) -> AppResult<()> {
    std::fs::copy(&s.bundled_prompt, &s.director.prompt_path)?;
    Ok(())
}

#[tauri::command]
pub fn briefs_list(s: S, project_id: Option<String>) -> AppResult<Vec<Brief>> {
    s.db.briefs(project_id.as_deref())
}

#[tauri::command]
pub fn brief_create(s: S, project_id: Option<String>, title: String) -> AppResult<Brief> {
    s.db.create_brief(
        project_id.as_deref(),
        if title.trim().is_empty() {
            "Untitled brief"
        } else {
            title.trim()
        },
    )
}

#[derive(Serialize)]
pub struct BriefFull {
    brief: Brief,
    messages: Vec<BriefMessage>,
    busy: bool,
}

#[tauri::command]
pub fn brief_get(s: S, id: String) -> AppResult<BriefFull> {
    Ok(BriefFull {
        brief: s.db.brief(&id)?,
        messages: s.db.brief_messages(&id)?,
        busy: s.director.is_busy(&id),
    })
}

#[tauri::command]
pub async fn brief_send(
    s: S<'_>,
    id: String,
    text: String,
    attachments: Vec<String>,
) -> AppResult<()> {
    // Videos: give the director a few keyframes it can actually look at.
    let mut files = Vec::new();
    let ffmpeg = media::find_ffmpeg(s.db.setting("ffmpeg_path")?.as_deref()).await;
    for a in attachments {
        let p = PathBuf::from(&a);
        let is_video = mime_guess::from_path(&p)
            .first_raw()
            .is_some_and(|m| m.starts_with("video/"));
        files.push(a.clone());
        if let (true, Some(ff)) = (is_video, ffmpeg.as_ref()) {
            let dir = s.data_dir.join("director").join("frames").join(&id);
            if let Ok(frames) = media::keyframes(ff, &p, &dir, 3).await {
                files.extend(frames.into_iter().map(|f| f.to_string_lossy().into_owned()));
            }
        }
    }
    s.director.send(id, text, files)
}

#[tauri::command]
pub fn brief_cancel(s: S, id: String) {
    s.director.cancel(&id);
}

#[tauri::command]
pub fn brief_rename(s: S, id: String, title: String) -> AppResult<()> {
    s.db.rename_brief(&id, title.trim())
}

#[tauri::command]
pub fn brief_delete(s: S, id: String) -> AppResult<()> {
    s.director.cancel(&id);
    s.db.delete_brief(&id)
}

/// Save user-edited shots, re-validating against the schema.
#[tauri::command]
pub fn brief_set_shots(s: S, id: String, shots: Vec<Value>) -> AppResult<Value> {
    let mut parsed: Vec<Shot> = shots
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<_, _>>()?;
    director::validate_shots(&s.registry.read().unwrap(), &mut parsed);
    let v = serde_json::to_value(&parsed)?;
    s.db.set_brief_shots(&id, &v)?;
    Ok(v)
}

// ---------- timeline ----------

#[derive(Serialize)]
pub struct FfmpegStatus {
    available: bool,
    path: Option<String>,
}

#[tauri::command]
pub async fn ffmpeg_status(s: S<'_>) -> AppResult<FfmpegStatus> {
    let p = media::find_ffmpeg(s.db.setting("ffmpeg_path")?.as_deref()).await;
    Ok(FfmpegStatus {
        available: p.is_some(),
        path: p.map(|p| p.to_string_lossy().into()),
    })
}

/// One install at a time; a second click while brew/winget runs is refused.
static FFMPEG_INSTALLING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
pub async fn ffmpeg_install() -> AppResult<FfmpegStatus> {
    use std::sync::atomic::Ordering;
    if FFMPEG_INSTALLING.swap(true, Ordering::SeqCst) {
        return Err(AppError::Other("ffmpeg is already being installed.".into()));
    }
    let r = media::install_ffmpeg().await;
    FFMPEG_INSTALLING.store(false, Ordering::SeqCst);
    let p = r?;
    Ok(FfmpegStatus {
        available: true,
        path: Some(p.to_string_lossy().into()),
    })
}

#[tauri::command]
pub async fn timeline_export(
    s: S<'_>,
    asset_ids: Vec<String>,
    out_path: String,
) -> AppResult<String> {
    let ff = media::find_ffmpeg(s.db.setting("ffmpeg_path")?.as_deref())
        .await
        .ok_or_else(|| {
            AppError::Other("ffmpeg not found. Install it from Settings → Models & tools.".into())
        })?;
    let mut clips = Vec::new();
    for id in &asset_ids {
        let a = s.db.asset(id)?;
        if a.kind != "video" {
            return Err(AppError::Validation(
                "Only video clips can go on the timeline".into(),
            ));
        }
        clips.push(PathBuf::from(a.path));
    }
    let out = PathBuf::from(&out_path);
    media::export_timeline(&ff, &clips, &out).await?;
    Ok(out_path)
}
