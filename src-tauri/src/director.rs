//! "Brief" creative director. Primary backend: the local Claude Code CLI (`claude -p`, stream-json,
//! one session per brief). Fallback: the Anthropic Messages API with a key from the keychain.
//! The director never gets the Higgsfield key and cannot start generations; it only proposes shots.

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::registry::{self, Registry};
use crate::secrets::{SecretStore, ANTHROPIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, RwLock};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub const MODEL: &str = "claude-opus-5-5";

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DirectorEvent {
    Start {
        brief_id: String,
        backend: String,
    },
    Delta {
        brief_id: String,
        text: String,
    },
    Tool {
        brief_id: String,
        name: String,
        detail: String,
    },
    Done {
        brief_id: String,
        text: String,
        shots: Value,
        cost_usd: f64,
    },
    Error {
        brief_id: String,
        message: String,
    },
}

pub trait DirectorEvents: Send + Sync {
    fn director(&self, e: &DirectorEvent);
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DirectorStatus {
    pub cli_installed: bool,
    pub cli_path: Option<String>,
    pub cli_version: Option<String>,
    pub cli_logged_in: bool,
    pub cli_auth_method: Option<String>,
    pub api_key_present: bool,
    pub backend: Option<String>,
    pub prompt_path: String,
}

// ---------- shot list parsing & validation ----------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Shot {
    pub title: String,
    pub model_id: String,
    #[serde(default)]
    pub params: serde_json::Map<String, Value>,
    #[serde(default)]
    pub why: String,
    #[serde(default)]
    pub cheaper: Option<String>,
    #[serde(default)]
    pub better: Option<String>,
    /// Attachment filenames the shot needs, referenced in params as "@name".
    #[serde(default)]
    pub needs: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, skip_deserializing)]
    pub issues: Vec<registry::Issue>,
    #[serde(default, skip_deserializing)]
    pub model_name: Option<String>,
}

/// Find the shot list in the director's reply: a ```shotlist (or ```json) block containing
/// `{"shots":[...]}` or a bare array. Returns None if the reply has no shot list.
pub fn extract_shot_list(text: &str) -> Option<Result<Vec<Shot>, String>> {
    let mut candidates: Vec<&str> = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("```") {
        let after = &rest[start + 3..];
        let (lang, body) = after.split_once('\n').unwrap_or(("", after));
        let Some(end) = body.find("```") else { break };
        let lang = lang.trim().to_lowercase();
        if lang == "shotlist" || lang == "json" || lang.is_empty() {
            let block = &body[..end];
            if lang == "shotlist" {
                candidates.insert(0, block);
            } else if block.contains("\"model_id\"") {
                candidates.push(block);
            }
        }
        rest = &body[end + 3..];
    }
    let block = candidates.first()?;
    let v: Value = match serde_json::from_str(block.trim()) {
        Ok(v) => v,
        Err(e) => return Some(Err(format!("shot list is not valid JSON: {e}"))),
    };
    let arr = match v {
        Value::Array(a) => Value::Array(a),
        Value::Object(mut o) => o.remove("shots").unwrap_or(Value::Null),
        _ => Value::Null,
    };
    if !arr.is_array() {
        return Some(Err("shot list must be {\"shots\": [...]}".into()));
    }
    Some(
        serde_json::from_value::<Vec<Shot>>(arr)
            .map_err(|e| format!("shot list has the wrong shape: {e}")),
    )
}

/// Validate each shot against its model's schema. Media params may hold "@file" placeholders.
pub fn validate_shots(reg: &Registry, shots: &mut [Shot]) -> bool {
    let mut all_ok = true;
    for s in shots.iter_mut() {
        s.issues.clear();
        match reg.get(&s.model_id) {
            None => s.issues.push(registry::Issue {
                param: "model_id".into(),
                message: format!("unknown model '{}'", s.model_id),
            }),
            Some(m) => {
                s.model_name = Some(m.name.clone());
                s.issues = registry::validate(m, &s.params, true);
            }
        }
        if !s.issues.is_empty() {
            all_ok = false;
        }
    }
    all_ok
}

