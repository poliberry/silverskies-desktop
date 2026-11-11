//! Storm Prediction Center: mesoscale discussions and the Day 1 outlook.

use crate::nws::McdProduct;
use crate::{jstr, parse_geometry, parse_value, Net, NetError, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::Value;
use ss_core::types::{Alert, AlertSource, BBox, Geometry, Severity, SpcOutlookFeature};

pub const OUTLOOK_DAY1_URL: &str =
    "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/SPC_wx_outlks/MapServer/1/query?where=1%3D1&outFields=*&f=geojson";

pub fn md_query_url(bbox: BBox) -> String {
    format!(
        "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/spc_mesoscale_discussion/MapServer/0/query?geometry={},{},{},{}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=*&f=geojson",
        bbox.west, bbox.south, bbox.east, bbox.north
    )
}

static DIGITS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\d+").unwrap());
static HEADLINE_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"Mesoscale Discussion \d+").unwrap());

fn md_number(props: &Value) -> Option<u32> {
    for key in ["mdnum", "md_number", "name", "md"] {
        let Some(v) = props.get(key) else { continue };
        let s = match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => continue,
        };
        if let Some(m) = DIGITS_RE.find(&s) {
            if let Ok(n) = m.as_str().parse() {
                return Some(n);
            }
        }
    }
    None
}

/// MD number + polygon for each feature that carries a number.
pub fn parse_md_features(json: &str) -> Result<Vec<(u32, Option<Geometry>)>> {
    let v = parse_value(json)?;
    let features = v
        .get("features")
        .and_then(Value::as_array)
        .ok_or(NetError::Missing("features"))?;
    Ok(features
        .iter()
        .filter_map(|f| {
            let n = md_number(f.get("properties")?)?;
            Some((n, parse_geometry(f.get("geometry"))))
        })
        .collect())
}

pub fn build_md_alert(num: u32, geometry: Option<Geometry>, product: Option<&McdProduct>) -> Alert {
    let display = format!("Mesoscale Discussion #{num}");
    let headline = product
        .and_then(|p| {
            p.text
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && HEADLINE_RE.is_match(l))
        })
        .map(str::to_string)
        .or_else(|| Some(display.clone()));
    Alert {
        id: format!("spc:md:{num}"),
        source: AlertSource::Spc,
        event: "Mesoscale Discussion".to_string(),
        display_event: display,
        class: "alert-mesoscale-discussion".to_string(),
        headline,
        description: product.map(|p| p.text.clone()),
        instruction: None,
        severity: Severity::Moderate,
        area_desc: product.and_then(|p| p.area_desc.clone()),
        onset: None,
        sent: None,
        expires: product.and_then(|p| p.expires.clone()),
        issuing_office: Some("Storm Prediction Center".to_string()),
        url: Some(format!(
            "https://www.spc.noaa.gov/products/md/md{num:04}.html"
        )),
        geometry,
        affected_zones: vec![],
        vtec: None,
    }
}

/// `YYYYMMDDHHmm` -> RFC 3339 UTC; anything else passes through unchanged.
fn spc_time(raw: &str) -> String {
    let r = raw.trim();
    if r.len() == 12 && r.bytes().all(|b| b.is_ascii_digit()) {
        format!(
            "{}-{}-{}T{}:{}:00Z",
            &r[0..4],
            &r[4..6],
            &r[6..8],
            &r[8..10],
            &r[10..12]
        )
    } else {
        r.to_string()
    }
}

pub fn parse_outlook(json: &str) -> Result<Vec<SpcOutlookFeature>> {
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
        let Some(geometry) = parse_geometry(f.get("geometry")) else {
            continue;
        };
        if matches!(geometry, Geometry::Other) {
            continue;
        }
        let level = match p.get("dn") {
            Some(Value::Number(n)) => n.as_i64().unwrap_or(0) as i32,
            Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
            _ => 0,
        };
        let time = |k: &str| jstr(p, k).map(|s| spc_time(&s)).unwrap_or_default();
        out.push(SpcOutlookFeature {
            code: jstr(p, "label").unwrap_or_default(),
            name: jstr(p, "label2").unwrap_or_default(),
            level,
            stroke: jstr(p, "stroke").unwrap_or_default(),
            fill: jstr(p, "fill").unwrap_or_default(),
            valid: time("valid"),
            expire: time("expire"),
            issue: time("issue"),
            geometry,
        });
    }
    Ok(out)
}

