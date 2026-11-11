//! api.weather.gov clients: alerts, zones, radar stations, METAR, MCD products.

use crate::{
    haversine_km, jf64, jstr, parse_geometry, parse_value, Net, NetError, Result, GEO_JSON,
};
use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Utc};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use ss_core::types::{
    Alert, AlertSource, Geometry, MetarObservation, MetarStation, RadarStation, Severity,
};
use std::collections::HashMap;
use std::sync::Mutex;

const LD_JSON: &str = "application/ld+json";
pub const MAX_ZONES: usize = 30;

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

pub fn alerts_url(lat: f64, lon: f64) -> String {
    format!("https://api.weather.gov/alerts/active?point={lat:.4},{lon:.4}")
}

pub fn parse_alerts(json: &str) -> Result<Vec<Alert>> {
    let v = parse_value(json)?;
    let features = v
        .get("features")
        .and_then(Value::as_array)
        .ok_or(NetError::Missing("features"))?;
    let mut out = Vec::new();
    for f in features {
        let Some(p) = f.get("properties") else {
            continue;
        };
        let Some(id) = jstr(p, "id").or_else(|| jstr(f, "id")) else {
            continue;
        };
        let Some(event) = jstr(p, "event") else {
            continue;
        };
        let zones = p
            .get("affectedZones")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|z| z.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let vtec = p
            .get("parameters")
            .and_then(|x| x.get("VTEC"))
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(Value::as_str)
            .map(str::to_string);
        out.push(Alert {
            id,
            source: AlertSource::Nws,
            display_event: event.clone(),
            event,
            class: String::new(),
            headline: jstr(p, "headline"),
            description: jstr(p, "description"),
            instruction: jstr(p, "instruction"),
            severity: jstr(p, "severity")
                .map(|s| Severity::parse(&s))
                .unwrap_or(Severity::Unknown),
            area_desc: jstr(p, "areaDesc"),
            onset: jstr(p, "onset").or_else(|| jstr(p, "effective")),
            sent: jstr(p, "sent"),
            expires: jstr(p, "expires"),
            issuing_office: jstr(p, "senderName"),
            url: f.get("id").and_then(Value::as_str).map(str::to_string),
            geometry: parse_geometry(f.get("geometry")),
            affected_zones: zones,
            vtec,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

pub fn parse_zone_geometry(json: &str) -> Result<Option<Geometry>> {
    let v = parse_value(json)?;
    Ok(parse_geometry(v.get("geometry")))
}

/// Flatten Polygon/MultiPolygon geometries into one MultiPolygon (first
/// [`MAX_ZONES`] inputs only).
pub fn combine_zones(geoms: Vec<Geometry>) -> Option<Geometry> {
    let mut polys = Vec::new();
    for g in geoms.into_iter().take(MAX_ZONES) {
        match g {
            Geometry::Polygon(p) => polys.push(p),
            Geometry::MultiPolygon(mp) => polys.extend(mp),
            _ => {}
        }
    }
    if polys.is_empty() {
        None
    } else {
        Some(Geometry::MultiPolygon(polys))
    }
}

// ---------------------------------------------------------------------------
// Radar stations
// ---------------------------------------------------------------------------

pub const RADAR_STATIONS_URL: &str = "https://api.weather.gov/radar/stations?stationType=WSR-88D";

pub fn vcp_label(vcp: u32) -> &'static str {
    match vcp {
        11 => "Precipitation (Legacy)",
        12 | 21 | 112 | 121 | 212 | 215 => "Precipitation",
        31 => "Clear Air (Long Pulse)",
        32 | 35 => "Clear Air",
        _ => "Unknown",
    }
}

/// VCPs that run SAILS (supplemental low-level scans).
pub fn is_sails(vcp: u32) -> bool {
    matches!(vcp, 112 | 212 | 215)
}

/// True when the last Level II receipt is less than 15 minutes old.
pub fn is_live(last_received: &str, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(last_received)
        .map(|t| {
            let age = now.signed_duration_since(t.with_timezone(&Utc));
            age < chrono::Duration::minutes(15)
        })
        .unwrap_or(false)
}

fn parse_vcp(v: &Value) -> Option<u32> {
    match v {
        Value::Number(n) => n.as_u64().map(|x| x as u32),
        Value::String(s) => {
            let digits: String = s.chars().filter(char::is_ascii_digit).collect();
            digits.parse().ok()
        }
        _ => None,
    }
}

fn lon_lat(f: &Value) -> Option<(f64, f64)> {
    let c = f.get("geometry")?.get("coordinates")?.as_array()?;
    Some((c.first()?.as_f64()?, c.get(1)?.as_f64()?))
}

pub fn parse_radar_stations(json: &str) -> Result<Vec<RadarStation>> {
    let v = parse_value(json)?;
    let features = v
        .get("features")
        .and_then(Value::as_array)
        .ok_or(NetError::Missing("features"))?;
    let mut out = Vec::new();
    for f in features {
        let Some(p) = f.get("properties") else {
            continue;
        };
        let Some(id) = jstr(p, "id") else { continue };
        let Some((lon, lat)) = lon_lat(f) else {
            continue;
        };
        let rda = p.get("rda").and_then(|r| r.get("properties"));
        out.push(RadarStation {
            name: jstr(p, "name").unwrap_or_else(|| id.clone()),
            id,
            lat,
            lon,
            elevation_m: p.get("elevation").and_then(|e| jf64(e, "value")),
            vcp: rda
                .and_then(|r| r.get("volumeCoveragePattern"))
                .and_then(parse_vcp),
            operability_status: jstr(p, "operabilityStatus")
                .or_else(|| rda.and_then(|r| jstr(r, "operabilityStatus"))),
            alarm_summary: jstr(p, "alarmSummary")
                .or_else(|| rda.and_then(|r| jstr(r, "alarmSummary"))),
            last_received_time: p
                .get("latency")
                .and_then(|l| jstr(l, "levelTwoLastReceivedTime")),
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// METAR
// ---------------------------------------------------------------------------

pub const METAR_STATIONS_URL: &str = "https://api.weather.gov/stations?limit=500";
const KMH_TO_KT: f64 = 0.539957;

/// Returns the stations on this page and the `pagination.next` URL.
pub fn parse_metar_stations(json: &str) -> Result<(Vec<MetarStation>, Option<String>)> {
    let v = parse_value(json)?;
    let features = v
        .get("features")
        .and_then(Value::as_array)
        .ok_or(NetError::Missing("features"))?;
    let mut out = Vec::new();
    for f in features {
        let Some(p) = f.get("properties") else {
            continue;
        };
        let Some(id) = jstr(p, "stationIdentifier") else {
            continue;
        };
        let Some((lon, lat)) = lon_lat(f) else {
            continue;
        };
        out.push(MetarStation {
            name: jstr(p, "name").unwrap_or_else(|| id.clone()),
            id,
            lat,
            lon,
        });
    }
    let next = v.get("pagination").and_then(|p| jstr(p, "next"));
    Ok((out, next))
}

pub fn parse_observation(json: &str, station_id: &str) -> Result<MetarObservation> {
    let v = parse_value(json)?;
    let p = v.get("properties").ok_or(NetError::Missing("properties"))?;
    let val = |k: &str| p.get(k).and_then(|x| jf64(x, "value"));
    Ok(MetarObservation {
        station_id: station_id.to_string(),
        wind_direction_deg: val("windDirection"),
        wind_speed_kt: val("windSpeed").map(|k| k * KMH_TO_KT),
        wind_gust_kt: val("windGust").map(|k| k * KMH_TO_KT),
        timestamp: jstr(p, "timestamp"),
    })
}

/// The `n` stations nearest to the point, closest first.
pub fn nearest_metar_stations(
    stations: &[MetarStation],
    lat: f64,
    lon: f64,
    n: usize,
) -> Vec<&MetarStation> {
    let mut v: Vec<(f64, &MetarStation)> = stations
        .iter()
        .map(|s| (haversine_km(lat, lon, s.lat, s.lon), s))
        .collect();
    v.sort_by(|a, b| a.0.total_cmp(&b.0));
    v.into_iter().take(n).map(|(_, s)| s).collect()
}

// ---------------------------------------------------------------------------
// SWO / MCD text products
// ---------------------------------------------------------------------------

pub const SWO_MCD_URL: &str = "https://api.weather.gov/products?type=SWO&location=MCD&limit=15";

/// A Mesoscale Discussion text product.
#[derive(Debug, Clone, PartialEq)]
pub struct McdProduct {
    pub number: u32,
    pub text: String,
    /// RFC 3339 UTC.
    pub expires: Option<String>,
    /// From the `Areas affected...` line.
    pub area_desc: Option<String>,
}

static MD_NUM_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Mesoscale Discussion (\d+)").unwrap());
static VALID_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"Valid \d{6}Z - (\d{2})(\d{2})(\d{2})Z").unwrap());
static AREAS_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?im)^\s*Areas affected\.\.\.(.*)$").unwrap());

/// Expiry of an MCD relative to its issuance time. The text only carries
/// day/hour/minute, so month/year come from issuance (bumping the month if the
/// result would land before issuance).
pub fn mcd_expiry(text: &str, issuance: DateTime<Utc>) -> Option<String> {
    let c = VALID_RE.captures(text)?;
    let day: u32 = c[1].parse().ok()?;
    let hour: u32 = c[2].parse().ok()?;
    let min: u32 = c[3].parse().ok()?;
    let build = |y: i32, m: u32| -> Option<DateTime<Utc>> {
        let d = NaiveDate::from_ymd_opt(y, m, day)?.and_hms_opt(hour, min, 0)?;
        Some(Utc.from_utc_datetime(&d))
    };
    let (y, m) = (issuance.year(), issuance.month());
    let mut t = build(y, m);
    if t.is_none_or(|t| t < issuance) {
        let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
        t = build(ny, nm).or(t);
    }
    t.map(|t| t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

pub fn parse_mcd_text(text: &str, issuance: DateTime<Utc>) -> Option<McdProduct> {
    let number: u32 = MD_NUM_RE.captures(text)?[1].parse().ok()?;
    let area_desc = AREAS_RE
        .captures(text)
        .map(|c| c[1].trim().trim_end_matches('.').trim().to_string())
        .filter(|s| !s.is_empty());
    Some(McdProduct {
        number,
        text: text.trim().to_string(),
        expires: mcd_expiry(text, issuance),
        area_desc,
    })
}

/// `@graph[].@id` URLs from the product list.
pub fn parse_product_list(json: &str) -> Result<Vec<String>> {
    let v = parse_value(json)?;
    let g = v
        .get("@graph")
        .and_then(Value::as_array)
        .ok_or(NetError::Missing("@graph"))?;
    Ok(g.iter().filter_map(|p| jstr(p, "@id")).collect())
}

/// Parse a single product document (`productText` + `issuanceTime`).
pub fn parse_product(json: &str) -> Result<Option<McdProduct>> {
    let v = parse_value(json)?;
    let Some(text) = jstr(&v, "productText") else {
        return Ok(None);
    };
    let issuance = jstr(&v, "issuanceTime")
        .and_then(|s| DateTime::parse_from_rfc3339(&s).ok())
        .map(|d| d.with_timezone(&Utc))
        .unwrap_or_else(Utc::now);
    Ok(parse_mcd_text(&text, issuance))
}

impl Net {
    pub async fn alerts_for_point(&self, lat: f64, lon: f64) -> Result<Vec<Alert>> {
        parse_alerts(&self.get_text(&alerts_url(lat, lon), Some(GEO_JSON)).await?)
    }

    /// Best effort: any failure yields `None`.
    pub async fn zone_geometry(&self, zone_url: &str) -> Option<Geometry> {
        let text = self.get_text(zone_url, Some(GEO_JSON)).await.ok()?;
        parse_zone_geometry(&text).ok().flatten()
    }

    /// Fetch (with caching, including negative results) and combine the zone
    /// polygons for `urls` (capped at [`MAX_ZONES`]).
    pub async fn zone_geometries_cached(
        &self,
        cache: &Mutex<HashMap<String, Option<Geometry>>>,
        urls: &[String],
    ) -> Option<Geometry> {
        let urls: Vec<&String> = urls.iter().take(MAX_ZONES).collect();
        let missing: Vec<&String> = {
            let c = cache.lock().unwrap_or_else(|e| e.into_inner());
            urls.iter()
                .copied()
                .filter(|u| !c.contains_key(*u))
                .collect()
        };
        let fetched =
            futures::future::join_all(missing.iter().map(|u| self.zone_geometry(u))).await;
        {
            let mut c = cache.lock().unwrap_or_else(|e| e.into_inner());
            for (u, g) in missing.into_iter().zip(fetched) {
                c.insert(u.clone(), g);
            }
        }
        let c = cache.lock().unwrap_or_else(|e| e.into_inner());
        combine_zones(
            urls.iter()
                .filter_map(|u| c.get(*u).cloned().flatten())
                .collect(),
        )
    }

    pub async fn radar_stations(&self) -> Result<Vec<RadarStation>> {
        parse_radar_stations(&self.get_text(RADAR_STATIONS_URL, Some(GEO_JSON)).await?)
    }

    /// Follows `pagination.next` for up to 20 pages.
    pub async fn metar_stations(&self) -> Result<Vec<MetarStation>> {
        let mut all = Vec::new();
        let mut url = Some(METAR_STATIONS_URL.to_string());
        for _ in 0..20 {
            let Some(u) = url.take() else { break };
            let (page, next) = parse_metar_stations(&self.get_text(&u, Some(GEO_JSON)).await?)?;
            all.extend(page);
            url = next;
        }
        Ok(all)
    }

    pub async fn latest_observation(&self, station_id: &str) -> Option<MetarObservation> {
        let url = format!("https://api.weather.gov/stations/{station_id}/observations/latest");
        let text = self.get_text(&url, Some(GEO_JSON)).await.ok()?;
        parse_observation(&text, station_id).ok()
    }

    pub async fn products_swo_mcd(&self) -> Result<Vec<McdProduct>> {
        let urls = parse_product_list(&self.get_text(SWO_MCD_URL, Some(LD_JSON)).await?)?;
        let docs =
            futures::future::join_all(urls.iter().map(|u| self.get_text(u, Some(LD_JSON)))).await;
        let mut out = Vec::new();
        for d in docs {
            match d
                .map_err(|e| e.to_string())
                .and_then(|t| parse_product(&t).map_err(|e| e.to_string()))
            {
                Ok(Some(p)) => out.push(p),
                Ok(None) => {}
                Err(e) => tracing::debug!("MCD product skipped: {e}"),
            }
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALERTS: &str = r#"{"features":[
      {"id":"https://api.weather.gov/alerts/urn:1","geometry":{"type":"Polygon","coordinates":[[[-100,30],[-100,31],[-99,31],[-100,30]]]},
       "properties":{"id":"urn:1","event":"Tornado Warning","headline":"H","description":"D","instruction":"I","severity":"Extreme",
        "areaDesc":"Foo County","onset":"2026-01-01T00:00:00Z","sent":"2026-01-01T00:00:00Z","expires":"2026-01-01T01:00:00Z",
        "senderName":"NWS Norman OK","affectedZones":["https://api.weather.gov/zones/county/OKC001"],
        "parameters":{"VTEC":["/O.NEW.KOUN.TO.W.0001.260101T0000Z-260101T0100Z/"]}}},
      {"id":"https://api.weather.gov/alerts/urn:2","geometry":null,"properties":{"id":"urn:2","event":"Heat Advisory","severity":"Minor"}}
    ]}"#;

    #[test]
    fn alerts_parse() {
        let a = parse_alerts(ALERTS).unwrap();
        assert_eq!(a.len(), 2);
        assert_eq!(a[0].id, "urn:1");
        assert_eq!(a[0].severity, Severity::Extreme);
        assert_eq!(a[0].issuing_office.as_deref(), Some("NWS Norman OK"));
        assert_eq!(a[0].affected_zones.len(), 1);
        assert!(a[0].vtec.as_deref().unwrap().contains("TO.W.0001"));
        assert!(matches!(a[0].geometry, Some(Geometry::Polygon(_))));
        assert_eq!(
            a[0].url.as_deref(),
            Some("https://api.weather.gov/alerts/urn:1")
        );
        assert!(a[1].geometry.is_none());
        assert_eq!(a[1].display_event, "Heat Advisory");
        assert_eq!(a[1].class, "");
    }

    #[test]
    fn alerts_url_format() {
        assert_eq!(
            alerts_url(32.834, -109.7076),
            "https://api.weather.gov/alerts/active?point=32.8340,-109.7076"
        );
    }

    #[test]
    fn combine_flattens_and_caps() {
        let ring = vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 0.0]];
        let g = vec![
            Geometry::Polygon(vec![ring.clone()]),
            Geometry::MultiPolygon(vec![vec![ring.clone()], vec![ring.clone()]]),
            Geometry::Point([0.0, 0.0]),
        ];
        match combine_zones(g).unwrap() {
            Geometry::MultiPolygon(m) => assert_eq!(m.len(), 3),
            _ => panic!(),
        }
        let many = (0..40)
            .map(|_| Geometry::Polygon(vec![ring.clone()]))
            .collect();
        match combine_zones(many).unwrap() {
            Geometry::MultiPolygon(m) => assert_eq!(m.len(), MAX_ZONES),
            _ => panic!(),
        }
        assert!(combine_zones(vec![]).is_none());
    }

    #[test]
    fn vcp_helpers() {
        assert_eq!(vcp_label(35), "Clear Air");
        assert_eq!(vcp_label(212), "Precipitation");
        assert_eq!(vcp_label(99), "Unknown");
        assert!(is_sails(215));
        assert!(!is_sails(12));
        let now = Utc.with_ymd_and_hms(2026, 1, 1, 12, 0, 0).unwrap();
        assert!(is_live("2026-01-01T11:50:00Z", now));
        assert!(!is_live("2026-01-01T11:40:00Z", now));
        assert!(!is_live("garbage", now));
    }

    #[test]
    fn radar_stations_parse() {
        let j = r#"{"features":[{"geometry":{"type":"Point","coordinates":[-81.7,27.9]},
          "properties":{"id":"KTBW","name":"Tampa Bay","elevation":{"value":12.0},
           "latency":{"levelTwoLastReceivedTime":"2026-01-01T11:50:00Z"},
           "rda":{"properties":{"volumeCoveragePattern":"R35"}},"operabilityStatus":"Normal"}},
          {"geometry":{"type":"Point","coordinates":[-80,28]},"properties":{"id":"KMLB","rda":{"properties":{"volumeCoveragePattern":212}}}}]}"#;
        let s = parse_radar_stations(j).unwrap();
        assert_eq!(s.len(), 2);
        assert_eq!(s[0].vcp, Some(35));
        assert_eq!(s[0].lat, 27.9);
        assert_eq!(s[0].elevation_m, Some(12.0));
        assert_eq!(s[0].operability_status.as_deref(), Some("Normal"));
        assert_eq!(s[1].vcp, Some(212));
    }

    #[test]
    fn metar_parse_and_nearest() {
        let j = r#"{"features":[
          {"geometry":{"coordinates":[-109.6,32.8]},"properties":{"stationIdentifier":"KSAD","name":"Safford"}},
          {"geometry":{"coordinates":[-110.9,32.1]},"properties":{"stationIdentifier":"KTUS","name":"Tucson"}}],
          "pagination":{"next":"https://api.weather.gov/stations?cursor=x"}}"#;
        let (st, next) = parse_metar_stations(j).unwrap();
        assert_eq!(st.len(), 2);
        assert!(next.is_some());
        let n = nearest_metar_stations(&st, 32.83, -109.7, 1);
        assert_eq!(n[0].id, "KSAD");
        let obs = r#"{"properties":{"timestamp":"t","windDirection":{"value":270},"windSpeed":{"value":18.52},"windGust":{"value":null}}}"#;
        let o = parse_observation(obs, "KSAD").unwrap();
        assert_eq!(o.wind_direction_deg, Some(270.0));
        assert!((o.wind_speed_kt.unwrap() - 10.0).abs() < 0.01);
        assert_eq!(o.wind_gust_kt, None);
    }

    #[test]
    fn mcd_expiry_regex() {
        let issuance = Utc.with_ymd_and_hms(2026, 5, 20, 18, 0, 0).unwrap();
        let t = "Mesoscale Discussion 1234\nValid 201800Z - 202030Z\nAreas affected...Central Oklahoma.\n";
        assert_eq!(
            mcd_expiry(t, issuance).as_deref(),
            Some("2026-05-20T20:30:00Z")
        );
        // crossing month boundary
        let iss = Utc.with_ymd_and_hms(2026, 5, 31, 23, 0, 0).unwrap();
        let t2 = "Valid 312300Z - 010100Z";
        assert_eq!(mcd_expiry(t2, iss).as_deref(), Some("2026-06-01T01:00:00Z"));
        assert_eq!(mcd_expiry("nothing", issuance), None);
        let p = parse_mcd_text(t, issuance).unwrap();
        assert_eq!(p.number, 1234);
        assert_eq!(p.area_desc.as_deref(), Some("Central Oklahoma"));
    }

    #[test]
    fn product_documents() {
        let list = r#"{"@graph":[{"@id":"https://api.weather.gov/products/a"},{"@id":"https://api.weather.gov/products/b"}]}"#;
        assert_eq!(parse_product_list(list).unwrap().len(), 2);
        let doc = r#"{"issuanceTime":"2026-05-20T18:05:00+00:00","productText":"Mesoscale Discussion 99\nValid 201805Z - 202100Z"}"#;
        let p = parse_product(doc).unwrap().unwrap();
        assert_eq!(p.number, 99);
        assert_eq!(p.expires.as_deref(), Some("2026-05-20T21:00:00Z"));
    }
}