pub fn repair_prompt(shots: &[Shot]) -> String {
    let mut out = String::from(
        "Some shots in your shot list fail schema validation. Fix them and reply with the complete corrected ```shotlist block (all shots). Problems:\n",
    );
    for (i, s) in shots.iter().enumerate() {
        for iss in &s.issues {
            out.push_str(&format!(
                "- shot {} ({}): {} {}\n",
                i + 1,
                s.model_id,
                iss.param,
                iss.message
            ));
        }
    }
    out
}

// ---------- CLI discovery ----------

fn candidate_paths() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        v.push(home.join(".local/bin/claude"));
        v.push(home.join(".claude/local/claude"));
        v.push(home.join(".npm-global/bin/claude"));
        v.push(home.join(".bun/bin/claude"));
    }
    v.push("/opt/homebrew/bin/claude".into());
    v.push("/usr/local/bin/claude".into());
    v.push("/usr/bin/claude".into());
    if let Some(path) = std::env::var_os("PATH") {
        for d in std::env::split_paths(&path) {
            v.push(d.join("claude"));
        }
    }
    v
}

/// GUI apps on macOS get a minimal PATH, so look in the usual install spots, then ask a login shell.
pub async fn find_cli(override_path: Option<&str>) -> Option<PathBuf> {
    if let Some(p) = override_path.filter(|p| !p.is_empty()) {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    if let Some(p) = candidate_paths().into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let out = Command::new(shell)
        .args(["-lc", "command -v claude"])
        .output()
        .await
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty() && Path::new(&s).is_file()).then(|| PathBuf::from(s))
}

pub fn parse_auth_status(stdout: &str, exit_ok: bool) -> (bool, Option<String>) {
    let v: Value = serde_json::from_str(stdout.trim()).unwrap_or(Value::Null);
    let logged = v
        .get("loggedIn")
        .and_then(Value::as_bool)
        .unwrap_or(exit_ok);
    let method = v
        .get("authMethod")
        .and_then(Value::as_str)
        .map(String::from);
    (logged && exit_ok, method)
}

// ---------- stream-json parsing ----------

#[derive(Debug, PartialEq)]
pub enum CliLine {
    Init {
        session_id: String,
    },
    Delta(String),
    Tool {
        name: String,
        detail: String,
    },
    Result {
        text: String,
        session_id: Option<String>,
        cost: f64,
        is_error: bool,
        subtype: String,
    },
    Other,
}

