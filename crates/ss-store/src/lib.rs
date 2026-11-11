//! Silver Skies persistence layer — JSON files in the OS config directory,
//! written atomically (temp file + rename).

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use ss_core::types::{Config, LocationsFile, SessionFile};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const CONFIG_FILE: &str = "config.json";
pub const LOCATIONS_FILE: &str = "locations.json";
pub const SESSION_FILE: &str = "session.json";
pub const DEDUPE_FILE: &str = "dedupe.json";

/// Default dedupe retention: 7 days.
pub const DEFAULT_DEDUPE_MAX_AGE_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no config directory available on this platform")]
    NoConfigDir,
}

pub type Result<T> = std::result::Result<T, StoreError>;

/// Seen-alert keys with the unix time they were first marked.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Dedupe {
    pub seen: BTreeMap<String, i64>,
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

impl Dedupe {
    /// Record `key` as seen now (keeps the original time if already present).
    pub fn mark(&mut self, key: &str) {
        self.mark_at(key, now_secs());
    }

    pub fn mark_at(&mut self, key: &str, unix_secs: i64) {
        self.seen.entry(key.to_string()).or_insert(unix_secs);
    }

    pub fn has(&self, key: &str) -> bool {
        self.seen.contains_key(key)
    }

    /// Drop entries older than `max_age_secs`.
    pub fn prune(&mut self, max_age_secs: i64) {
        self.prune_at(max_age_secs, now_secs());
    }

    pub fn prune_at(&mut self, max_age_secs: i64, now: i64) {
        self.seen.retain(|_, t| now - *t <= max_age_secs);
    }

    pub fn len(&self) -> usize {
        self.seen.len()
    }

    pub fn is_empty(&self) -> bool {
        self.seen.is_empty()
    }
}

#[derive(Debug, Clone)]
pub struct Store {
    dir: PathBuf,
}

impl Store {
    /// Open the per-user config directory (`.../Silver Skies/config`), creating it.
    pub fn open() -> Result<Store> {
        let dirs = directories::ProjectDirs::from("com", "silverskies", "Silver Skies")
            .ok_or(StoreError::NoConfigDir)?;
        Self::with_dir(dirs.config_dir().to_path_buf())
    }

