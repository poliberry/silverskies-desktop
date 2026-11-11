//! WMO weather-code helpers.

pub fn wmo_label(code: u8) -> &'static str {
    match code {
        0 => "Clear Sky",
        1 => "Mainly Clear",
        2 => "Partly Cloudy",
        3 => "Overcast",
        45 => "Fog",
        48 => "Icy Fog",
        51 => "Light Drizzle",
        53 => "Drizzle",
        55 => "Heavy Drizzle",
        56 => "Light Freezing Drizzle",
        57 => "Freezing Drizzle",
        61 => "Light Rain",
        63 => "Rain",
        65 => "Heavy Rain",
        66 => "Light Freezing Rain",
        67 => "Freezing Rain",
        71 => "Light Snow",
        73 => "Snow",
        75 => "Heavy Snow",
        77 => "Snow Grains",
        80 => "Light Showers",
        81 => "Showers",
        82 => "Heavy Showers",
        85 => "Snow Showers",
        86 => "Heavy Snow Showers",
        95 => "Thunderstorm",
        96 => "Thunderstorm + Hail",
        99 => "Severe Thunderstorm",
        _ => "Unknown",
    }
}

pub const SEVERE_WMO_CODES: &[u8] = &[95, 96, 99, 65, 82, 75, 86, 56, 57, 66, 67];

pub fn is_severe_code(code: u8) -> bool {
    SEVERE_WMO_CODES.contains(&code)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ConditionKey {
    ClearDay,
    ClearNight,
    PartlyCloudy,
    Overcast,
    Fog,
    Drizzle,
    Rain,
    HeavyRain,
    Snow,
    Thunderstorm,
    Hot,
    Windy,
}

pub fn condition_key(code: u8, is_day: bool) -> ConditionKey {
    match code {
        95 | 96 | 99 => ConditionKey::Thunderstorm,
        71 | 73 | 75 | 77 | 85 | 86 => ConditionKey::Snow,
        65 | 82 => ConditionKey::HeavyRain,
        61 | 63 | 80 | 81 => ConditionKey::Rain,
        51 | 53 | 55 => ConditionKey::Drizzle,
        45 | 48 => ConditionKey::Fog,
        3 => ConditionKey::Overcast,
        1 | 2 => ConditionKey::PartlyCloudy,
        _ if is_day => ConditionKey::ClearDay,
        _ => ConditionKey::ClearNight,
    }
}

pub fn condition_accent(key: ConditionKey) -> [u8; 3] {
    match key {
        ConditionKey::ClearDay => [255, 200, 60],
        ConditionKey::ClearNight => [80, 120, 220],
        ConditionKey::PartlyCloudy => [100, 180, 255],
        ConditionKey::Overcast => [140, 150, 170],
        ConditionKey::Fog => [160, 160, 180],
        ConditionKey::Drizzle => [80, 160, 220],
        ConditionKey::Rain => [60, 130, 210],
        ConditionKey::HeavyRain => [40, 100, 180],
        ConditionKey::Snow => [180, 220, 255],
        ConditionKey::Thunderstorm => [138, 100, 255],
        ConditionKey::Hot => [255, 120, 40],
        ConditionKey::Windy => [100, 200, 180],
    }
}

/// Accent for the current conditions: heat and wind override calm codes.
pub fn accent_for(code: u8, is_day: bool, temp_c: f64, wind_kmh: f64) -> [u8; 3] {
    let key = condition_key(code, is_day);
    let clearish = matches!(
        key,
        ConditionKey::ClearDay | ConditionKey::ClearNight | ConditionKey::PartlyCloudy
    );
    if temp_c >= 35.0 && clearish {
        return condition_accent(ConditionKey::Hot);
    }
    if wind_kmh >= 40.0 && code < 50 {
        return condition_accent(ConditionKey::Windy);
    }
    condition_accent(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels() {
        assert_eq!(wmo_label(0), "Clear Sky");
        assert_eq!(wmo_label(96), "Thunderstorm + Hail");
        assert_eq!(wmo_label(4), "Unknown");
        assert_eq!(wmo_label(255), "Unknown");
    }

    #[test]
    fn severity() {
        assert!(is_severe_code(95));
        assert!(is_severe_code(67));
        assert!(!is_severe_code(63));
        assert!(!is_severe_code(0));
    }
    #[test]
    fn keys() {
        assert_eq!(condition_key(96, true), ConditionKey::Thunderstorm);
        assert_eq!(condition_key(77, true), ConditionKey::Snow);
        assert_eq!(condition_key(82, true), ConditionKey::HeavyRain);
        assert_eq!(condition_key(81, true), ConditionKey::Rain);
        assert_eq!(condition_key(53, true), ConditionKey::Drizzle);
        assert_eq!(condition_key(48, true), ConditionKey::Fog);
        assert_eq!(condition_key(3, true), ConditionKey::Overcast);
        assert_eq!(condition_key(2, false), ConditionKey::PartlyCloudy);
        assert_eq!(condition_key(0, true), ConditionKey::ClearDay);
        assert_eq!(condition_key(0, false), ConditionKey::ClearNight);
    }

    #[test]
    fn accents() {
        assert_eq!(condition_accent(ConditionKey::Snow), [180, 220, 255]);
        assert_eq!(accent_for(0, true, 36.0, 0.0), [255, 120, 40]);
        assert_eq!(
            accent_for(63, true, 36.0, 0.0),
            condition_accent(ConditionKey::Rain)
        );
        assert_eq!(accent_for(3, true, 20.0, 50.0), [100, 200, 180]);
        assert_eq!(
            accent_for(63, true, 20.0, 50.0),
            condition_accent(ConditionKey::Rain)
        );
        assert_eq!(accent_for(0, true, 20.0, 5.0), [255, 200, 60]);
    }
}
