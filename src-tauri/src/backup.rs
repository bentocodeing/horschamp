//! Daily copies of the SQLite database, so job history and spending survive a bad file.

use crate::db::Db;
use crate::error::AppResult;
use chrono::NaiveDate;
use std::path::{Path, PathBuf};

pub const KEEP_DAYS: usize = 7;
const PREFIX: &str = "studio-";
const SUFFIX: &str = ".db";

/// Copy the database to `dir/studio-YYYY-MM-DD.db` once per day, then keep only the newest
/// `keep` copies. An existing copy for `today` is never overwritten, so a file that went bad
/// today cannot replace a good backup. Returns the path written, if any.
pub fn daily(db: &Db, dir: &Path, today: NaiveDate, keep: usize) -> AppResult<Option<PathBuf>> {
    std::fs::create_dir_all(dir)?;
    let target = dir.join(format!("{PREFIX}{}{SUFFIX}", today.format("%Y-%m-%d")));
    let written = if target.exists() {
        None
    } else {
        // Write to a temp name first so a crash never leaves a half-written backup.
        let tmp = target.with_extension("db.tmp");
        let _ = std::fs::remove_file(&tmp);
        db.copy_to(&tmp)?;
        std::fs::rename(&tmp, &target)?;
        Some(target)
    };
    prune(dir, keep)?;
    Ok(written)
}

fn prune(dir: &Path, keep: usize) -> AppResult<()> {
    let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .and_then(|n| n.strip_prefix(PREFIX)?.strip_suffix(SUFFIX))
                .is_some_and(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").is_ok())
        })
        .collect();
    // Dated names sort chronologically.
    backups.sort();
    let extra = backups.len().saturating_sub(keep);
    for old in &backups[..extra] {
        std::fs::remove_file(old)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 11, d).unwrap()
    }

    #[test]
    fn writes_one_copy_per_day_and_keeps_the_newest() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Db::memory().unwrap();
        db.set_setting("starting_balance_usd", "1000").unwrap();

        for d in 1..=9 {
            assert!(daily(&db, tmp.path(), day(d), 3).unwrap().is_some());
        }
        // Second run on the same day does not overwrite.
        assert!(daily(&db, tmp.path(), day(9), 3).unwrap().is_none());

        let mut names: Vec<String> = std::fs::read_dir(tmp.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(
            names,
            [
                "studio-2026-11-07.db",
                "studio-2026-11-08.db",
                "studio-2026-11-09.db"
            ]
        );

        let copy = Db::open(&tmp.path().join("studio-2026-11-09.db")).unwrap();
        assert_eq!(
            copy.setting("starting_balance_usd").unwrap().as_deref(),
            Some("1000")
        );
    }

    #[test]
    fn leaves_unrelated_files_alone() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("notes.txt"), "keep me").unwrap();
        std::fs::write(tmp.path().join("studio-old.db"), "keep me").unwrap();
        let db = Db::memory().unwrap();
        daily(&db, tmp.path(), day(1), 1).unwrap();
        daily(&db, tmp.path(), day(2), 1).unwrap();
        assert!(tmp.path().join("notes.txt").exists());
        assert!(tmp.path().join("studio-old.db").exists());
        assert!(!tmp.path().join("studio-2026-11-01.db").exists());
        assert!(tmp.path().join("studio-2026-11-02.db").exists());
    }
}
