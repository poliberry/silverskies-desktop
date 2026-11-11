//! LibreWXR: radar/satellite frame index, tile URLs, and bbox alerts.

use crate::{jstr, parse_geometry, parse_value, stable_hash, time_str, Net, NetError, Result};
use serde_json::Value;
use ss_core::types::{Alert, AlertSource, BBox, ColorScheme, RadarFrame, Severity, WeatherMaps};

pub const DEFAULT_COLOR_SCHEMES: [(u8, &str); 9] = [
    (0, "Black and White"),
    (1, "Original"),
    (2, "Universal Blue"),
    (3, "TITAN"),
    (4, "The Weather Channel"),
    (5, "Meteored"),
    (6, "NEXRAD Level III"),
    (7, "Rainbow @ SELEX-SI"),
    (8, "Dark Sky"),
];

pub fn default_color_schemes() -> Vec<ColorScheme> {
    DEFAULT_COLOR_SCHEMES
        .iter()
        .map(|(id, n)| ColorScheme {
            id: *id,
            name: (*n).to_string(),
        })
        .collect()
}

fn frames(v: Option<&Value>) -> Vec<RadarFrame> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|f| {
                    Some(RadarFrame {
                        time: f.get("time")?.as_i64()?,
                        path: f.get("path")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

pub fn parse_weather_maps(json: &str, configured_host: &str) -> Result<WeatherMaps> {
    let v = parse_value(json)?;
    if !v.is_object() {
        return Err(NetError::Parse("weather-maps.json is not an object".into()));
    }
    let radar = v.get("radar");
    let mut schemes: Vec<ColorScheme> = radar
        .and_then(|r| r.get("colorSchemes"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let id = c.get("id")?.as_u64()?;
                    Some(ColorScheme {
                        id: u8::try_from(id).ok()?,
                        name: c
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Unnamed")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    if schemes.is_empty() {
        schemes = default_color_schemes();
    }
    Ok(WeatherMaps {
        host: jstr(&v, "host")
            .unwrap_or_else(|| configured_host.to_string())
            .trim_end_matches('/')
            .to_string(),
        generated: v.get("generated").and_then(Value::as_i64).unwrap_or(0),
        radar_past: frames(radar.and_then(|r| r.get("past"))),
        radar_nowcast: frames(radar.and_then(|r| r.get("nowcast"))),
        satellite_infrared: frames(v.get("satellite").and_then(|s| s.get("infrared"))),
        color_schemes: schemes,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn radar_tile_url(
    host: &str,
    frame_path: &str,
    z: u32,
    x: u32,
    y: u32,
    color: u8,
    smooth: bool,
    snow: bool,
    arrows: Option<&str>,
    cells: Option<&str>,
) -> String {
    let mut url = format!(
        "{host}{frame_path}/256/{z}/{x}/{y}/{color}/{}_{}.png",
        u8::from(smooth),
        u8::from(snow)
    );
    let mut q = Vec::new();
    if let Some(a) = arrows {
        q.push(format!("arrows={a}"));
    }
    if let Some(c) = cells {
        q.push(format!("cells={c}"));
    }
    if !q.is_empty() {
        url.push('?');
        url.push_str(&q.join("&"));
    }
    url
}

pub fn satellite_tile_url(host: &str, path: &str, z: u32, x: u32, y: u32) -> String {
    format!("{host}{path}/256/{z}/{x}/{y}/0/0_0.png")
}

pub fn alerts_url(host: &str, bbox: BBox) -> String {
    let b = bbox.clamped();
    format!(
        "{host}/v2/alerts?bbox={},{},{},{}",
        b.west, b.south, b.east, b.north
    )
}

fn alert_from_props(
    p: &Value,
    geometry: Option<&Value>,
    fallback_id: Option<String>,
) -> Option<Alert> {
    let event = jstr(p, "event").or_else(|| jstr(p, "title"))?;
    let uri = jstr(p, "uri");
    let area = p.get("regions").and_then(|r| match r {
        Value::Array(a) => {
            let parts: Vec<&str> = a.iter().filter_map(Value::as_str).collect();
            (!parts.is_empty()).then(|| parts.join("; "))
        }
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    });
    let onset = p
        .get("time")
        .and_then(time_str)
        .or_else(|| p.get("onset").and_then(time_str));
    let ident = jstr(p, "id")
        .or_else(|| p.get("id").and_then(Value::as_i64).map(|n| n.to_string()))
        .or(fallback_id)
        .or_else(|| uri.clone())
        .unwrap_or_else(|| {
            stable_hash(&format!(
                "{event}|{}|{}",
                area.as_deref().unwrap_or(""),
                onset.as_deref().unwrap_or("")
            ))
        });
    Some(Alert {
        id: format!("librewxr:{ident}"),
        source: AlertSource::LibreWxr,
        display_event: event.clone(),
        headline: jstr(p, "title").filter(|t| *t != event),
        event,
        class: String::new(),
        description: jstr(p, "description"),
        instruction: None,
        severity: jstr(p, "severity")
            .map(|s| Severity::parse(&s))
            .unwrap_or(Severity::Unknown),
        area_desc: area,
        onset,
        sent: None,
        expires: p.get("expires").and_then(time_str),
        issuing_office: None,
        url: uri,
        geometry: parse_geometry(geometry),
        affected_zones: vec![],
        vtec: None,
    })
}

/// Accepts a GeoJSON FeatureCollection, an `{alerts:[...]}` wrapper, or a bare array.
pub fn parse_alerts(json: &str) -> Result<Vec<Alert>> {
    let v = parse_value(json)?;
    let mut out: Vec<Alert> = Vec::new();
    let mut push = |a: Option<Alert>| {
        if let Some(a) = a {
            if !out.iter().any(|o| o.id == a.id) {
                out.push(a);
            }
        }
    };
    if let Some(features) = v.get("features").and_then(Value::as_array) {
        for f in features {
            let fid = f.get("id").and_then(|i| {
                i.as_str()
                    .map(str::to_string)
                    .or_else(|| i.as_i64().map(|n| n.to_string()))
            });
            push(
                f.get("properties")
                    .and_then(|p| alert_from_props(p, f.get("geometry"), fid)),
            );
        }
    } else if let Some(list) = v
        .get("alerts")
        .and_then(Value::as_array)
        .or_else(|| v.as_array())
    {
        for a in list {
            let props = a.get("properties").unwrap_or(a);
            push(alert_from_props(
                props,
                a.get("geometry").or_else(|| props.get("geometry")),
                None,
            ));
        }
    } else {
        return Err(NetError::Missing("features or alerts"));
    }
    Ok(out)
}

impl Net {
    pub async fn weather_maps(&self) -> Result<WeatherMaps> {
        let host = &self.libre_wxr_host;
        parse_weather_maps(
            &self
                .get_text(&format!("{host}/public/weather-maps.json"), None)
                .await?,
            host,
        )
    }

    pub async fn librewxr_alerts_bbox(&self, bbox: BBox) -> Result<Vec<Alert>> {
        parse_alerts(
            &self
                .get_text(
                    &alerts_url(&self.libre_wxr_host, bbox),
                    Some("application/json"),
                )
                .await?,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::types::Geometry;

    #[test]
    fn maps_parse() {
        let j = r#"{"host":"https://tiles.example/","generated":1700000000,
          "radar":{"past":[{"time":1,"path":"/v2/radar/1"},{"time":2,"path":"/v2/radar/2"}],"nowcast":[{"time":3,"path":"/v2/radar/3"}],
                   "colorSchemes":[{"id":2,"name":"Universal Blue"}]},
          "satellite":{"infrared":[{"time":9,"path":"/v2/sat/9"}]}}"#;
        let m = parse_weather_maps(j, "https://cfg").unwrap();
        assert_eq!(m.host, "https://tiles.example");
        assert_eq!(m.radar_past.len(), 2);
        assert_eq!(m.radar_nowcast[0].path, "/v2/radar/3");
        assert_eq!(m.satellite_infrared.len(), 1);
        assert_eq!(
            m.color_schemes,
            vec![ColorScheme {
                id: 2,
                name: "Universal Blue".into()
            }]
        );
    }

    #[test]
    fn maps_defaults() {
        let m = parse_weather_maps(r#"{"radar":{"past":[]}}"#, "https://cfg").unwrap();
        assert_eq!(m.host, "https://cfg");
        assert_eq!(m.color_schemes.len(), 9);
        assert_eq!(m.color_schemes[8].name, "Dark Sky");
    }

    #[test]
    fn tile_urls() {
        assert_eq!(
            radar_tile_url(
                "https://h",
                "/v2/radar/1",
                5,
                3,
                4,
                2,
                true,
                false,
                None,
                None
            ),
            "https://h/v2/radar/1/256/5/3/4/2/1_0.png"
        );
        assert_eq!(
            radar_tile_url(
                "https://h",
                "/p",
                1,
                2,
                3,
                0,
                false,
                true,
                Some("dark"),
                Some("light")
            ),
            "https://h/p/256/1/2/3/0/0_1.png?arrows=dark&cells=light"
        );
        assert_eq!(
            satellite_tile_url("https://h", "/s", 1, 2, 3),
            "https://h/s/256/1/2/3/0/0_0.png"
        );
    }

    #[test]
    fn alerts_url_clamped() {
        let u = alerts_url("https://h", BBox::new(-200.0, -90.0, 10.0, 90.0));
        assert_eq!(u, "https://h/v2/alerts?bbox=-180,-85,10,85");
    }

    #[test]
    fn alerts_geojson_and_wrapper() {
        let g = r#"{"type":"FeatureCollection","features":[{"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},
          "properties":{"id":"a1","title":"Flood Warning","severity":"Severe","time":1700000000,"expires":"2026-01-01T00:00:00Z","regions":["A","B"],"uri":"https://x/1","description":"d"}}]}"#;
        let a = parse_alerts(g).unwrap();
        assert_eq!(a[0].id, "librewxr:a1");
        assert_eq!(a[0].area_desc.as_deref(), Some("A; B"));
        assert_eq!(a[0].onset.as_deref(), Some("2023-11-14T22:13:20Z"));
        assert!(matches!(a[0].geometry, Some(Geometry::Polygon(_))));
        assert_eq!(a[0].severity, Severity::Severe);

        let w = r#"{"alerts":[{"event":"Wind","uri":"https://x/2","regions":"Here"}]}"#;
        let b = parse_alerts(w).unwrap();
        assert_eq!(b[0].id, "librewxr:https://x/2");
        assert_eq!(b[0].area_desc.as_deref(), Some("Here"));
        assert!(parse_alerts("{}").is_err());
    }
}
