//! WillyWeather (Australia) warnings, surfaced as BoM alerts.

use crate::{jstr, parse_value, Net, NetError, Result};
use serde_json::Value;
use ss_core::types::{Alert, AlertSource, Severity};

pub fn search_url(key: &str, lat: f64, lon: f64) -> String {
    format!("https://api.willyweather.com.au/v2/{key}/search.json?lat={lat}&lng={lon}&units=distance:km")
}

pub fn weather_url(key: &str, location_id: u64) -> String {
    format!("https://api.willyweather.com.au/v2/{key}/locations/{location_id}/weather.json?warnings=true")
}

pub fn parse_location_id(json: &str) -> Result<u64> {
    let v = parse_value(json)?;
    v.get("location")
        .and_then(|l| l.get("id"))
        .and_then(Value::as_u64)
        .ok_or(NetError::Missing("location.id"))
}

/// Warning classification -> severity (local copy of the app's table).
pub fn severity_from_classification(classification: &str) -> Severity {
    match classification.trim().to_ascii_lowercase().as_str() {
        "tsunami" | "tornado" | "hurricane" | "typhoon" | "cyclone" | "volcano" | "earthquake" => {
            Severity::Extreme
        }
        "fire" | "flood" | "storm" | "strong-wind" | "wind" | "cold" | "heat" | "blizzard"
        | "avalanche" | "hazmat" => Severity::Severe,
        "marine"
        | "surf"
        | "frost"
        | "fog"
        | "cold-rain"
        | "wind-chill"
        | "road"
        | "dust-smoke-pollution" => Severity::Moderate,
        "farming" | "sheep" => Severity::Minor,
        _ => Severity::Unknown,
    }
}

/// Dates are Australian local `YYYY-MM-DD HH:MM:SS` and kept as-is.
pub fn parse_warnings(json: &str) -> Result<Vec<Alert>> {
    let v = parse_value(json)?;
    let Some(list) = v.get("warnings").and_then(Value::as_array) else {
        return Ok(vec![]);
    };
    let mut out = Vec::new();
    for w in list {
        let code = match w.get("code") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => continue,
        };
        let wt = w.get("warningType");
        let classification = wt
            .and_then(|t| jstr(t, "classification"))
            .unwrap_or_default();
        let event = jstr(w, "name")
            .or_else(|| wt.and_then(|t| jstr(t, "name")))
            .unwrap_or_else(|| "Warning".into());
        let content = w.get("content");
        out.push(Alert {
            id: format!("bom:{code}"),
            source: AlertSource::Bom,
            display_event: event.clone(),
            event,
            class: String::new(),
            headline: content.and_then(|c| jstr(c, "title")),
            description: content.and_then(|c| jstr(c, "text")),
            instruction: None,
            severity: severity_from_classification(&classification),
            area_desc: None,
            onset: jstr(w, "issueDateTime"),
            sent: jstr(w, "issueDateTime"),
            expires: jstr(w, "expireDateTime"),
            issuing_office: Some("Bureau of Meteorology".to_string()),
            url: None,
            geometry: None,
            affected_zones: vec![],
            vtec: None,
        });
    }
    Ok(out)
}

impl Net {
    pub async fn willy_alerts_for_point(
        &self,
        key: &str,
        lat: f64,
        lon: f64,
    ) -> Result<Vec<Alert>> {
        let id = parse_location_id(&self.get_text(&search_url(key, lat, lon), None).await?)?;
        parse_warnings(&self.get_text(&weather_url(key, id), None).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_and_id() {
        assert_eq!(
            search_url("K", -33.9, 151.2),
            "https://api.willyweather.com.au/v2/K/search.json?lat=-33.9&lng=151.2&units=distance:km"
        );
        assert!(weather_url("K", 12).ends_with("/locations/12/weather.json?warnings=true"));
        assert_eq!(
            parse_location_id(r#"{"location":{"id":4950}}"#).unwrap(),
            4950
        );
        assert!(parse_location_id("{}").is_err());
    }

    #[test]
    fn warnings() {
        let j = r#"{"warnings":[{"code":"ABC","name":"Severe Weather Warning","issueDateTime":"2026-01-01 10:00:00",
          "expireDateTime":"2026-01-01 22:00:00","warningType":{"classification":"storm","name":"Storm"},
          "content":{"text":"Damaging winds","title":"Title"}},
          {"code":7,"warningType":{"classification":"sheep","name":"Sheep Graziers"}}]}"#;
        let a = parse_warnings(j).unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].id, "bom:ABC");
        assert_eq!(a[0].severity, Severity::Severe);
        assert_eq!(a[0].expires.as_deref(), Some("2026-01-01 22:00:00"));
        assert_eq!(a[0].description.as_deref(), Some("Damaging winds"));
        assert_eq!(a[1].id, "bom:7");
        assert_eq!(a[1].severity, Severity::Minor);
        assert_eq!(a[1].event, "Sheep Graziers");
        assert!(parse_warnings("{}").unwrap().is_empty());
    }

    #[test]
    fn severity_table() {
        assert_eq!(severity_from_classification("Cyclone"), Severity::Extreme);
        assert_eq!(severity_from_classification("marine"), Severity::Moderate);
        assert_eq!(severity_from_classification("zzz"), Severity::Unknown);
    }
}
