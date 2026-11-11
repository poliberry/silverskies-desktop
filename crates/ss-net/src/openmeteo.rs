//! Open-Meteo forecast and geocoding, Nominatim fallback, IP geolocation.

use crate::{enc, jstr, parse_value, Net, NetError, Result};
use serde_json::Value;
use ss_core::types::{
    CurrentConditions, DailyPoint, HourlyPoint, Location, Weather, WeatherProviderId,
};

pub const DEFAULT_LOCATION: (f64, f64, &str) = (32.834, -109.7076, "Safford, AZ");

pub fn forecast_url(lat: f64, lon: f64) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,uv_index,is_day&hourly=temperature_2m,weather_code,precipitation_probability,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7"
    )
}

fn num(v: &Value, key: &str) -> f64 {
    v.get(key).and_then(Value::as_f64).unwrap_or(0.0)
}

fn flag(v: &Value, key: &str) -> bool {
    match v.get(key) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0) != 0.0,
        _ => false,
    }
}

fn code(v: Option<&Value>) -> u8 {
    v.and_then(Value::as_f64)
        .map(|c| c.clamp(0.0, 255.0) as u8)
        .unwrap_or(0)
}

fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

fn f(a: &[Value], i: usize) -> f64 {
    a.get(i).and_then(Value::as_f64).unwrap_or(0.0)
}

fn s(a: &[Value], i: usize) -> String {
    a.get(i)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub fn parse_forecast(json: &str) -> Result<Weather> {
    let v = parse_value(json)?;
    let cur = v.get("current").ok_or(NetError::Missing("current"))?;
    let current = CurrentConditions {
        temperature_c: num(cur, "temperature_2m"),
        apparent_temperature_c: num(cur, "apparent_temperature"),
        weather_code: code(cur.get("weather_code")),
        is_day: flag(cur, "is_day"),
        relative_humidity_pct: num(cur, "relative_humidity_2m"),
        wind_speed_kmh: num(cur, "wind_speed_10m"),
        wind_direction_deg: num(cur, "wind_direction_10m"),
        precipitation_mm: num(cur, "precipitation"),
        cloud_cover_pct: num(cur, "cloud_cover"),
        uv_index: num(cur, "uv_index"),
    };

    let mut hourly = Vec::new();
    if let Some(h) = v.get("hourly") {
        let (time, t, wc, pp, day) = (
            arr(h, "time"),
            arr(h, "temperature_2m"),
            arr(h, "weather_code"),
            arr(h, "precipitation_probability"),
            arr(h, "is_day"),
        );
        for i in 0..time.len() {
            hourly.push(HourlyPoint {
                time: s(time, i),
                temperature_c: f(t, i),
                weather_code: code(wc.get(i)),
                is_day: f(day, i) != 0.0,
                precipitation_probability_pct: f(pp, i),
            });
        }
    }

    let mut daily = Vec::new();
    if let Some(d) = v.get("daily") {
        let (time, wc, hi, lo, pp, sr, ss, uv) = (
            arr(d, "time"),
            arr(d, "weather_code"),
            arr(d, "temperature_2m_max"),
            arr(d, "temperature_2m_min"),
            arr(d, "precipitation_probability_max"),
            arr(d, "sunrise"),
            arr(d, "sunset"),
            arr(d, "uv_index_max"),
        );
        for i in 0..time.len() {
            daily.push(DailyPoint {
                date: s(time, i),
                weather_code: code(wc.get(i)),
                temp_max_c: f(hi, i),
                temp_min_c: f(lo, i),
                precipitation_probability_max_pct: f(pp, i),
                sunrise: s(sr, i),
                sunset: s(ss, i),
                uv_index_max: f(uv, i),
            });
        }
    }

    Ok(Weather {
        current,
        hourly,
        daily,
        timezone: jstr(&v, "timezone").unwrap_or_default(),
        provider: WeatherProviderId::OpenMeteo,
    })
}

// ---------------------------------------------------------------------------
// Geocoding
// ---------------------------------------------------------------------------

pub const REGION_NAMES: &[(&str, &str)] = &[
    // US states + DC
    ("AL", "Alabama"),
    ("AK", "Alaska"),
    ("AZ", "Arizona"),
    ("AR", "Arkansas"),
    ("CA", "California"),
    ("CO", "Colorado"),
    ("CT", "Connecticut"),
    ("DE", "Delaware"),
    ("DC", "District of Columbia"),
    ("FL", "Florida"),
    ("GA", "Georgia"),
    ("HI", "Hawaii"),
    ("ID", "Idaho"),
    ("IL", "Illinois"),
    ("IN", "Indiana"),
    ("IA", "Iowa"),
    ("KS", "Kansas"),
    ("KY", "Kentucky"),
    ("LA", "Louisiana"),
    ("ME", "Maine"),
    ("MD", "Maryland"),
    ("MA", "Massachusetts"),
    ("MI", "Michigan"),
    ("MN", "Minnesota"),
    ("MS", "Mississippi"),
    ("MO", "Missouri"),
    ("MT", "Montana"),
    ("NE", "Nebraska"),
    ("NV", "Nevada"),
    ("NH", "New Hampshire"),
    ("NJ", "New Jersey"),
    ("NM", "New Mexico"),
    ("NY", "New York"),
    ("NC", "North Carolina"),
    ("ND", "North Dakota"),
    ("OH", "Ohio"),
    ("OK", "Oklahoma"),
    ("OR", "Oregon"),
    ("PA", "Pennsylvania"),
    ("RI", "Rhode Island"),
    ("SC", "South Carolina"),
    ("SD", "South Dakota"),
    ("TN", "Tennessee"),
    ("TX", "Texas"),
    ("UT", "Utah"),
    ("VT", "Vermont"),
    ("VA", "Virginia"),
    ("WA", "Washington"),
    ("WV", "West Virginia"),
    ("WI", "Wisconsin"),
    ("WY", "Wyoming"),
    // Canadian provinces / territories
    ("AB", "Alberta"),
    ("BC", "British Columbia"),
    ("MB", "Manitoba"),
    ("NB", "New Brunswick"),
    ("NL", "Newfoundland and Labrador"),
    ("NS", "Nova Scotia"),
    ("NT", "Northwest Territories"),
    ("NU", "Nunavut"),
    ("ON", "Ontario"),
    ("PE", "Prince Edward Island"),
    ("QC", "Quebec"),
    ("SK", "Saskatchewan"),
    ("YT", "Yukon"),
];

fn region_name(code: &str) -> Option<&'static str> {
    REGION_NAMES
        .iter()
        .find(|(c, _)| c.eq_ignore_ascii_case(code))
        .map(|(_, n)| *n)
}

