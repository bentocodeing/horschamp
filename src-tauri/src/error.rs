use serde::Serialize;

/// Errors returned to the webview. Messages never include secrets.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("No Higgsfield API key saved. Add one in Settings.")]
    NoKey,
    #[error("Higgsfield rejected the API key (401).")]
    Unauthorized,
    #[error("Not enough Higgsfield balance for this job (403).")]
    InsufficientBalance,
    #[error("Higgsfield queue is full. Retry after {0}s.")]
    QueueFull(u64),
    #[error("Model is temporarily unavailable ({0}).")]
    ModelBlocked(u16),
    #[error("Higgsfield API error {status}: {detail}")]
    Api { status: u16, detail: String },
    #[error("Invalid parameters: {0}")]
    Validation(String),
    #[error("This job needs your confirmation first.")]
    NeedsConfirmation,
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Keychain error: {0}")]
    Keychain(String),
    #[error("Network error: {0}")]
    Network(String),
    #[error("Database error: {0}")]
    Db(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NoKey => "no_key",
            AppError::Unauthorized => "unauthorized",
            AppError::InsufficientBalance => "insufficient_balance",
            AppError::QueueFull(_) => "queue_full",
            AppError::ModelBlocked(_) => "model_blocked",
            AppError::Api { .. } => "api",
            AppError::Validation(_) => "validation",
            AppError::NeedsConfirmation => "needs_confirmation",
            AppError::NotFound(_) => "not_found",
            AppError::Keychain(_) => "keychain",
            AppError::Network(_) => "network",
            AppError::Db(_) => "db",
            AppError::Io(_) => "io",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("AppError", 2)?;
        st.serialize_field("code", self.code())?;
        st.serialize_field("message", &self.to_string())?;
        st.end()
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Db(e.to_string())
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Other(format!("JSON: {e}"))
    }
}
impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // reqwest errors can include the URL but never headers, so the key cannot leak here.
        AppError::Network(e.without_url().to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
