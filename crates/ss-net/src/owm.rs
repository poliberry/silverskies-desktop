//! OpenWeatherMap: air quality and map tile URLs.

use crate::{parse_value, Net, NetError, Result};
use serde_json::Value;
use ss_core::types::AirQuality;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwmLayer {
    Wind,
    Temp,
    Precip,
}

impl OwmLayer {
    pub fn id(self) -> &'static str {
        match self {
            OwmLayer::Wind => "wind_new",
            OwmLayer::Temp => "temp_new",
            OwmLayer::Precip => "precipitation_new",
        }
    }
}

pub fn tile_url(layer: OwmLayer, z: u32, x: u32, y: u32, key: &str) -> String {
    format!(
        "https://tile.openweathermap.org/map/{}/{z}/{x}/{y}.png?appid={key}",
        layer.id()
    )
}

pub fn air_quality_url(key: &str, lat: f64, lon: f64) -> String {
    format!("https://api.openweathermap.org/data/2.5/air_pollution?lat={lat}&lon={lon}&appid={key}")
}

pub fn parse_air_quality(json: &str) -> Result<AirQuality> {
    let v = parse_value(json)?;
    let item = v
        .get("list")
        .and_then(Value::as_array)
        .and_then(|a| a.first())
        .ok_or(NetError::Missing("list[0]"))?;
    let aqi = item
        .get("main")
        .and_then(|m| m.get("aqi"))
        .and_then(Value::as_u64)
        .ok_or(NetError::Missing("main.aqi"))?;
    let c = |k: &str| {
        item.get("components")
            .and_then(|c| c.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    Ok(AirQuality {
        aqi: aqi.min(255) as u8,
        pm2_5: c("pm2_5"),
        pm10: c("pm10"),
        o3: c("o3"),
        no2: c("no2"),
    })
}

impl Net {
    pub async fn air_quality(&self, key: &str, lat: f64, lon: f64) -> Result<AirQuality> {
        parse_air_quality(&self.get_text(&air_quality_url(key, lat, lon), None).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tiles() {
        assert_eq!(
            tile_url(OwmLayer::Precip, 3, 1, 2, "K"),
            "https://tile.openweathermap.org/map/precipitation_new/3/1/2.png?appid=K"
        );
        assert!(tile_url(OwmLayer::Wind, 0, 0, 0, "K").contains("/wind_new/"));
        assert!(tile_url(OwmLayer::Temp, 0, 0, 0, "K").contains("/temp_new/"));
    }

    #[test]
    fn aqi_parse() {
        let j = r#"{"list":[{"main":{"aqi":2},"components":{"pm2_5":8.5,"pm10":12.0,"o3":60.1,"no2":3.2,"co":200}}]}"#;
        let a = parse_air_quality(j).unwrap();
        assert_eq!(a.aqi, 2);
        assert_eq!(a.pm2_5, 8.5);
        assert_eq!(a.no2, 3.2);
        assert!(parse_air_quality(r#"{"list":[]}"#).is_err());
    }
}