fn region_code(name: &str) -> Option<&'static str> {
    REGION_NAMES
        .iter()
        .find(|(_, n)| n.eq_ignore_ascii_case(name))
        .map(|(c, _)| *c)
}

/// Split a trailing `, XX` token (2-3 letters) off the query.
pub fn split_region(query: &str) -> (String, Option<String>) {
    let q = query.trim();
    if let Some((head, tail)) = q.rsplit_once(',') {
        let t = tail.trim();
        if (2..=3).contains(&t.len())
            && t.chars().all(|c| c.is_ascii_alphabetic())
            && !head.trim().is_empty()
        {
            return (head.trim().to_string(), Some(t.to_ascii_uppercase()));
        }
    }
    (q.to_string(), None)
}

pub fn geocode_url(name: &str) -> String {
    format!(
        "https://geocoding-api.open-meteo.com/v1/search?name={}&count=5&language=en&format=json",
        enc(name)
    )
}

pub fn parse_geocode(json: &str, region: Option<&str>) -> Result<Vec<Location>> {
    let v = parse_value(json)?;
    let Some(results) = v.get("results").and_then(Value::as_array) else {
        return Ok(vec![]);
    };
    let wanted = region.and_then(region_name);
    let mut rows: Vec<&Value> = results.iter().collect();
    if let Some(w) = wanted {
        // Stable: matching region first, then the provider's order.
        rows.sort_by_key(|r| !jstr(r, "admin1").is_some_and(|a| a.eq_ignore_ascii_case(w)));
    }
    Ok(rows
        .into_iter()
        .filter_map(|r| {
            let name = jstr(r, "name")?;
            let (lat, lon) = (r.get("latitude")?.as_f64()?, r.get("longitude")?.as_f64()?);
            let cc = jstr(r, "country_code").unwrap_or_default();
            let admin1 = jstr(r, "admin1");
            let label = match (cc.as_str(), admin1.as_deref().and_then(region_code)) {
                ("US" | "CA", Some(code)) => format!("{name}, {code}"),
                _ => {
                    let country = jstr(r, "country").unwrap_or(cc);
                    if country.is_empty() {
                        name
                    } else {
                        format!("{name}, {country}")
                    }
                }
            };
            Some(Location::new(lat, lon, label))
        })
        .collect())
}

