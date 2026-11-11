//! NOAA Weather Radio stream directory (noaaweatherradio.org).

use crate::{haversine_km, Net, NetError, Result};
use serde_json::Value;
use ss_core::types::NwrFeed;

pub const DIRECTORY_URL: &str = "https://noaaweatherradio.org/NWR-radio-finder-data.js";

/// Parse the `var data = {...};` blob into feeds that have a live stream URL.
pub fn parse_directory(js: &str) -> Result<Vec<NwrFeed>> {
    let start = js
        .find('{')
        .ok_or_else(|| NetError::Parse("NWR data: no '{' found".into()))?;
    let end = js
        .rfind('}')
        .ok_or_else(|| NetError::Parse("NWR data: no '}' found".into()))?;
    if end < start {
        return Err(NetError::Parse("NWR data: malformed object".into()));
    }
    let v: Value = serde_json::from_str(&js[start..=end])
        .map_err(|e| NetError::Parse(format!("NWR data: invalid JSON: {e}")))?;
    // `radios` is nested: state -> city -> "CALLSIGN|ST|City|lat|lon|freq|watts|status|coverage|wfo|slug".
    // Accept a flat array of the same strings too, in case the upstream shape changes.
    let radios = v
        .get("radios")
        .ok_or_else(|| NetError::Parse("NWR data: missing `radios`".into()))?;
    let mut entries: Vec<&str> = Vec::new();
    match radios {
        Value::Array(a) => entries.extend(a.iter().filter_map(Value::as_str)),
        Value::Object(states) => {
            for state in states.values() {
                match state {
                    Value::Object(cities) => {
                        entries.extend(cities.values().filter_map(Value::as_str))
                    }
                    Value::Array(a) => entries.extend(a.iter().filter_map(Value::as_str)),
                    _ => {}
                }
            }
        }
        _ => {
            return Err(NetError::Parse(
                "NWR data: `radios` is neither object nor array".into(),
            ))
        }
    }
    let inservice = v.get("inservice").and_then(Value::as_object);

    let mut out = Vec::new();
    for r in entries {
        let f: Vec<&str> = r.split('|').map(str::trim).collect();
        if f.len() < 5 || f[0].is_empty() {
            continue;
        }
        let (Ok(lat), Ok(lon)) = (f[3].parse::<f64>(), f[4].parse::<f64>()) else {
            continue;
        };
        let callsign = f[0];
        let Some(first) = inservice
            .and_then(|m| m.get(callsign))
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(Value::as_str)
        else {
            continue;
        };
        let parts: Vec<&str> = first.split('|').map(str::trim).collect();
        if !parts.get(1).is_some_and(|s| s.eq_ignore_ascii_case("ON")) {
            continue;
        }
        let Some(url) = parts.get(3).filter(|u| u.starts_with("http")) else {
            continue;
        };
        out.push(NwrFeed {
            callsign: callsign.to_string(),
            state: f[1].to_string(),
            city: f[2].to_string(),
            lat,
            lon,
            coverage: f.get(8).copied().unwrap_or_default().to_string(),
            stream_url: (*url).to_string(),
            provider: parts.get(4).copied().unwrap_or_default().to_string(),
        });
    }
    Ok(out)
}

/// The `n` feeds closest to the point, nearest first.
pub fn nearest_feeds(feeds: &[NwrFeed], lat: f64, lon: f64, n: usize) -> Vec<&NwrFeed> {
    let mut v: Vec<(f64, &NwrFeed)> = feeds
        .iter()
        .map(|f| (haversine_km(lat, lon, f.lat, f.lon), f))
        .collect();
    v.sort_by(|a, b| a.0.total_cmp(&b.0));
    v.into_iter().take(n).map(|(_, f)| f).collect()
}

impl Net {
    pub async fn nwr_directory(&self) -> Result<Vec<NwrFeed>> {
        parse_directory(&self.get_text(DIRECTORY_URL, None).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BLOB: &str = r#"var data = {"radios":[
      "WXK86|TX|Austin|30.27|-97.74|162.400|300|Active|Travis County|NOAA|Mt A",
      "KEC56|OK|Norman|35.22|-97.44|162.550|1000|Active|Cleveland|NOAA|Mt B",
      "WXX00|NY|Nowhere|40.0|-75.0|162.475|300|Active|None|NOAA|Mt C",
      "WXY11|TX|Dallas|32.78|-96.8|162.475|300|Active|Dallas|NOAA|Mt D",
      "bad|row"],
     "inservice":{"WXK86":["WRO|on|N|https://stream.example/wxk86|Broadcastify|x"],
                  "KEC56":["WRO|ON|N|https://stream.example/kec56|LiveATC|x","other"],
                  "WXX00":["WRO|ON|N||Nobody|x"],
                  "WXY11":["WRO|OFF|N|https://stream.example/wxy11|Offline|x"]}};"#;

    #[test]
    fn directory_parse() {
        let f = parse_directory(BLOB).unwrap();
        assert_eq!(f.len(), 2);
        assert_eq!(f[0].callsign, "WXK86");
        assert_eq!(f[0].stream_url, "https://stream.example/wxk86");
        assert_eq!(f[0].provider, "Broadcastify");
        assert_eq!(f[0].coverage, "Travis County");
        assert_eq!(f[1].state, "OK");
        assert!(
            f.iter().all(|x| x.callsign != "WXY11"),
            "OFF feeds are excluded"
        );
    }

    #[test]
    fn nested_real_shape() {
        // Mirrors the live file: radios is state -> city -> string, URLs are JS-escaped.
        let blob = r#"var data = {
            "radios": {"Missouri": {"St. Louis": "KDO89|MO|St. Louis|38.63|-90.20|162.550|1000|NORMAL|St. Louis,MO|LSX|MO-StLouis-KDO89"},
                       "Texas": {"Austin": "WXK86|TX|Austin|30.27|-97.74|162.400|300|NORMAL|Travis,TX|EWX|TX-Austin-WXK86"}},
            "inservice": {"KDO89": ["WRO|ON|N|https:\/\/wxradio.org\/MO-StLouis-KDO89|Lindenwood Park Weather|https:\/\/lpweather.com\/|"]},
            "nwrcount": 2 };"#;
        let f = parse_directory(blob).unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!(f[0].callsign, "KDO89");
        assert_eq!(f[0].stream_url, "https://wxradio.org/MO-StLouis-KDO89");
        assert_eq!(f[0].provider, "Lindenwood Park Weather");
        assert_eq!(f[0].coverage, "St. Louis,MO");
    }

    #[test]
    fn nearest() {
        let f = parse_directory(BLOB).unwrap();
        let n = nearest_feeds(&f, 35.0, -97.0, 1);
        assert_eq!(n[0].callsign, "KEC56");
        assert_eq!(nearest_feeds(&f, 35.0, -97.0, 5).len(), 2);
    }

    #[test]
    fn errors_have_context() {
        let e = parse_directory("var data = nope;").unwrap_err();
        assert!(matches!(e, NetError::Parse(_)));
        assert!(parse_directory(r#"var data = {"x":1};"#)
            .unwrap_err()
            .to_string()
            .contains("radios"));
    }
}
