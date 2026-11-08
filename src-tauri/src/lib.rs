pub mod commands;
pub mod db;
pub mod director;
pub mod error;
pub mod hf;
pub mod jobs;
pub mod media;
pub mod registry;
pub mod secrets;

use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tauri::{Emitter, Manager};

pub struct AppState {
    pub db: Arc<db::Db>,
    pub secrets: Arc<dyn secrets::SecretStore>,
    pub registry: Arc<RwLock<registry::Registry>>,
    pub jobs: Arc<jobs::JobManager>,
    pub director: Arc<director::Director>,
    pub bundled_models: PathBuf,
    pub models_override: PathBuf,
    pub bundled_prompt: PathBuf,
    pub data_dir: PathBuf,
}

struct TauriEvents(tauri::AppHandle);

impl jobs::Events for TauriEvents {
    fn job(&self, job: &db::Job) {
        let _ = self.0.emit("job://update", job);
    }
}
impl director::DirectorEvents for TauriEvents {
    fn director(&self, e: &director::DirectorEvent) {
        let _ = self.0.emit("director://event", e);
    }
}

/// The app's previous bundle identifier, used to find data from before the rename.
const LEGACY_IDENTIFIER: &str = "app.studio.higgsfield-client";

pub fn default_library_dir(app: &tauri::AppHandle) -> PathBuf {
    let base = app
        .path()
        .video_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| PathBuf::from("."));
    let current = base.join("Horschamp Library");
    let legacy = base.join("Studio Library");
    if !current.exists() && legacy.is_dir() {
        return legacy;
    }
    current
}

/// Move a folder left under the legacy identifier to its new location, once.
fn migrate_legacy_dir(dir: &std::path::Path) {
    let Some(legacy) = dir.parent().map(|p| p.join(LEGACY_IDENTIFIER)) else {
        return;
    };
    if !dir.exists() && legacy.is_dir() {
        let _ = std::fs::rename(&legacy, dir);
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle().clone();
    let path = app.path();
    let data_dir = path.app_data_dir()?;
    let config_dir = path.app_config_dir()?;
    migrate_legacy_dir(&data_dir);
    migrate_legacy_dir(&config_dir);
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&config_dir)?;

    let res = |name: &str| path.resolve(name, tauri::path::BaseDirectory::Resource);
    let bundled_models = res("models.json")?;
    let bundled_prompt = res("director.md")?;
    let api_notes = res("API_NOTES.md")?;

    // A refreshed registry in app data overrides the bundled one.
    let models_override = data_dir.join("models.json");
    let models_path = if models_override.is_file() {
        models_override.clone()
    } else {
        bundled_models.clone()
    };
    let registry = registry::Registry::parse(&std::fs::read_to_string(&models_path)?)?;
    let registry = Arc::new(RwLock::new(registry));

    // Editable director prompt lives in the config dir.
    let prompt_path = config_dir.join("director.md");
    if !prompt_path.is_file() {
        std::fs::copy(&bundled_prompt, &prompt_path)?;
    }

    let db = Arc::new(db::Db::open(&data_dir.join("studio.db"))?);
    let secrets: Arc<dyn secrets::SecretStore> = Arc::new(secrets::KeyringStore);
    let events = Arc::new(TauriEvents(handle.clone()));

    let library = db
        .setting("library_dir")?
        .map(PathBuf::from)
        .unwrap_or_else(|| default_library_dir(&handle));
    std::fs::create_dir_all(&library)?;
    let _ = app.asset_protocol_scope().allow_directory(&library, true);

    let jobs = jobs::JobManager::new(
        db.clone(),
        secrets.clone(),
        registry.clone(),
        events.clone(),
        library,
        hf::DEFAULT_BASE.to_string(),
        jobs::PollConfig::default(),
    );
    let director = director::Director::new(
        db.clone(),
        secrets.clone(),
        registry.clone(),
        events,
        prompt_path,
        models_path,
        api_notes,
        data_dir.join("director"),
    );

    app.manage(AppState {
        db,
        secrets,
        registry,
        jobs: jobs.clone(),
        director,
        bundled_models,
        models_override,
        bundled_prompt,
        data_dir,
    });

    // Resume polling for jobs that were in flight when the app closed.
    tauri::async_runtime::spawn(async move {
        match jobs.resume_all() {
            Ok(n) if n > 0 => log::info!("resumed {n} jobs"),
            Err(e) => log::warn!("resume failed: {e}"),
            _ => {}
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(setup)
        .invoke_handler(tauri::generate_handler![
            commands::key_status,
            commands::key_set,
            commands::key_test,
            commands::key_delete,
            commands::anthropic_key_set,
            commands::anthropic_key_delete,
            commands::models_list,
            commands::models_preview_import,
            commands::models_apply_import,
            commands::models_reset,
            commands::projects_list,
            commands::project_create,
            commands::project_rename,
            commands::project_delete,
            commands::job_quote,
            commands::job_submit,
            commands::jobs_list,
            commands::job_get,
            commands::job_cancel,
            commands::job_delete,
            commands::library_list,
            commands::asset_favorite,
            commands::asset_delete,
            commands::asset_reveal,
            commands::asset_open,
            commands::preview_allow,
            commands::reveal_path,
            commands::settings_get,
            commands::settings_set,
            commands::spending_summary,
            commands::usage_sync,
            commands::director_status,
            commands::director_prompt_open,
            commands::director_prompt_reset,
            commands::briefs_list,
            commands::brief_create,
            commands::brief_get,
            commands::brief_send,
            commands::brief_cancel,
            commands::brief_rename,
            commands::brief_delete,
            commands::brief_set_shots,
            commands::ffmpeg_status,
            commands::ffmpeg_install,
            commands::timeline_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