pub fn parse_nominatim_search(json: &str) -> Result<Option<Location>> {
    let v = parse_value(json)?;
    let Some(first) = v.as_array().and_then(|a| a.first()) else {
        return Ok(None);
    };
    let lat = first.get("lat").and_then(|x| {
        x.as_str()
            .and_then(|s| s.parse().ok())
            .or_else(|| x.as_f64())
    });
    let lon = first.get("lon").and_then(|x| {
        x.as_str()
            .and_then(|s| s.parse().ok())
            .or_else(|| x.as_f64())
    });
    let (Some(lat), Some(lon)) = (lat, lon) else {
        return Ok(None);
    };
    let label = jstr(first, "display_name")
        .map(|d| {
            d.split(',')
                .take(2)
                .map(str::trim)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    Ok(Some(Location::new(lat, lon, label)))
}

pub fn parse_reverse(json: &str) -> Result<Option<String>> {
    let v = parse_value(json)?;
    let Some(a) = v.get("address") else {
        return Ok(None);
    };
    let place = ["city", "town", "village", "hamlet", "county"]
        .iter()
        .find_map(|k| jstr(a, k));
    let Some(place) = place else { return Ok(None) };
    let tail = jstr(a, "ISO3166-2-lvl4")
        .and_then(|c| c.split_once('-').map(|(_, r)| r.to_string()))
        .or_else(|| jstr(a, "state"))
        .or_else(|| jstr(a, "country"));
    Ok(Some(match tail {
        Some(t) => format!("{place}, {t}"),
        None => place,
    }))
}

pub fn parse_ip(json: &str) -> Result<Option<Location>> {
    let v = parse_value(json)?;
    let (Some(lat), Some(lon)) = (
        v.get("latitude").and_then(Value::as_f64),
        v.get("longitude").and_then(Value::as_f64),
    ) else {
        return Ok(None);
    };
    let city = jstr(&v, "city").unwrap_or_default();
    let label = match (city.is_empty(), jstr(&v, "region_code")) {
        (false, Some(r)) => format!("{city}, {r}"),
        (false, None) => city,
        (true, Some(r)) => r,
        (true, None) => "Current Location".to_string(),
    };
    Ok(Some(Location::new(lat, lon, label)))
}

impl Net {
    pub async fn forecast(&self, lat: f64, lon: f64) -> Result<Weather> {
        parse_forecast(&self.get_text(&forecast_url(lat, lon), None).await?)
    }

    pub async fn geocode(&self, query: &str) -> Vec<Location> {
        let (name, region) = split_region(query);
        if name.is_empty() {
            return vec![];
        }
        match self
            .get_text(&geocode_url(&name), None)
            .await
            .and_then(|t| parse_geocode(&t, region.as_deref()))
        {
            Ok(r) if !r.is_empty() => return r,
            Ok(_) => {}
            Err(e) => tracing::debug!("open-meteo geocode failed: {e}"),
        }
        let url = format!(
            "https://nominatim.openstreetmap.org/search?q={}&format=json&limit=1",
            enc(query.trim())
        );
        match self
            .get_text(&url, None)
            .await
            .and_then(|t| parse_nominatim_search(&t))
        {
            Ok(Some(l)) => vec![l],
            Ok(None) => vec![],
            Err(e) => {
                tracing::debug!("nominatim search failed: {e}");
                vec![]
            }
        }
    }

    pub async fn reverse_geocode(&self, lat: f64, lon: f64) -> Option<String> {
        let url = format!(
            "https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&zoom=10"
        );
        parse_reverse(&self.get_text(&url, None).await.ok()?)
            .ok()
            .flatten()
    }

    pub async fn ip_geolocate(&self) -> Option<Location> {
        parse_ip(&self.get_text("https://ipapi.co/json/", None).await.ok()?)
            .ok()
            .flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FORECAST: &str = r#"{"timezone":"America/Phoenix",
      "current":{"temperature_2m":30.5,"relative_humidity_2m":20,"apparent_temperature":29.0,"weather_code":3,"wind_speed_10m":12.0,
                 "wind_direction_10m":180,"precipitation":0.0,"cloud_cover":50,"uv_index":null,"is_day":1},
      "hourly":{"time":["2026-01-01T00:00","2026-01-01T01:00"],"temperature_2m":[10.0,null],"weather_code":[0,61],
                "precipitation_probability":[5,80],"is_day":[0,0]},
      "daily":{"time":["2026-01-01"],"weather_code":[61],"temperature_2m_max":[20.0],"temperature_2m_min":[5.0],
               "precipitation_probability_max":[80],"sunrise":["2026-01-01T07:00"],"sunset":["2026-01-01T17:30"],"uv_index_max":[4.5]}}"#;

    #[test]
    fn forecast_parse() {
        let w = parse_forecast(FORECAST).unwrap();
        assert_eq!(w.timezone, "America/Phoenix");
        assert_eq!(w.current.temperature_c, 30.5);
        assert_eq!(w.current.uv_index, 0.0);
        assert!(w.current.is_day);
        assert_eq!(w.hourly.len(), 2);
        assert_eq!(w.hourly[1].temperature_c, 0.0);
        assert_eq!(w.hourly[1].weather_code, 61);
        assert_eq!(w.daily[0].sunset, "2026-01-01T17:30");
        assert_eq!(w.daily[0].uv_index_max, 4.5);
        assert_eq!(w.provider, WeatherProviderId::OpenMeteo);
        assert!(parse_forecast("{}").is_err());
    }

    #[test]
    fn forecast_url_has_params() {
        let u = forecast_url(1.5, -2.5);
        assert!(u.starts_with(
            "https://api.open-meteo.com/v1/forecast?latitude=1.5&longitude=-2.5&current="
        ));
        assert!(u.ends_with("&timezone=auto&forecast_days=7"));
    }

    #[test]
    fn region_split() {
        assert_eq!(
            split_region("Springfield, IL"),
            ("Springfield".into(), Some("IL".into()))
        );
        assert_eq!(split_region("Paris"), ("Paris".into(), None));
        assert_eq!(
            split_region("Paris, France"),
            ("Paris, France".into(), None)
        );
    }

    #[test]
    fn geocode_prefers_region_and_labels() {
        let j = r#"{"results":[
          {"name":"Springfield","latitude":39.8,"longitude":-89.6,"admin1":"Illinois","country_code":"US","country":"United States"},
          {"name":"Springfield","latitude":37.2,"longitude":-93.3,"admin1":"Missouri","country_code":"US","country":"United States"},
          {"name":"Springfield","latitude":51.7,"longitude":0.5,"admin1":"England","country_code":"GB","country":"United Kingdom"}]}"#;
        let r = parse_geocode(j, Some("MO")).unwrap();
        assert_eq!(r[0].label, "Springfield, MO");
        assert_eq!(r[1].label, "Springfield, IL");
        assert_eq!(r[2].label, "Springfield, United Kingdom");
        assert_eq!(parse_geocode(j, None).unwrap()[0].label, "Springfield, IL");
        assert!(parse_geocode("{}", None).unwrap().is_empty());
    }

    #[test]
    fn other_parsers() {
        let n = parse_nominatim_search(
            r#"[{"lat":"48.85","lon":"2.35","display_name":"Paris, Ile-de-France, France"}]"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(n.label, "Paris, Ile-de-France");
        assert_eq!(n.lat, 48.85);
        let r = parse_reverse(
            r#"{"address":{"town":"Safford","state":"Arizona","ISO3166-2-lvl4":"US-AZ"}}"#,
        )
        .unwrap();
        assert_eq!(r.as_deref(), Some("Safford, AZ"));
        let r2 = parse_reverse(r#"{"address":{"county":"Foo","country":"Chile"}}"#).unwrap();
        assert_eq!(r2.as_deref(), Some("Foo, Chile"));
        let ip = parse_ip(r#"{"latitude":1.0,"longitude":2.0,"city":"X","region_code":"TX"}"#)
            .unwrap()
            .unwrap();
        assert_eq!(ip.label, "X, TX");
    }
}
