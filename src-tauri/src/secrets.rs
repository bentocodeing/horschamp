//! OS keychain storage. The Higgsfield key is stored as one secret "KEY_ID:KEY_SECRET".
//! Nothing in this module returns a secret to the webview; commands only expose a masked hint.

use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use std::sync::Mutex;

pub const SERVICE: &str = "app.horschamp.desktop";
/// Keychain service used before the rename. Entries found there are moved to `SERVICE`.
const LEGACY_SERVICE: &str = "app.studio.higgsfield-client";
pub const HIGGSFIELD: &str = "higgsfield-api-key";
pub const ANTHROPIC: &str = "anthropic-api-key";

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> AppResult<Option<String>>;
    fn set(&self, account: &str, value: &str) -> AppResult<()>;
    fn delete(&self, account: &str) -> AppResult<()>;
}

pub struct KeyringStore;

impl SecretStore for KeyringStore {
    fn get(&self, account: &str) -> AppResult<Option<String>> {
        if let Some(v) = read_entry(SERVICE, account)? {
            return Ok(Some(v));
        }
        // One-time move from the legacy service name.
        let Some(v) = read_entry(LEGACY_SERVICE, account)? else {
            return Ok(None);
        };
        self.set(account, &v)?;
        if let Ok(old) = keyring::Entry::new(LEGACY_SERVICE, account) {
            let _ = old.delete_credential();
        }
        Ok(Some(v))
    }
    fn set(&self, account: &str, value: &str) -> AppResult<()> {
        let entry =
            keyring::Entry::new(SERVICE, account).map_err(|e| AppError::Keychain(e.to_string()))?;
        entry
            .set_password(value)
            .map_err(|e| AppError::Keychain(e.to_string()))
    }
    fn delete(&self, account: &str) -> AppResult<()> {
        let entry =
            keyring::Entry::new(SERVICE, account).map_err(|e| AppError::Keychain(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::Keychain(e.to_string())),
        }
    }
}

fn read_entry(service: &str, account: &str) -> AppResult<Option<String>> {
    let entry =
        keyring::Entry::new(service, account).map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

/// In-memory store for tests.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, String>>);

impl SecretStore for MemoryStore {
    fn get(&self, account: &str) -> AppResult<Option<String>> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }
    fn set(&self, account: &str, value: &str) -> AppResult<()> {
        self.0.lock().unwrap().insert(account.into(), value.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> AppResult<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

/// Validate and normalise a pasted Higgsfield key. Accepts "id:secret" with optional
/// surrounding whitespace or a leading "Key " prefix.
pub fn normalise_hf_key(raw: &str) -> AppResult<String> {
    let s = raw.trim();
    let s = s.strip_prefix("Key ").unwrap_or(s).trim();
    let (id, secret) = s
        .split_once(':')
        .ok_or_else(|| AppError::Validation("Key must look like KEY_ID:KEY_SECRET".into()))?;
    if id.is_empty()
        || secret.is_empty()
        || id.contains(char::is_whitespace)
        || secret.contains(char::is_whitespace)
    {
        return Err(AppError::Validation(
            "Key must look like KEY_ID:KEY_SECRET".into(),
        ));
    }
    Ok(format!("{id}:{secret}"))
}

/// A hint that is safe to show: last 4 characters of the key id only.
pub fn mask(key: &str) -> String {
    let id = key.split(':').next().unwrap_or("");
    let tail: String = id
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    format!("••••{tail}:••••••••")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_keys() {
        assert_eq!(normalise_hf_key("  Key abc:def \n").unwrap(), "abc:def");
        assert_eq!(normalise_hf_key("abc:de:f").unwrap(), "abc:de:f");
        assert!(normalise_hf_key("nocolon").is_err());
        assert!(normalise_hf_key(":x").is_err());
        assert!(normalise_hf_key("a b:c").is_err());
    }

    #[test]
    fn mask_hides_secret() {
        let m = mask("abcdef123:supersecret");
        assert!(!m.contains("supersecret"));
        assert!(m.contains("f123"));
    }

    #[test]
    fn memory_store_roundtrip() {
        let s = MemoryStore::default();
        assert_eq!(s.get(HIGGSFIELD).unwrap(), None);
        s.set(HIGGSFIELD, "a:b").unwrap();
        assert_eq!(s.get(HIGGSFIELD).unwrap().as_deref(), Some("a:b"));
        s.delete(HIGGSFIELD).unwrap();
        assert_eq!(s.get(HIGGSFIELD).unwrap(), None);
    }
}