    /// Use an explicit directory (tests); created if missing.
    pub fn with_dir(dir: PathBuf) -> Result<Store> {
        std::fs::create_dir_all(&dir)?;
        Ok(Store { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    /// Missing or corrupt files yield `T::default()`. Corrupt files are moved
    /// aside to `<name>.corrupt` so the user's data isn't silently overwritten.
    pub fn read<T: DeserializeOwned + Default>(&self, name: &str) -> T {
        let path = self.path(name);
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!("could not read {}: {e}", path.display());
                }
                return T::default();
            }
        };
        match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!("{} is corrupt ({e}); using defaults", path.display());
                let mut bad = path.clone().into_os_string();
                bad.push(".corrupt");
                if let Err(e) = std::fs::rename(&path, PathBuf::from(&bad)) {
                    tracing::warn!("could not set aside corrupt file: {e}");
                }
                T::default()
            }
        }
    }

    /// Atomic write: `<name>.tmp` then rename over the target.
    pub fn write<T: Serialize>(&self, name: &str, value: &T) -> Result<()> {
        let path = self.path(name);
        let mut tmp = path.clone().into_os_string();
        tmp.push(".tmp");
        let tmp = PathBuf::from(tmp);
        std::fs::write(&tmp, serde_json::to_vec_pretty(value)?)?;
        if let Err(first) = std::fs::rename(&tmp, &path) {
            // Some Windows setups refuse to rename over an existing file.
            tracing::debug!("rename failed ({first}); retrying after remove");
            let _ = std::fs::remove_file(&path);
            if let Err(e) = std::fs::rename(&tmp, &path) {
                let _ = std::fs::remove_file(&tmp);
                return Err(e.into());
            }
        }
        Ok(())
    }

    pub fn load_config(&self) -> Config {
        self.read(CONFIG_FILE)
    }
    pub fn save_config(&self, c: &Config) -> Result<()> {
        self.write(CONFIG_FILE, c)
    }
    pub fn load_locations(&self) -> LocationsFile {
        self.read(LOCATIONS_FILE)
    }
    pub fn save_locations(&self, l: &LocationsFile) -> Result<()> {
        self.write(LOCATIONS_FILE, l)
    }
    pub fn load_session(&self) -> SessionFile {
        self.read(SESSION_FILE)
    }
    pub fn save_session(&self, s: &SessionFile) -> Result<()> {
        self.write(SESSION_FILE, s)
    }
    pub fn load_dedupe(&self) -> Dedupe {
        self.read(DEDUPE_FILE)
    }
    pub fn save_dedupe(&self, d: &Dedupe) -> Result<()> {
        self.write(DEDUPE_FILE, d)
    }

    /// Best-effort import of the old Electron app's `config.json` /
    /// `locations.json` from `%APPDATA%\silver-skies-desktop`. Never overwrites
    /// existing files.
    pub fn migrate_legacy(&self) {
        let Ok(appdata) = std::env::var("APPDATA") else {
            return;
        };
        self.migrate_legacy_from(&Path::new(&appdata).join("silver-skies-desktop"));
    }

    pub fn migrate_legacy_from(&self, legacy_dir: &Path) {
        for name in [CONFIG_FILE, LOCATIONS_FILE] {
            let (src, dst) = (legacy_dir.join(name), self.path(name));
            if src.is_file() && !dst.exists() {
                match std::fs::copy(&src, &dst) {
                    Ok(_) => tracing::info!("migrated legacy {name}"),
                    Err(e) => tracing::warn!("legacy migration of {name} failed: {e}"),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::types::{SavedLocation, UnitPref};

    fn store() -> (tempfile::TempDir, Store) {
        let d = tempfile::tempdir().unwrap();
        let s = Store::with_dir(d.path().to_path_buf()).unwrap();
        (d, s)
    }

    #[test]
    fn config_round_trip() {
        let (_d, s) = store();
        let c = Config {
            units: UnitPref::C,
            auto_refresh_minutes: 3,
            ..Config::default()
        };
        s.save_config(&c).unwrap();
        assert_eq!(s.load_config(), c);
        // overwrite works
        let c2 = Config {
            auto_refresh_minutes: 4,
            ..c
        };
        s.save_config(&c2).unwrap();
        assert_eq!(s.load_config(), c2);
    }

    #[test]
    fn locations_and_session_round_trip() {
        let (_d, s) = store();
        let l = LocationsFile {
            saved_locations: vec![SavedLocation {
                id: "a".into(),
                label: "Safford, AZ".into(),
                lat: 32.8,
                lon: -109.7,
                accu_weather_location_key: None,
            }],
            active_location_id: Some("a".into()),
        };
        s.save_locations(&l).unwrap();
        assert_eq!(s.load_locations(), l);
        let sess = SessionFile::default();
        s.save_session(&sess).unwrap();
        assert_eq!(s.load_session(), sess);
    }

    #[test]
    fn missing_is_default() {
        let (_d, s) = store();
        assert_eq!(s.load_config(), Config::default());
        assert_eq!(s.load_locations(), LocationsFile::default());
        assert!(s.load_dedupe().is_empty());
    }

    #[test]
    fn corrupt_is_default_and_set_aside() {
        let (d, s) = store();
        std::fs::write(d.path().join(CONFIG_FILE), "{ not json").unwrap();
        assert_eq!(s.load_config(), Config::default());
        assert!(!d.path().join(CONFIG_FILE).exists());
        assert!(d.path().join("config.json.corrupt").exists());
    }

    #[test]
    fn write_leaves_no_tmp() {
        let (d, s) = store();
        s.save_config(&Config::default()).unwrap();
        s.save_config(&Config::default()).unwrap();
        let names: Vec<String> = std::fs::read_dir(d.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec!["config.json".to_string()]);
    }

    #[test]
    fn camel_case_legacy_json_loads() {
        let (d, s) = store();
        std::fs::write(
            d.path().join(CONFIG_FILE),
            r#"{"units":"C","autoRefreshMinutes":7,"unknownKey":1}"#,
        )
        .unwrap();
        let c = s.load_config();
        assert_eq!(c.units, UnitPref::C);
        assert_eq!(c.auto_refresh_minutes, 7);
    }

    #[test]
    fn dedupe_mark_has_prune() {
        let (_d, s) = store();
        let mut dd = Dedupe::default();
        dd.mark_at("old", 1_000);
        dd.mark_at("new", 900_000);
        dd.mark_at("old", 5); // does not overwrite
        assert!(dd.has("old") && dd.has("new") && !dd.has("zzz"));
        dd.prune_at(
            DEFAULT_DEDUPE_MAX_AGE_SECS,
            1_000 + DEFAULT_DEDUPE_MAX_AGE_SECS + 1,
        );
        assert!(!dd.has("old"));
        assert!(dd.has("new"));
        s.save_dedupe(&dd).unwrap();
        assert_eq!(s.load_dedupe(), dd);
        let mut live = Dedupe::default();
        live.mark("k");
        live.prune(DEFAULT_DEDUPE_MAX_AGE_SECS);
        assert!(live.has("k"));
    }

    #[test]
    fn migrate_copies_only_missing() {
        let (_d, s) = store();
        let legacy = tempfile::tempdir().unwrap();
        std::fs::write(legacy.path().join(CONFIG_FILE), r#"{"units":"C"}"#).unwrap();
        std::fs::write(
            legacy.path().join(LOCATIONS_FILE),
            r#"{"savedLocations":[]}"#,
        )
        .unwrap();
        s.save_locations(&LocationsFile {
            active_location_id: Some("keep".into()),
            ..Default::default()
        })
        .unwrap();
        s.migrate_legacy_from(legacy.path());
        assert_eq!(s.load_config().units, UnitPref::C);
        assert_eq!(
            s.load_locations().active_location_id.as_deref(),
            Some("keep")
        );
    }
}
