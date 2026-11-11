//! Silver Skies network layer. All API clients live here; nothing in this crate
//! touches the UI. Each client is a thin async function over a shared
//! `reqwest::Client` and returns `ss_core` types.
//!
//! Every client is split into a pure `parse_*` function (unit tested with
//! inlined fixtures) and a thin async fetcher.
//!
//! Alerts leave this crate *unclassified*: `class` is empty (or, for ECCC, the
//! raw `risk_colour_en` value) and `display_event` equals `event`. The app
//! layer runs the classifier.

pub mod eccc;
pub mod librewxr;
pub mod ncep;
pub mod nwr;
pub mod nws;
pub mod openmeteo;
pub mod owm;
pub mod spc;
pub mod willyweather;

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

pub const USER_AGENT: &str =
    "SilverSkies/2.0 (desktop app; https://github.com/poliberry/silverskies-desktop)";

#[derive(Debug, thiserror::Error)]
pub enum NetError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("unexpected status {status} from {url}")]
    Status { url: String, status: u16 },
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("parse error: {0}")]
    Parse(String),
    #[error("missing field: {0}")]
    Missing(&'static str),
}

pub type Result<T> = std::result::Result<T, NetError>;

/// Shared HTTP client plus the configured LibreWXR host.
#[derive(Clone)]
pub struct Net {
    client: reqwest::Client,
    pub libre_wxr_host: String,
}

impl Net {
    pub fn new(libre_wxr_host: &str) -> Result<Net> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()?;
        Ok(Net {
            client,
            libre_wxr_host: libre_wxr_host.trim_end_matches('/').to_string(),
        })
    }

    async fn send(&self, url: &str, accept: Option<&str>) -> Result<reqwest::Response> {
        tracing::debug!(url, "GET");
        let mut req = self.client.get(url);
        if let Some(a) = accept {
            req = req.header(reqwest::header::ACCEPT, a);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(NetError::Status {
                url: url.to_string(),
                status: status.as_u16(),
            });
        }
        Ok(resp)
    }

    pub async fn get_text(&self, url: &str, accept: Option<&str>) -> Result<String> {
        Ok(self.send(url, accept).await?.text().await?)
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        url: &str,
        accept: Option<&str>,
    ) -> Result<T> {
        let text = self.get_text(url, accept).await?;
        Ok(serde_json::from_str(&text)?)
    }

    pub async fn get_bytes(&self, url: &str, accept: Option<&str>) -> Result<Vec<u8>> {
        Ok(self.send(url, accept).await?.bytes().await?.to_vec())
    }
}

// ---------------------------------------------------------------------------
// Private helpers shared by the clients
// ---------------------------------------------------------------------------

pub(crate) const GEO_JSON: &str = "application/geo+json";

pub(crate) fn parse_value(json: &str) -> Result<Value> {
    Ok(serde_json::from_str(json)?)
}

/// Non-empty trimmed string field.
pub(crate) fn jstr(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Number field, tolerating numeric strings.
pub(crate) fn jf64(v: &Value, key: &str) -> Option<f64> {
    match v.get(key)? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

/// A timestamp that is either a string or unix seconds.
pub(crate) fn time_str(v: &Value) -> Option<String> {
    match v {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => {
            let secs = n.as_i64()?;
            chrono::DateTime::from_timestamp(secs, 0)
                .map(|d| d.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        }
        _ => None,
    }
}

pub(crate) fn parse_geometry(v: Option<&Value>) -> Option<ss_core::types::Geometry> {
    let v = v?;
    if v.is_null() {
        return None;
    }
    serde_json::from_value(v.clone()).ok()
}

/// Stable (cross-run) FNV-1a hash, hex encoded.
pub(crate) fn stable_hash(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

pub(crate) fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dphi = (lat2 - lat1).to_radians();
    let dl = (lon2 - lon1).to_radians();
    let a = (dphi / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    6371.0088 * 2.0 * a.sqrt().asin()
}

pub(crate) fn enc(s: &str) -> String {
    use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
    utf8_percent_encode(s, NON_ALPHANUMERIC).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_known_distance() {
        // Safford AZ -> Tucson AZ is roughly 150 km.
        let d = haversine_km(32.834, -109.7076, 32.2226, -110.9747);
        assert!((d - 133.0).abs() < 15.0, "{d}");
    }

    #[test]
    fn hash_is_stable() {
        assert_eq!(stable_hash("a"), stable_hash("a"));
        assert_ne!(stable_hash("a"), stable_hash("b"));
    }

    #[test]
    fn time_str_handles_unix() {
        assert_eq!(
            time_str(&serde_json::json!(0)).as_deref(),
            Some("1970-01-01T00:00:00Z")
        );
    }

    #[test]
    fn net_trims_host() {
        let n = Net::new("https://x.test/").unwrap();
        assert_eq!(n.libre_wxr_host, "https://x.test");
    }
}
