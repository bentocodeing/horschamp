//! SQLite metadata store. Media files live in the library folder; this holds the index.

use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::sync::Mutex;

pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  category TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  params_json TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  request_id TEXT,
  idempotency_key TEXT NOT NULL,
  est_usd REAL,
  cost_usd REAL,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'generate',
  brief_id TEXT,
  shot_index INTEGER,
  retry_of TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id, created_at);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  project_id TEXT,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  remote_url TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_job ON assets(job_id);
CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  session_id TEXT,
  backend TEXT,
  shots_json TEXT NOT NULL DEFAULT '[]',
  director_cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brief_messages (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS brief_messages_brief ON brief_messages(brief_id, created_at);
CREATE TABLE IF NOT EXISTS uploads (
  sha256 TEXT PRIMARY KEY, public_url TEXT NOT NULL, content_type TEXT NOT NULL, uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, synced_at TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL,
  total_usd REAL NOT NULL, by_model_json TEXT NOT NULL
);
"#];

pub struct Db(Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Attachment {
    pub path: String,
    pub param: String,
    #[serde(default)]
    pub public_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Job {
    pub id: String,
    pub project_id: Option<String>,
    pub model_id: String,
    pub model_name: String,
    pub category: String,
    pub prompt: String,
    pub params: Value,
    pub attachments: Vec<Attachment>,
    pub status: String,
    pub request_id: Option<String>,
    pub idempotency_key: String,
    pub est_usd: Option<f64>,
    pub cost_usd: Option<f64>,
    pub error: Option<String>,
    pub source: String,
    pub brief_id: Option<String>,
    pub shot_index: Option<i64>,
    pub retry_of: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
    #[serde(default)]
    pub assets: Vec<Asset>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Asset {
    pub id: String,
    pub job_id: String,
    pub project_id: Option<String>,
    pub kind: String,
    pub path: String,
    pub remote_url: Option<String>,
    pub favorite: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Brief {
    pub id: String,
    pub project_id: Option<String>,
    pub title: String,
    pub session_id: Option<String>,
    pub backend: Option<String>,
    pub shots: Value,
    pub director_cost_usd: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BriefMessage {
    pub id: String,
    pub brief_id: String,
    pub role: String,
    pub text: String,
    pub attachments: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LibraryFilter {
    pub kind: Option<String>,
    pub project_id: Option<String>,
    pub model_id: Option<String>,
    pub favorites: Option<bool>,
    pub search: Option<String>,
    pub since: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibraryItem {
    pub asset: Asset,
    pub job: Job,
}

const JOB_COLS: &str = "id, project_id, model_id, model_name, category, prompt, params_json, attachments_json, status, request_id, idempotency_key, est_usd, cost_usd, error, source, brief_id, shot_index, retry_of, created_at, updated_at, finished_at";

fn job_from_row(r: &Row) -> rusqlite::Result<Job> {
    let params: String = r.get(6)?;
    let atts: String = r.get(7)?;
    Ok(Job {
        id: r.get(0)?,
        project_id: r.get(1)?,
        model_id: r.get(2)?,
        model_name: r.get(3)?,
        category: r.get(4)?,
        prompt: r.get(5)?,
        params: serde_json::from_str(&params).unwrap_or(Value::Null),
        attachments: serde_json::from_str(&atts).unwrap_or_default(),
        status: r.get(8)?,
        request_id: r.get(9)?,
        idempotency_key: r.get(10)?,
        est_usd: r.get(11)?,
        cost_usd: r.get(12)?,
        error: r.get(13)?,
        source: r.get(14)?,
        brief_id: r.get(15)?,
        shot_index: r.get(16)?,
        retry_of: r.get(17)?,
        created_at: r.get(18)?,
        updated_at: r.get(19)?,
        finished_at: r.get(20)?,
        assets: vec![],
    })
}

const ASSET_COLS: &str =
    "a.id, a.job_id, a.project_id, a.kind, a.path, a.remote_url, a.favorite, a.created_at";

fn asset_from_row(r: &Row, off: usize) -> rusqlite::Result<Asset> {
    Ok(Asset {
        id: r.get(off)?,
        job_id: r.get(off + 1)?,
        project_id: r.get(off + 2)?,
        kind: r.get(off + 3)?,
        path: r.get(off + 4)?,
        remote_url: r.get(off + 5)?,
        favorite: r.get::<_, i64>(off + 6)? != 0,
        created_at: r.get(off + 7)?,
    })
}

fn brief_from_row(r: &Row) -> rusqlite::Result<Brief> {
    let shots: String = r.get(5)?;
    Ok(Brief {
        id: r.get(0)?,
        project_id: r.get(1)?,
        title: r.get(2)?,
        session_id: r.get(3)?,
        backend: r.get(4)?,
        shots: serde_json::from_str(&shots).unwrap_or(Value::Array(vec![])),
        director_cost_usd: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

pub const TERMINAL: &[&str] = &["completed", "failed", "nsfw", "canceled"];
pub const ACTIVE: &[&str] = &["submitting", "queued", "running", "downloading"];

impl Db {
    pub fn open(path: &Path) -> AppResult<Db> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        Self::init(Connection::open(path)?)
    }

    pub fn memory() -> AppResult<Db> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> AppResult<Db> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        for (i, m) in MIGRATIONS.iter().enumerate().skip(version as usize) {
            conn.execute_batch(m)?;
            conn.pragma_update(None, "user_version", (i + 1) as i64)?;
        }
        Ok(Db(Mutex::new(conn)))
    }

    /// Write a consistent copy of the whole database to `path` (which must not exist).
    pub fn copy_to(&self, path: &Path) -> AppResult<()> {
        let p = path
            .to_str()
            .ok_or_else(|| AppError::Other("backup path is not valid UTF-8".into()))?;
        self.c().execute("VACUUM INTO ?1", [p])?;
        Ok(())
    }

    fn c(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }

    // ---- settings ----
    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        Ok(self
            .c()
            .query_row("SELECT value FROM settings WHERE key=?", [key], |r| {
                r.get(0)
            })
            .optional()?)
    }
    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.c().execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value])?;
        Ok(())
    }

    // ---- projects ----
    pub fn projects(&self) -> AppResult<Vec<Project>> {
        let c = self.c();
        let mut st = c.prepare("SELECT id,name,created_at FROM projects ORDER BY created_at")?;
        let rows = st.query_map([], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                created_at: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
    pub fn create_project(&self, name: &str) -> AppResult<Project> {
        let p = Project {
            id: new_id(),
            name: name.trim().to_string(),
            created_at: now(),
        };
        if p.name.is_empty() {
            return Err(AppError::Validation("Project name is empty".into()));
        }
        self.c().execute(
            "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
            params![p.id, p.name, p.created_at],
        )?;
        Ok(p)
    }
    pub fn rename_project(&self, id: &str, name: &str) -> AppResult<()> {
        self.c().execute(
            "UPDATE projects SET name=? WHERE id=?",
            params![name.trim(), id],
        )?;
        Ok(())
    }
    /// Deletes the project record; its jobs and assets stay in the library unassigned.
    pub fn delete_project(&self, id: &str) -> AppResult<()> {
        let c = self.c();
        c.execute("UPDATE jobs SET project_id=NULL WHERE project_id=?", [id])?;
        c.execute("UPDATE assets SET project_id=NULL WHERE project_id=?", [id])?;
        c.execute("UPDATE briefs SET project_id=NULL WHERE project_id=?", [id])?;
        c.execute("DELETE FROM projects WHERE id=?", [id])?;
        Ok(())
    }

    // ---- jobs ----
    pub fn insert_job(&self, j: &Job) -> AppResult<()> {
        self.c().execute(
            &format!(
                "INSERT INTO jobs({JOB_COLS}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
            ),
            params![
                j.id,
                j.project_id,
                j.model_id,
                j.model_name,
                j.category,
                j.prompt,
                j.params.to_string(),
                serde_json::to_string(&j.attachments)?,
                j.status,
                j.request_id,
                j.idempotency_key,
                j.est_usd,
                j.cost_usd,
                j.error,
                j.source,
                j.brief_id,
                j.shot_index,
                j.retry_of,
                j.created_at,
                j.updated_at,
                j.finished_at
            ],
        )?;
        Ok(())
    }

    pub fn job(&self, id: &str) -> AppResult<Job> {
        let mut j = self
            .c()
            .query_row(
                &format!("SELECT {JOB_COLS} FROM jobs WHERE id=?"),
                [id],
                job_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("job {id}")))?;
        j.assets = self.assets_for_job(id)?;
        Ok(j)
    }

    pub fn jobs(&self, project_id: Option<&str>, limit: i64) -> AppResult<Vec<Job>> {
        let mut jobs = {
            let c = self.c();
            let mut st = c.prepare(&format!(
                "SELECT {JOB_COLS} FROM jobs WHERE (?1 IS NULL OR project_id=?1) ORDER BY created_at DESC LIMIT ?2"
            ))?;
            let rows = st.query_map(params![project_id, limit], job_from_row)?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for j in &mut jobs {
            j.assets = self.assets_for_job(&j.id)?;
        }
        Ok(jobs)
    }

    pub fn active_jobs(&self) -> AppResult<Vec<Job>> {
        let c = self.c();
        let mut st = c.prepare(&format!(
            "SELECT {JOB_COLS} FROM jobs WHERE status IN ('submitting','queued','running','downloading') ORDER BY created_at"
        ))?;
        let rows = st.query_map([], job_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn set_job_submitted(&self, id: &str, request_id: &str) -> AppResult<()> {
        self.c().execute(
            "UPDATE jobs SET request_id=?, status='queued', updated_at=? WHERE id=?",
            params![request_id, now(), id],
        )?;
        Ok(())
    }

    pub fn set_job_status(&self, id: &str, status: &str, error: Option<&str>) -> AppResult<()> {
        let finished = TERMINAL.contains(&status).then(now);
        self.c().execute(
            "UPDATE jobs SET status=?, error=COALESCE(?, error), updated_at=?, finished_at=COALESCE(?, finished_at) WHERE id=?",
            params![status, error, now(), finished, id],
        )?;
        Ok(())
    }

    pub fn set_job_cost(&self, id: &str, cost: Option<f64>) -> AppResult<()> {
        self.c()
            .execute("UPDATE jobs SET cost_usd=? WHERE id=?", params![cost, id])?;
        Ok(())
    }

    pub fn set_job_attachments(
        &self,
        id: &str,
        atts: &[Attachment],
        params_json: &Value,
    ) -> AppResult<()> {
        self.c().execute(
            "UPDATE jobs SET attachments_json=?, params_json=?, updated_at=? WHERE id=?",
            params![
                serde_json::to_string(atts)?,
                params_json.to_string(),
                now(),
                id
            ],
        )?;
        Ok(())
    }

    pub fn delete_job(&self, id: &str) -> AppResult<Vec<Asset>> {
        let assets = self.assets_for_job(id)?;
        let c = self.c();
        c.execute("DELETE FROM assets WHERE job_id=?", [id])?;
        c.execute("DELETE FROM jobs WHERE id=?", [id])?;
        Ok(assets)
    }

    // ---- assets ----
    pub fn insert_asset(&self, a: &Asset) -> AppResult<()> {
        self.c().execute(
            "INSERT INTO assets(id,job_id,project_id,kind,path,remote_url,favorite,created_at) VALUES(?,?,?,?,?,?,?,?)",
            params![a.id, a.job_id, a.project_id, a.kind, a.path, a.remote_url, a.favorite as i64, a.created_at],
        )?;
        Ok(())
    }

    pub fn assets_for_job(&self, job_id: &str) -> AppResult<Vec<Asset>> {
        let c = self.c();
        let mut st = c.prepare(&format!(
            "SELECT {ASSET_COLS} FROM assets a WHERE job_id=? ORDER BY created_at, path"
        ))?;
        let rows = st.query_map([job_id], |r| asset_from_row(r, 0))?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    pub fn asset(&self, id: &str) -> AppResult<Asset> {
        self.c()
            .query_row(
                &format!("SELECT {ASSET_COLS} FROM assets a WHERE id=?"),
                [id],
                |r| asset_from_row(r, 0),
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("asset {id}")))
    }

    pub fn set_favorite(&self, id: &str, fav: bool) -> AppResult<()> {
        self.c().execute(
            "UPDATE assets SET favorite=? WHERE id=?",
            params![fav as i64, id],
        )?;
        Ok(())
    }

    pub fn delete_asset(&self, id: &str) -> AppResult<Asset> {
        let a = self.asset(id)?;
        self.c().execute("DELETE FROM assets WHERE id=?", [id])?;
        Ok(a)
    }

    pub fn library(&self, f: &LibraryFilter) -> AppResult<Vec<LibraryItem>> {
        let c = self.c();
        let search = f
            .search
            .as_ref()
            .filter(|s| !s.trim().is_empty())
            .map(|s| format!("%{}%", s.trim()));
        let sql = format!(
            "SELECT {ASSET_COLS}, j.{} FROM assets a JOIN jobs j ON j.id=a.job_id
             WHERE (?1 IS NULL OR a.kind=?1) AND (?2 IS NULL OR a.project_id=?2) AND (?3 IS NULL OR j.model_id=?3)
               AND (?4 = 0 OR a.favorite=1) AND (?5 IS NULL OR j.prompt LIKE ?5) AND (?6 IS NULL OR a.created_at >= ?6)
             ORDER BY a.created_at DESC LIMIT ?7",
            JOB_COLS.replace(", ", ", j.")
        );
        let mut st = c.prepare(&sql)?;
        let rows = st.query_map(
            params![
                f.kind,
                f.project_id,
                f.model_id,
                f.favorites.unwrap_or(false) as i64,
                search,
                f.since,
                f.limit.unwrap_or(500)
            ],
            |r| {
                let asset = asset_from_row(r, 0)?;
                // job columns start after the 8 asset columns
                let job = job_from_row_offset(r, 8)?;
                Ok(LibraryItem { asset, job })
            },
        )?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    // ---- spending ----
    /// Sum of local cost for completed jobs (actual if known, else estimate) since `since`.
    pub fn local_spend(&self, since: Option<&str>) -> AppResult<f64> {
        Ok(self.c().query_row(
            "SELECT COALESCE(SUM(COALESCE(cost_usd, est_usd, 0)),0) FROM jobs WHERE status='completed' AND (?1 IS NULL OR finished_at >= ?1)",
            [since],
            |r| r.get(0),
        )?)
    }

    pub fn record_usage_sync(
        &self,
        start: &str,
        end: &str,
        total: f64,
        by_model: &Value,
    ) -> AppResult<()> {
        self.c().execute(
            "INSERT INTO usage_syncs(synced_at,start,end,total_usd,by_model_json) VALUES(?,?,?,?,?)",
            params![now(), start, end, total, by_model.to_string()],
        )?;
        Ok(())
    }

    pub fn last_usage_sync(&self) -> AppResult<Option<(String, String, String, f64)>> {
        Ok(self
            .c()
            .query_row(
                "SELECT synced_at,start,end,total_usd FROM usage_syncs ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?)
    }

    // ---- uploads cache ----
    pub fn cached_upload(&self, sha: &str, max_age_secs: i64) -> AppResult<Option<String>> {
        let row: Option<(String, String)> = self
            .c()
            .query_row(
                "SELECT public_url, uploaded_at FROM uploads WHERE sha256=?",
                [sha],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        Ok(row.and_then(|(url, at)| {
            let at = chrono::DateTime::parse_from_rfc3339(&at).ok()?;
            ((chrono::Utc::now() - at.with_timezone(&chrono::Utc)).num_seconds() < max_age_secs)
                .then_some(url)
        }))
    }
    pub fn put_upload(&self, sha: &str, url: &str, ct: &str) -> AppResult<()> {
        self.c().execute(
            "INSERT INTO uploads(sha256,public_url,content_type,uploaded_at) VALUES(?,?,?,?)
             ON CONFLICT(sha256) DO UPDATE SET public_url=excluded.public_url, uploaded_at=excluded.uploaded_at",
            params![sha, url, ct, now()],
        )?;
        Ok(())
    }

    // ---- briefs ----
    pub fn create_brief(&self, project_id: Option<&str>, title: &str) -> AppResult<Brief> {
        let t = now();
        let b = Brief {
            id: new_id(),
            project_id: project_id.map(String::from),
            title: title.to_string(),
            session_id: None,
            backend: None,
            shots: Value::Array(vec![]),
            director_cost_usd: 0.0,
            created_at: t.clone(),
            updated_at: t,
        };
        self.c().execute(
            "INSERT INTO briefs(id,project_id,title,shots_json,created_at,updated_at) VALUES(?,?,?,?,?,?)",
            params![b.id, b.project_id, b.title, "[]", b.created_at, b.updated_at],
        )?;
        Ok(b)
    }
    pub fn briefs(&self, project_id: Option<&str>) -> AppResult<Vec<Brief>> {
        let c = self.c();
        let mut st = c.prepare(
            "SELECT id,project_id,title,session_id,backend,shots_json,director_cost_usd,created_at,updated_at FROM briefs
             WHERE (?1 IS NULL OR project_id=?1) ORDER BY updated_at DESC",
        )?;
        let rows = st.query_map([project_id], brief_from_row)?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
    pub fn brief(&self, id: &str) -> AppResult<Brief> {
        self.c()
            .query_row(
                "SELECT id,project_id,title,session_id,backend,shots_json,director_cost_usd,created_at,updated_at FROM briefs WHERE id=?",
                [id],
                brief_from_row,
            )
            .optional()?
            .ok_or_else(|| AppError::NotFound(format!("brief {id}")))
    }
    pub fn update_brief_session(
        &self,
        id: &str,
        session_id: &str,
        backend: &str,
        total_cost: f64,
    ) -> AppResult<()> {
        self.c().execute(
            "UPDATE briefs SET session_id=?, backend=?, director_cost_usd=?, updated_at=? WHERE id=?",
            params![session_id, backend, total_cost, now(), id],
        )?;
        Ok(())
    }
    pub fn set_brief_shots(&self, id: &str, shots: &Value) -> AppResult<()> {
        self.c().execute(
            "UPDATE briefs SET shots_json=?, updated_at=? WHERE id=?",
            params![shots.to_string(), now(), id],
        )?;
        Ok(())
    }
    pub fn rename_brief(&self, id: &str, title: &str) -> AppResult<()> {
        self.c().execute(
            "UPDATE briefs SET title=?, updated_at=? WHERE id=?",
            params![title, now(), id],
        )?;
        Ok(())
    }
    pub fn delete_brief(&self, id: &str) -> AppResult<()> {
        let c = self.c();
        c.execute("DELETE FROM brief_messages WHERE brief_id=?", [id])?;
        c.execute("DELETE FROM briefs WHERE id=?", [id])?;
        Ok(())
    }
    pub fn add_brief_message(
        &self,
        brief_id: &str,
        role: &str,
        text: &str,
        attachments: &[String],
    ) -> AppResult<BriefMessage> {
        let m = BriefMessage {
            id: new_id(),
            brief_id: brief_id.into(),
            role: role.into(),
            text: text.into(),
            attachments: attachments.to_vec(),
            created_at: now(),
        };
        self.c().execute(
            "INSERT INTO brief_messages(id,brief_id,role,text,attachments_json,created_at) VALUES(?,?,?,?,?,?)",
            params![m.id, m.brief_id, m.role, m.text, serde_json::to_string(&m.attachments)?, m.created_at],
        )?;
        Ok(m)
    }
    pub fn brief_messages(&self, brief_id: &str) -> AppResult<Vec<BriefMessage>> {
        let c = self.c();
        let mut st = c.prepare("SELECT id,brief_id,role,text,attachments_json,created_at FROM brief_messages WHERE brief_id=? ORDER BY created_at, rowid")?;
        let rows = st.query_map([brief_id], |r| {
            let a: String = r.get(4)?;
            Ok(BriefMessage {
                id: r.get(0)?,
                brief_id: r.get(1)?,
                role: r.get(2)?,
                text: r.get(3)?,
                attachments: serde_json::from_str(&a).unwrap_or_default(),
                created_at: r.get(5)?,
            })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }
}

fn job_from_row_offset(r: &Row, off: usize) -> rusqlite::Result<Job> {
    let params: String = r.get(off + 6)?;
    let atts: String = r.get(off + 7)?;
    Ok(Job {
        id: r.get(off)?,
        project_id: r.get(off + 1)?,
        model_id: r.get(off + 2)?,
        model_name: r.get(off + 3)?,
        category: r.get(off + 4)?,
        prompt: r.get(off + 5)?,
        params: serde_json::from_str(&params).unwrap_or(Value::Null),
        attachments: serde_json::from_str(&atts).unwrap_or_default(),
        status: r.get(off + 8)?,
        request_id: r.get(off + 9)?,
        idempotency_key: r.get(off + 10)?,
        est_usd: r.get(off + 11)?,
        cost_usd: r.get(off + 12)?,
        error: r.get(off + 13)?,
        source: r.get(off + 14)?,
        brief_id: r.get(off + 15)?,
        shot_index: r.get(off + 16)?,
        retry_of: r.get(off + 17)?,
        created_at: r.get(off + 18)?,
        updated_at: r.get(off + 19)?,
        finished_at: r.get(off + 20)?,
        assets: vec![],
    })
}

#[cfg(test)]
pub fn sample_job(model: &str) -> Job {
    let t = now();
    Job {
        id: new_id(),
        project_id: None,
        model_id: model.into(),
        model_name: model.into(),
        category: "image".into(),
        prompt: "a lake".into(),
        params: serde_json::json!({"prompt":"a lake"}),
        attachments: vec![],
        status: "submitting".into(),
        request_id: None,
        idempotency_key: new_id(),
        est_usd: Some(0.1),
        cost_usd: None,
        error: None,
        source: "generate".into(),
        brief_id: None,
        shot_index: None,
        retry_of: None,
        created_at: t.clone(),
        updated_at: t,
        finished_at: None,
        assets: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_roundtrip_and_library() {
        let db = Db::memory().unwrap();
        let p = db.create_project("Promo").unwrap();
        let mut j = sample_job("m");
        j.project_id = Some(p.id.clone());
        db.insert_job(&j).unwrap();
        assert_eq!(db.active_jobs().unwrap().len(), 1);
        db.set_job_submitted(&j.id, "r1").unwrap();
        db.set_job_status(&j.id, "completed", None).unwrap();
        assert!(db.active_jobs().unwrap().is_empty());
        let a = Asset {
            id: new_id(),
            job_id: j.id.clone(),
            project_id: j.project_id.clone(),
            kind: "image".into(),
            path: "/tmp/x.png".into(),
            remote_url: None,
            favorite: false,
            created_at: now(),
        };
        db.insert_asset(&a).unwrap();
        db.set_favorite(&a.id, true).unwrap();
        let got = db.job(&j.id).unwrap();
        assert_eq!(got.request_id.as_deref(), Some("r1"));
        assert!(got.finished_at.is_some());
        assert_eq!(got.assets.len(), 1);
        let lib = db
            .library(&LibraryFilter {
                favorites: Some(true),
                search: Some("lake".into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(lib.len(), 1);
        assert_eq!(lib[0].job.id, j.id);
        let none = db
            .library(&LibraryFilter {
                kind: Some("video".into()),
                ..Default::default()
            })
            .unwrap();
        assert!(none.is_empty());
        assert!((db.local_spend(None).unwrap() - 0.1).abs() < 1e-9);
    }

    #[test]
    fn briefs_and_messages() {
        let db = Db::memory().unwrap();
        let b = db.create_brief(None, "Teaser").unwrap();
        db.add_brief_message(&b.id, "user", "hi", &["/a.png".into()])
            .unwrap();
        db.add_brief_message(&b.id, "assistant", "hello", &[])
            .unwrap();
        db.update_brief_session(&b.id, "sess", "claude-cli", 0.02)
            .unwrap();
        db.set_brief_shots(&b.id, &serde_json::json!([{"title":"s1"}]))
            .unwrap();
        let got = db.brief(&b.id).unwrap();
        assert_eq!(got.session_id.as_deref(), Some("sess"));
        assert_eq!(got.shots[0]["title"], "s1");
        let msgs = db.brief_messages(&b.id).unwrap();
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[0].attachments, vec!["/a.png".to_string()]);
    }

    #[test]
    fn settings_and_upload_cache() {
        let db = Db::memory().unwrap();
        assert_eq!(db.setting("x").unwrap(), None);
        db.set_setting("x", "1").unwrap();
        db.set_setting("x", "2").unwrap();
        assert_eq!(db.setting("x").unwrap().as_deref(), Some("2"));
        db.put_upload("abc", "https://cdn/x", "image/png").unwrap();
        assert_eq!(
            db.cached_upload("abc", 3000).unwrap().as_deref(),
            Some("https://cdn/x")
        );
        assert_eq!(db.cached_upload("abc", -1).unwrap(), None);
    }
}