/// Even-odd ray cast across all rings of one polygon (holes handled by parity).
fn in_rings(rings: &[Vec<[f64; 2]>], lat: f64, lon: f64) -> bool {
    let mut inside = false;
    for ring in rings {
        let n = ring.len();
        if n < 3 {
            continue;
        }
        let mut j = n - 1;
        for i in 0..n {
            let (xi, yi) = (ring[i][0], ring[i][1]);
            let (xj, yj) = (ring[j][0], ring[j][1]);
            if (yi > lat) != (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi {
                inside = !inside;
            }
            j = i;
        }
    }
    inside
}

fn geometry_contains(g: &Geometry, lat: f64, lon: f64) -> bool {
    match g {
        Geometry::Polygon(rings) => in_rings(rings, lat, lon),
        Geometry::MultiPolygon(polys) => polys.iter().any(|p| in_rings(p, lat, lon)),
        _ => false,
    }
}

/// The highest-level outlook polygon covering the point.
pub fn highest_outlook_at(
    features: &[SpcOutlookFeature],
    lat: f64,
    lon: f64,
) -> Option<&SpcOutlookFeature> {
    features
        .iter()
        .filter(|f| geometry_contains(&f.geometry, lat, lon))
        .max_by_key(|f| f.level)
}

impl Net {
    pub async fn mesoscale_discussions(&self, bbox: BBox) -> Result<Vec<Alert>> {
        let text = self.get_text(&md_query_url(bbox), None).await?;
        let features = parse_md_features(&text)?;
        if features.is_empty() {
            return Ok(vec![]);
        }
        let products = match self.products_swo_mcd().await {
            Ok(p) => p,
            Err(e) => {
                tracing::debug!("MCD products unavailable: {e}");
                vec![]
            }
        };
        Ok(features
            .into_iter()
            .map(|(n, g)| build_md_alert(n, g, products.iter().find(|p| p.number == n)))
            .collect())
    }

    pub async fn outlook_day1(&self) -> Result<Vec<SpcOutlookFeature>> {
        parse_outlook(&self.get_text(OUTLOOK_DAY1_URL, None).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OUTLOOK: &str = r##"{"features":[
      {"geometry":{"type":"Polygon","coordinates":[[[-102,30],[-102,35],[-95,35],[-95,30],[-102,30]]]},
       "properties":{"dn":3,"label":"SLGT","label2":"Slight Risk","stroke":"#FFE066","fill":"#FFFF00","valid":"202605201200","expire":"202605211200","issue":"202605200600"}},
      {"geometry":{"type":"MultiPolygon","coordinates":[[[[-100,32],[-100,33],[-99,33],[-99,32],[-100,32]]]]},
       "properties":{"dn":4,"label":"ENH","label2":"Enhanced Risk","stroke":"#FF7F00","fill":"#FFA500","valid":"202605201200","expire":"202605211200","issue":"202605200600"}}]}"##;

    #[test]
    fn outlook_parse_and_highest() {
        let f = parse_outlook(OUTLOOK).unwrap();
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].code, "SLGT");
        assert_eq!(f[0].level, 3);
        assert_eq!(f[0].valid, "2026-05-20T12:00:00Z");
        assert_eq!(highest_outlook_at(&f, 32.5, -99.5).unwrap().code, "ENH");
        assert_eq!(highest_outlook_at(&f, 31.0, -101.0).unwrap().code, "SLGT");
        assert!(highest_outlook_at(&f, 40.0, -80.0).is_none());
    }

    #[test]
    fn polygon_hole_excluded() {
        let outer = vec![
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 10.0],
            [0.0, 10.0],
            [0.0, 0.0],
        ];
        let hole = vec![[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0], [4.0, 4.0]];
        let g = Geometry::Polygon(vec![outer, hole]);
        assert!(geometry_contains(&g, 1.0, 1.0));
        assert!(!geometry_contains(&g, 5.0, 5.0));
    }

    #[test]
    fn md_features_and_alert() {
        let j = r#"{"features":[
          {"geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"properties":{"name":"MD 1234"}},
          {"geometry":null,"properties":{"mdnum":77}},
          {"geometry":null,"properties":{"other":"x"}}]}"#;
        let f = parse_md_features(j).unwrap();
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].0, 1234);
        assert_eq!(f[1].0, 77);
        let prod = McdProduct {
            number: 1234,
            text: "\nSPC AC 201800\n\nMesoscale Discussion 1234\nValid 201800Z - 202030Z\n".into(),
            expires: Some("2026-05-20T20:30:00Z".into()),
            area_desc: Some("Oklahoma".into()),
        };
        let a = build_md_alert(1234, f[0].1.clone(), Some(&prod));
        assert_eq!(a.id, "spc:md:1234");
        assert_eq!(a.display_event, "Mesoscale Discussion #1234");
        assert_eq!(a.class, "alert-mesoscale-discussion");
        assert_eq!(a.headline.as_deref(), Some("Mesoscale Discussion 1234"));
        assert_eq!(
            a.url.as_deref(),
            Some("https://www.spc.noaa.gov/products/md/md1234.html")
        );
        assert_eq!(a.expires.as_deref(), Some("2026-05-20T20:30:00Z"));
        let b = build_md_alert(77, None, None);
        assert_eq!(
            b.url.as_deref(),
            Some("https://www.spc.noaa.gov/products/md/md0077.html")
        );
    }

    #[test]
    fn md_url() {
        let u = md_query_url(BBox::new(-100.0, 30.0, -90.0, 40.0));
        assert!(u.contains("geometry=-100,30,-90,40&geometryType=esriGeometryEnvelope"));
    }
}
