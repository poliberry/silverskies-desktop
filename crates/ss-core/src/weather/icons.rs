//! Google "Pixel Weather" icon identifiers and the WMO code mapping.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PixelIcon {
    Sunny,
    ClearNight,
    MostlySunny,
    MostlyClearNight,
    PartlyCloudy,
    PartlyCloudyNight,
    Cloudy,
    Drizzle,
    WintryMix,
    SleetHail,
    HeavyRain,
    Flurries,
    HeavySnow,
    StrongThunderstorms,
}

/// Map a WMO weather code to a Pixel Weather icon.
pub fn pixel_icon(code: u8, is_day: bool) -> PixelIcon {
    use PixelIcon::*;
    match code {
        0 => {
            if is_day {
                Sunny
            } else {
                ClearNight
            }
        }
        1 => {
            if is_day {
                MostlySunny
            } else {
                MostlyClearNight
            }
        }
        2 | 80 => {
            if is_day {
                PartlyCloudy
            } else {
                PartlyCloudyNight
            }
        }
        3 | 45 | 48 => Cloudy,
        51 | 53 | 55 | 61 => Drizzle,
        56 | 66 => WintryMix,
        57 | 67 => SleetHail,
        63 | 65 | 81 | 82 => HeavyRain,
        71 | 77 | 85 => Flurries,
        73 | 75 | 86 => HeavySnow,
        95 | 96 | 99 => StrongThunderstorms,
        _ => Cloudy,
    }
}

impl PixelIcon {
    pub const ALL: [PixelIcon; 14] = [
        PixelIcon::Sunny,
        PixelIcon::ClearNight,
        PixelIcon::MostlySunny,
        PixelIcon::MostlyClearNight,
        PixelIcon::PartlyCloudy,
        PixelIcon::PartlyCloudyNight,
        PixelIcon::Cloudy,
        PixelIcon::Drizzle,
        PixelIcon::WintryMix,
        PixelIcon::SleetHail,
        PixelIcon::HeavyRain,
        PixelIcon::Flurries,
        PixelIcon::HeavySnow,
        PixelIcon::StrongThunderstorms,
    ];

    /// Google's snake_case icon name.
    pub fn name(self) -> &'static str {
        match self {
            PixelIcon::Sunny => "sunny",
            PixelIcon::ClearNight => "clear_night",
            PixelIcon::MostlySunny => "mostly_sunny",
            PixelIcon::MostlyClearNight => "mostly_clear_night",
            PixelIcon::PartlyCloudy => "partly_cloudy",
            PixelIcon::PartlyCloudyNight => "partly_cloudy_night",
            PixelIcon::Cloudy => "cloudy",
            PixelIcon::Drizzle => "drizzle",
            PixelIcon::WintryMix => "wintry_mix",
            PixelIcon::SleetHail => "sleet_hail",
            PixelIcon::HeavyRain => "heavy_rain",
            PixelIcon::Flurries => "flurries",
            PixelIcon::HeavySnow => "heavy_snow",
            PixelIcon::StrongThunderstorms => "strong_thunderstorms",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn mapping() {
        use PixelIcon::*;
        for (code, day, night) in [
            (0, Sunny, ClearNight),
            (1, MostlySunny, MostlyClearNight),
            (2, PartlyCloudy, PartlyCloudyNight),
            (80, PartlyCloudy, PartlyCloudyNight),
        ] {
            assert_eq!(pixel_icon(code, true), day, "code {code} day");
            assert_eq!(pixel_icon(code, false), night, "code {code} night");
        }
        let fixed: &[(&[u8], PixelIcon)] = &[
            (&[3, 45, 48], Cloudy),
            (&[51, 53, 55, 61], Drizzle),
            (&[56, 66], WintryMix),
            (&[57, 67], SleetHail),
            (&[63, 65, 81, 82], HeavyRain),
            (&[71, 77, 85], Flurries),
            (&[73, 75, 86], HeavySnow),
            (&[95, 96, 99], StrongThunderstorms),
        ];
        for (codes, icon) in fixed {
            for &c in *codes {
                assert_eq!(pixel_icon(c, true), *icon, "code {c}");
                assert_eq!(pixel_icon(c, false), *icon, "code {c}");
            }
        }
        assert_eq!(pixel_icon(4, true), Cloudy);
        assert_eq!(pixel_icon(255, false), Cloudy);
    }

    #[test]
    fn names() {
        assert_eq!(PixelIcon::PartlyCloudyNight.name(), "partly_cloudy_night");
        let names: HashSet<_> = PixelIcon::ALL.iter().map(|i| i.name()).collect();
        assert_eq!(names.len(), 14);
    }
}
