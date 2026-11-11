//! Environment and Climate Change Canada weather alerts (OGC API features).

use crate::{enc, jstr, parse_geometry, parse_value, stable_hash, Net, NetError, Result};
use serde_json::Value;
use ss_core::types::{Alert, AlertSource, Severity};

pub fn alerts_url(lat: f64, lon: f64) -> String {
    let filter = format!("INTERSECTS(geometry,POINT({lon} {lat}))");
    format!(
        "https://api.weather.gc.ca/collections/weather-alerts/items?filter={}&lang=en&f=json&limit=30",
        enc(&filter)
    )
}

pub fn severity_from_colour(colour: &str) -> Severity {
    match colour.trim().to_ascii_lowercase().as_str() {
        "red" => Severity::Extreme,
        "orange" => Severity::Severe,
        "yellow" => Severity::Moderate,
        _ => Severity::Minor,
    }
}

/// `class` holds the raw `risk_colour_en` (e.g. "Red") for the caller to map.
pub fn parse_alerts(json: &str) -> Result<Vec<Alert>> {
    let v = parse_value(json)?;
    let features = v
        .get("features")
        .and_then(Value::as_array)
        .ok_or(NetError::Missing("features"))?;
    let mut out: Vec<Alert> = Vec::new();
    for f in features {
        let Some(p) = f.get("properties") else {
            continue;
        };
        let Some(event) = jstr(p, "alert_name_en") else {
            continue;
        };
        let area = jstr(p, "area_name_en");
        let onset = jstr(p, "validity_datetime");
        let colour = jstr(p, "risk_colour_en").unwrap_or_default();
        let raw_id = jstr(p, "identifier")
            .or_else(|| jstr(p, "id"))
            .or_else(|| jstr(f, "id"));
        let id = format!(
            "eccc:{}",
            raw_id.unwrap_or_else(|| stable_hash(&format!(
                "{}|{}|{}",
                event,
                area.as_deref().unwrap_or(""),
                onset.as_deref().unwrap_or("")
            )))
        );
        if out.iter().any(|a| a.id == id) {
            continue;
        }
        out.push(Alert {
            id,
            source: AlertSource::Eccc,
            display_event: event.clone(),
            event,
            class: colour.clone(),
            headline: jstr(p, "impact_en"),
            description: jstr(p, "alert_text_en"),
            instruction: None,
            severity: severity_from_colour(&colour),
            area_desc: area,
            onset: onset.clone(),
            sent: onset,
            expires: jstr(p, "expiration_datetime"),
            issuing_office: Some("Environment Canada".to_string()),
            url: None,
            geometry: parse_geometry(f.get("geometry")),
            affected_zones: vec![],
            vtec: None,
        });
    }
    Ok(out)
}

impl Net {
    pub async fn eccc_alerts_for_point(&self, lat: f64, lon: f64) -> Result<Vec<Alert>> {
        parse_alerts(
            &self
                .get_text(&alerts_url(lat, lon), Some("application/json"))
                .await?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_is_encoded() {
        let u = alerts_url(51.05, -114.07);
        assert!(
            u.contains("filter=INTERSECTS%28geometry%2CPOINT%28%2D114%2E07%2051%2E05%29%29"),
            "{u}"
        );
        assert!(u.ends_with("&lang=en&f=json&limit=30"));
    }

    #[test]
    fn parse_item() {
        let j = r#"{"features":[{"id":"abc","geometry":null,"properties":{
          "alert_name_en":"red warning - tornado","alert_text_en":"Take shelter","validity_datetime":"2026-06-01T20:00:00Z",
          "expiration_datetime":"2026-06-01T22:00:00Z","impact_en":"High","risk_colour_en":"Red","area_name_en":"Calgary","identifier":"ID1"}},
          {"properties":{"alert_name_en":"yellow watch","risk_colour_en":"Yellow","area_name_en":"X","validity_datetime":"t"}}]}"#;
        let a = parse_alerts(j).unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].id, "eccc:ID1");
        assert_eq!(a[0].class, "Red");
        assert_eq!(a[0].severity, Severity::Extreme);
        assert_eq!(a[0].area_desc.as_deref(), Some("Calgary"));
        assert_eq!(a[0].expires.as_deref(), Some("2026-06-01T22:00:00Z"));
        assert_eq!(a[1].severity, Severity::Moderate);
        assert!(a[1].id.starts_with("eccc:") && a[1].id.len() > 10);
    }

    #[test]
    fn colours() {
        assert_eq!(severity_from_colour("Orange"), Severity::Severe);
        assert_eq!(severity_from_colour("grey"), Severity::Minor);
    }
}