pub fn parse_cli_line(line: &str) -> CliLine {
    let Ok(v) = serde_json::from_str::<Value>(line) else {
        return CliLine::Other;
    };
    match v.get("type").and_then(Value::as_str) {
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
            CliLine::Init {
                session_id: v
                    .get("session_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
            }
        }
        Some("stream_event") => {
            let d = v.pointer("/event/delta");
            match d.and_then(|d| d.get("type")).and_then(Value::as_str) {
                Some("text_delta") => CliLine::Delta(
                    d.unwrap()
                        .get("text")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into(),
                ),
                _ => CliLine::Other,
            }
        }
        Some("assistant") => {
            // Surface tool calls (web search, read) so the UI can show what the director is doing.
            if let Some(blocks) = v.pointer("/message/content").and_then(Value::as_array) {
                for b in blocks {
                    if b.get("type").and_then(Value::as_str) == Some("tool_use") {
                        let name = b
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .to_string();
                        let input = b.get("input").cloned().unwrap_or(Value::Null);
                        let detail = input
                            .get("query")
                            .or_else(|| input.get("url"))
                            .or_else(|| input.get("file_path"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        return CliLine::Tool { name, detail };
                    }
                }
            }
            CliLine::Other
        }
        Some("result") => CliLine::Result {
            text: v.get("result").and_then(Value::as_str).unwrap_or("").into(),
            session_id: v
                .get("session_id")
                .and_then(Value::as_str)
                .map(String::from),
            cost: v
                .get("total_cost_usd")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
            subtype: v
                .get("subtype")
                .and_then(Value::as_str)
                .unwrap_or("")
                .into(),
        },
        _ => CliLine::Other,
    }
}

// ---------- the director ----------

pub struct Director {
    pub db: Arc<Db>,
    pub secrets: Arc<dyn SecretStore>,
    pub registry: Arc<RwLock<Registry>>,
    pub events: Arc<dyn DirectorEvents>,
    /// Editable prompt (copied from the bundled default on first run).
    pub prompt_path: PathBuf,
    pub models_path: PathBuf,
    pub api_notes_path: PathBuf,
    /// Working dir for CLI sessions; keeps them away from the user's own projects.
    pub work_dir: PathBuf,
    running: Mutex<HashMap<String, tokio::task::AbortHandle>>,
    children: Mutex<HashMap<String, u32>>,
}

const MAX_REPAIRS: usize = 1;

impl Director {
    pub fn new(
        db: Arc<Db>,
        secrets: Arc<dyn SecretStore>,
        registry: Arc<RwLock<Registry>>,
        events: Arc<dyn DirectorEvents>,
        prompt_path: PathBuf,
        models_path: PathBuf,
        api_notes_path: PathBuf,
        work_dir: PathBuf,
    ) -> Arc<Self> {
        Arc::new(Self {
            db,
            secrets,
            registry,
            events,
            prompt_path,
            models_path,
            api_notes_path,
            work_dir,
            running: Mutex::new(HashMap::new()),
            children: Mutex::new(HashMap::new()),
        })
    }

    pub async fn status(&self) -> DirectorStatus {
        let mut s = DirectorStatus {
            prompt_path: self.prompt_path.to_string_lossy().into(),
            ..Default::default()
        };
        s.api_key_present = self.secrets.get(ANTHROPIC).ok().flatten().is_some();
        let override_path = self.db.setting("claude_path").ok().flatten();
        if let Some(p) = find_cli(override_path.as_deref()).await {
            s.cli_installed = true;
            s.cli_path = Some(p.to_string_lossy().into());
            if let Ok(o) = Command::new(&p).arg("--version").output().await {
                s.cli_version = Some(String::from_utf8_lossy(&o.stdout).trim().to_string());
            }
            if let Ok(o) = Command::new(&p).args(["auth", "status"]).output().await {
                let (ok, m) =
                    parse_auth_status(&String::from_utf8_lossy(&o.stdout), o.status.success());
                s.cli_logged_in = ok;
                s.cli_auth_method = m;
            }
        }
        s.backend = if s.cli_installed && s.cli_logged_in {
            Some("claude-cli".into())
        } else if s.api_key_present {
            Some("anthropic-api".into())
        } else {
            None
        };
        s
    }

    /// System prompt = editable director.md + compact catalog + where the full references live.
    pub fn system_prompt(&self) -> AppResult<String> {
        let base = std::fs::read_to_string(&self.prompt_path).map_err(|e| {
            AppError::Io(format!(
                "director prompt {}: {e}",
                self.prompt_path.display()
            ))
        })?;
        let catalog = self.registry.read().unwrap().compact_catalog();
        Ok(format!(
            "{base}\n\n## Model catalog (id | name | category | params; * = required)\n{catalog}\n\
             Full input schemas: {}\nHiggsfield API notes: {}\n",
            self.models_path.display(),
            self.api_notes_path.display()
        ))
    }

    pub fn cancel(&self, brief_id: &str) {
        if let Some(pid) = self.children.lock().unwrap().remove(brief_id) {
            #[cfg(unix)]
            unsafe {
                libc_kill(pid as i32);
            }
        }
        if let Some(h) = self.running.lock().unwrap().remove(brief_id) {
            h.abort();
        }
    }

    pub fn is_busy(&self, brief_id: &str) -> bool {
        self.running.lock().unwrap().contains_key(brief_id)
    }

    /// Start a director turn in the background. Events stream to the UI.
    pub fn send(
        self: &Arc<Self>,
        brief_id: String,
        text: String,
        attachments: Vec<String>,
    ) -> AppResult<()> {
        if self.is_busy(&brief_id) {
            return Err(AppError::Other("The director is still answering.".into()));
        }
        self.db.brief(&brief_id)?;
        self.db
            .add_brief_message(&brief_id, "user", &text, &attachments)?;
        let me = Arc::clone(self);
        let id = brief_id.clone();
        let task = tokio::spawn(async move {
            let res = me.turn(&id, text, attachments).await;
            me.running.lock().unwrap().remove(&id);
            me.children.lock().unwrap().remove(&id);
            if let Err(e) = res {
                let msg = e.to_string();
                let _ = me.db.add_brief_message(&id, "error", &msg, &[]);
                me.events.director(&DirectorEvent::Error {
                    brief_id: id.clone(),
                    message: msg,
                });
            }
        });
        self.running
            .lock()
            .unwrap()
            .insert(brief_id, task.abort_handle());
        Ok(())
    }

    async fn turn(&self, brief_id: &str, text: String, attachments: Vec<String>) -> AppResult<()> {
        let status = self.status().await;
        let backend = status.backend.clone().ok_or_else(|| {
            AppError::Other("No director available. Install and log in to Claude Code, or add an Anthropic API key in Settings.".into())
        })?;
        self.events.director(&DirectorEvent::Start {
            brief_id: brief_id.into(),
            backend: backend.clone(),
        });

        let mut prompt = text;
        if !attachments.is_empty() {
            prompt.push_str("\n\nAttached reference files (read them before answering):\n");
            for a in &attachments {
                prompt.push_str(&format!("- {a}\n"));
            }
        }
        let mut repairs = 0;
        loop {
            let (reply, cost) = match backend.as_str() {
                "claude-cli" => {
                    self.turn_cli(
                        brief_id,
                        &prompt,
                        &attachments,
                        status.cli_path.as_deref().unwrap(),
                    )
                    .await?
                }
                _ => self.turn_api(brief_id, &prompt, &attachments).await?,
            };
            let mut shots_value = self.db.brief(brief_id)?.shots;
            let mut needs_repair = None;
            match extract_shot_list(&reply) {
                Some(Ok(mut shots)) => {
                    let ok = validate_shots(&self.registry.read().unwrap(), &mut shots);
                    shots_value = serde_json::to_value(&shots)?;
                    self.db.set_brief_shots(brief_id, &shots_value)?;
                    if !ok {
                        needs_repair = Some(repair_prompt(&shots));
                    }
                }
                Some(Err(e)) => {
                    needs_repair = Some(format!("{e}. Reply again with a valid ```shotlist block."))
                }
                None => {}
            }
            self.db
                .add_brief_message(brief_id, "assistant", &reply, &[])?;
            match needs_repair {
                Some(fix) if repairs < MAX_REPAIRS => {
                    repairs += 1;
                    self.events.director(&DirectorEvent::Tool {
                        brief_id: brief_id.into(),
                        name: "validate".into(),
                        detail: "fixing invalid params".into(),
                    });
                    self.db.add_brief_message(brief_id, "system", &fix, &[])?;
                    prompt = fix;
                    continue;
                }
                _ => {
                    self.events.director(&DirectorEvent::Done {
                        brief_id: brief_id.into(),
                        text: reply,
                        shots: shots_value,
                        cost_usd: cost,
                    });
                    return Ok(());
                }
            }
        }
    }

    async fn turn_cli(
        &self,
        brief_id: &str,
        prompt: &str,
        attachments: &[String],
        cli: &str,
    ) -> AppResult<(String, f64)> {
        let brief = self.db.brief(brief_id)?;
        std::fs::create_dir_all(&self.work_dir)?;
        let sys_file = self.work_dir.join("director_system.md");
        std::fs::write(&sys_file, self.system_prompt()?)?;

        let mut cmd = Command::new(cli);
        cmd.current_dir(&self.work_dir).arg("-p").arg(prompt);
        let session = match brief
            .session_id
            .as_deref()
            .filter(|_| brief.backend.as_deref() == Some("claude-cli"))
        {
            Some(s) => {
                cmd.args(["--resume", s]);
                s.to_string()
            }
            None => {
                let s = uuid::Uuid::new_v4().to_string();
                cmd.args(["--session-id", &s]);
                s
            }
        };
        cmd.args([
            "--model",
            MODEL,
            "--output-format",
            "stream-json",
            "--verbose",
            "--include-partial-messages",
        ])
        .arg("--append-system-prompt-file")
        .arg(&sys_file)
        .args(["--tools", "Read,WebSearch,WebFetch"])
        .args([
            "--allowedTools",
            "Read",
            "WebSearch",
            "WebFetch(domain:higgsfield.ai)",
            "WebFetch(domain:docs.higgsfield.ai)",
        ])
        .args(["--disallowedTools", "Bash", "Edit", "Write", "mcp__*"])
        .args(["--permission-mode", "dontAsk", "--max-turns", "12"]);
        let mut dirs: Vec<PathBuf> = vec![self
            .models_path
            .parent()
            .unwrap_or(Path::new("/"))
            .to_path_buf()];
        for a in attachments {
            if let Some(p) = Path::new(a).parent() {
                if !dirs.contains(&p.to_path_buf()) {
                    dirs.push(p.to_path_buf());
                }
            }
        }
        for d in dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // Never hand our Higgsfield/Anthropic secrets to the child via env.
        cmd.env_remove("HF_KEY").env_remove("HIGGSFIELD_API_KEY");
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .map_err(|e| AppError::Other(format!("Could not start claude: {e}")))?;
        if let Some(pid) = child.id() {
            self.children.lock().unwrap().insert(brief_id.into(), pid);
        }
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let err_task = tokio::spawn(async move {
            let mut s = String::new();
            let mut r = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = r.next_line().await {
                if s.len() < 4000 {
                    s.push_str(&l);
                    s.push('\n');
                }
            }
            s
        });

        let mut lines = BufReader::new(stdout).lines();
        let mut streamed = String::new();
        let mut result: Option<(String, Option<String>, f64, bool, String)> = None;
        while let Some(line) = lines.next_line().await? {
            match parse_cli_line(&line) {
                CliLine::Delta(t) => {
                    streamed.push_str(&t);
                    self.events.director(&DirectorEvent::Delta {
                        brief_id: brief_id.into(),
                        text: t,
                    });
                }
                CliLine::Tool { name, detail } => {
                    // Separate turns' text so the final reply isn't glued together.
                    if !streamed.is_empty() && !streamed.ends_with('\n') {
                        streamed.push_str("\n\n");
                        self.events.director(&DirectorEvent::Delta {
                            brief_id: brief_id.into(),
                            text: "\n\n".into(),
                        });
                    }
                    self.events.director(&DirectorEvent::Tool {
                        brief_id: brief_id.into(),
                        name,
                        detail,
                    });
                }
                CliLine::Result {
                    text,
                    session_id,
                    cost,
                    is_error,
                    subtype,
                } => result = Some((text, session_id, cost, is_error, subtype)),
                _ => {}
            }
        }
        let status = child.wait().await?;
        let stderr = err_task.await.unwrap_or_default();
        let (text, sid, cost, is_error, subtype) = result.ok_or_else(|| {
            AppError::Other(format!(
                "claude exited ({status}) without a result. {}",
                stderr.lines().last().unwrap_or("")
            ))
        })?;
        let sid = sid.unwrap_or(session);
        let prev = brief.director_cost_usd;
        // total_cost_usd is cumulative for the session; store the running total.
        let total = if cost >= prev { cost } else { prev + cost };
        self.db
            .update_brief_session(brief_id, &sid, "claude-cli", total)?;
        if is_error {
            return Err(AppError::Other(format!(
                "Director stopped: {subtype}. {}",
                if text.is_empty() { &stderr } else { &text }
            )));
        }
        Ok((
            if text.trim().is_empty() {
                streamed
            } else {
                text
            },
            total - prev,
        ))
    }

    async fn turn_api(
        &self,
        brief_id: &str,
        prompt: &str,
        attachments: &[String],
    ) -> AppResult<(String, f64)> {
        let key = self
            .secrets
            .get(ANTHROPIC)?
            .ok_or_else(|| AppError::Other("No Anthropic API key saved.".into()))?;
        let hist_path = self.work_dir.join(format!("api_history_{brief_id}.json"));
        std::fs::create_dir_all(&self.work_dir)?;
        // Append-only history: assistant content is replayed exactly as returned.
        let mut messages: Vec<Value> = std::fs::read_to_string(&hist_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let mut content = Vec::new();
        for a in attachments {
            let p = Path::new(a);
            let ct = mime_guess::from_path(p).first_raw().unwrap_or("");
            if matches!(ct, "image/png" | "image/jpeg" | "image/webp" | "image/gif") {
                let bytes = tokio::fs::read(p).await?;
                use base64_lite::encode;
                content.push(json!({"type":"image","source":{"type":"base64","media_type":ct,"data":encode(&bytes)}}));
            }
        }
        content.push(json!({"type":"text","text":prompt}));
        messages.push(json!({"role":"user","content":content}));

        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(600))
            .build()?;
        let system = self.system_prompt()?;
        let mut cost = 0.0;
        let text = loop {
            let body = json!({
                "model": MODEL,
                "max_tokens": 16000,
                "system": [{"type":"text","text":system,"cache_control":{"type":"ephemeral"}}],
                "output_config": {"effort": "medium"},
                "fallbacks": "default",
                "tools": [
                    {"type":"web_search_20260209","name":"web_search","max_uses":5},
                    {"type":"web_fetch_20260209","name":"web_fetch","max_uses":5,"allowed_domains":["higgsfield.ai","docs.higgsfield.ai"]}
                ],
                "messages": messages,
            });
            let resp = http
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &key)
                .header("anthropic-version", "2026-10-21")
                .header("anthropic-beta", "server-side-fallback-2026-07-01")
                .json(&body)
                .send()
                .await?;
            let code = resp.status().as_u16();
            let v: Value = resp.json().await?;
            if code != 200 {
                let msg = v
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("request failed");
                return Err(AppError::Other(format!("Anthropic API {code}: {msg}")));
            }
            cost += api_cost(&v);
            let blocks = v.get("content").cloned().unwrap_or(json!([]));
            messages.push(json!({"role":"assistant","content":blocks.clone()}));
            for b in blocks.as_array().into_iter().flatten() {
                if b.get("type").and_then(Value::as_str) == Some("server_tool_use") {
                    let detail = b
                        .pointer("/input/query")
                        .or_else(|| b.pointer("/input/url"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    self.events.director(&DirectorEvent::Tool {
                        brief_id: brief_id.into(),
                        name: b
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("tool")
                            .into(),
                        detail: detail.into(),
                    });
                }
            }
            match v.get("stop_reason").and_then(Value::as_str) {
                Some("pause_turn") => continue,
                Some("refusal") => {
                    std::fs::write(&hist_path, serde_json::to_string(&messages)?)?;
                    return Err(AppError::Other(
                        "The director declined this request.".into(),
                    ));
                }
                _ => {
                    let t: String = blocks
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                        .filter_map(|b| b.get("text").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join("");
                    break t;
                }
            }
        };
        std::fs::write(&hist_path, serde_json::to_string(&messages)?)?;
        self.events.director(&DirectorEvent::Delta {
            brief_id: brief_id.into(),
            text: text.clone(),
        });
        let brief = self.db.brief(brief_id)?;
        self.db.update_brief_session(
            brief_id,
            brief_id,
            "anthropic-api",
            brief.director_cost_usd + cost,
        )?;
        Ok((text, cost))
    }
}

/// Rough cost from usage at Opus 5.5 list prices ($4 / $20 per MTok, cache reads $0.20).
fn api_cost(v: &Value) -> f64 {
    let u = |k: &str| {
        v.pointer(&format!("/usage/{k}"))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    (u("input_tokens") * 4.0
        + u("cache_creation_input_tokens") * 5.0
        + u("cache_read_input_tokens") * 0.2
        + u("output_tokens") * 20.0)
        / 1e6
}

#[cfg(unix)]
unsafe fn libc_kill(pid: i32) {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, 15);
}

mod base64_lite {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    pub fn encode(b: &[u8]) -> String {
        let mut o = String::with_capacity(b.len().div_ceil(3) * 4);
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16
                | (*c.get(1).unwrap_or(&0) as u32) << 8
                | *c.get(2).unwrap_or(&0) as u32;
            o.push(T[(n >> 18) as usize & 63] as char);
            o.push(T[(n >> 12) as usize & 63] as char);
            o.push(if c.len() > 1 {
                T[(n >> 6) as usize & 63] as char
            } else {
                '='
            });
            o.push(if c.len() > 2 {
                T[n as usize & 63] as char
            } else {
                '='
            });
        }
        o
    }
    #[test]
    fn b64() {
        assert_eq!(encode(b"Man"), "TWFu");
        assert_eq!(encode(b"Ma"), "TWE=");
        assert_eq!(encode(b"M"), "TQ==");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reg() -> Registry {
        Registry::parse(include_str!("../../models.json")).unwrap()
    }

    const REPLY: &str = r#"Here's the plan.

```shotlist
{"shots":[
 {"title":"Oats pour","model_id":"bytedance/seedance-2.5/text-to-video","params":{"prompt":"macro oats pouring"},"why":"fluid motion","cheaper":"wan/v2.7/text-to-video"},
 {"title":"Pack reveal","model_id":"kling-video/v3.0/pro/image-to-video","params":{"prompt":"slow push-in","image_url":"@pack.png","duration":5},"needs":["pack.png"]}
]}
```
"#;

    #[test]
    fn extracts_and_validates_shot_list() {
        let mut shots = extract_shot_list(REPLY).unwrap().unwrap();
        assert_eq!(shots.len(), 2);
        assert_eq!(shots[1].needs, vec!["pack.png"]);
        let ok = validate_shots(&reg(), &mut shots);
        assert!(
            ok,
            "{:?}",
            shots.iter().map(|s| &s.issues).collect::<Vec<_>>()
        );
        assert!(shots[1].model_name.is_some());
    }

    #[test]
    fn flags_invalid_shots_and_builds_repair_prompt() {
        let text = "```shotlist\n[{\"title\":\"x\",\"model_id\":\"kling-video/v3.0/pro/image-to-video\",\"params\":{\"duration\":40}},{\"title\":\"y\",\"model_id\":\"made/up\"}]\n```";
        let mut shots = extract_shot_list(text).unwrap().unwrap();
        assert!(!validate_shots(&reg(), &mut shots));
        let p = repair_prompt(&shots);
        assert!(p.contains("shot 1") && p.contains("duration") && p.contains("image_url"));
        assert!(p.contains("unknown model 'made/up'"));
    }

    #[test]
    fn no_shot_list_and_bad_json() {
        assert!(extract_shot_list("Just a question: who is the audience?").is_none());
        assert!(extract_shot_list("```shotlist\n{not json}\n```")
            .unwrap()
            .is_err());
        assert!(
            extract_shot_list("```shotlist\n{\"shots\":[{\"title\":1}]}\n```")
                .unwrap()
                .is_err()
        );
        // A plain json block without model_id is not a shot list.
        assert!(extract_shot_list("```json\n{\"a\":1}\n```").is_none());
    }

    #[test]
    fn parses_cli_stream_lines() {
        assert_eq!(
            parse_cli_line(r#"{"type":"system","subtype":"init","session_id":"s1"}"#),
            CliLine::Init {
                session_id: "s1".into()
            }
        );
        assert_eq!(
            parse_cli_line(
                r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}}"#
            ),
            CliLine::Delta("Hi".into())
        );
        assert_eq!(
            parse_cli_line(
                r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"WebSearch","input":{"query":"kling 3 tips"}}]}}"#
            ),
            CliLine::Tool {
                name: "WebSearch".into(),
                detail: "kling 3 tips".into()
            }
        );
        match parse_cli_line(
            r#"{"type":"result","subtype":"success","is_error":false,"result":"done","session_id":"s1","total_cost_usd":0.12}"#,
        ) {
            CliLine::Result {
                text,
                cost,
                is_error,
                ..
            } => {
                assert_eq!(text, "done");
                assert!(!is_error);
                assert!((cost - 0.12).abs() < 1e-9);
            }
            o => panic!("{o:?}"),
        }
        assert_eq!(parse_cli_line("not json"), CliLine::Other);
    }

    #[test]
    fn auth_status() {
        assert_eq!(
            parse_auth_status(r#"{"loggedIn":true,"authMethod":"claude.ai"}"#, true),
            (true, Some("claude.ai".into()))
        );
        assert_eq!(parse_auth_status(r#"{"loggedIn":false}"#, false).0, false);
        assert_eq!(parse_auth_status("", true).0, true);
    }
}
