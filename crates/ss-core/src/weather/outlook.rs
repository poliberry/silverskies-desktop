//! Today's-outlook banner text and notification candidates.

use super::units::fmt_wind;
use super::wmo::{is_severe_code, wmo_label};
use crate::{Alert, Severity, UnitPref, Weather};

/// Text for the "today" outlook row, or `None` when nothing notable.
pub fn today_outlook(w: &Weather, units: UnitPref) -> Option<String> {
    let d = w.daily.first()?;
    let pop = d.precipitation_probability_max_pct;
    // Hourly data carries no wind, so current wind is the proxy.
    let wind = w.current.wind_speed_kmh;
    let rainy = pop >= 40.0;
    let windy = wind >= 40.0;
    let severe = is_severe_code(d.weather_code);
    if !(rainy || windy || severe) {
        return None;
    }
    let mut parts = vec![wmo_label(d.weather_code).to_string()];
    if rainy {
        parts.push(format!("{}% precip", pop.round() as i64));
    }
    if windy {
        parts.push(format!("wind {}", fmt_wind(wind, units)));
    }
    Some(format!("Today's outlook: {}", parts.join(" · ")))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    /// Stable de-dupe key so each notification fires once.
    pub key: String,
    pub title: String,
    pub body: String,
}

pub fn notification_candidates(
    loc_label: &str,
    w: &Weather,
    alerts: &[Alert],
    today: &str,
) -> Vec<Notification> {
    let mut out = Vec::new();
    for a in alerts {
        if matches!(
            a.severity,
            Severity::Extreme | Severity::Severe | Severity::Moderate
        ) {
            let body = a
                .headline
                .clone()
                .or_else(|| a.area_desc.clone())
                .unwrap_or_else(|| loc_label.to_string());
            out.push(Notification {
                key: format!("alert:{loc_label}:{}", a.id),
                title: a.display_event.clone(),
                body,
            });
        }
    }
    if let Some(d) = w.daily.get(1) {
        if d.precipitation_probability_max_pct >= 60.0 {
            out.push(Notification {
                key: format!("forecast-rain:{loc_label}:{}", d.date),
                title: "Rain likely tomorrow".into(),
                body: format!(
                    "{}% chance of precipitation in {loc_label}",
                    d.precipitation_probability_max_pct.round() as i64
                ),
            });
        }
        if is_severe_code(d.weather_code) {
            out.push(Notification {
                key: format!("forecast-severe:{loc_label}:{}", d.date),
                title: "Severe weather tomorrow".into(),
                body: format!("{} forecast in {loc_label}", wmo_label(d.weather_code)),
            });
        }
    }
    if let Some(h) = w
        .hourly
        .iter()
        .take(12)
        .find(|h| is_severe_code(h.weather_code))
    {
        out.push(Notification {
            key: format!("severe-heads-up:{loc_label}:{today}"),
            title: "Severe weather heads-up".into(),
            body: format!(
                "{} expected in {loc_label} within 12 hours",
                wmo_label(h.weather_code)
            ),
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AlertSource, CurrentConditions, DailyPoint, HourlyPoint, WeatherProviderId};

    fn daily(date: &str, code: u8, pop: f64) -> DailyPoint {
        DailyPoint {
            date: date.into(),
            weather_code: code,
            temp_max_c: 20.0,
            temp_min_c: 10.0,
            precipitation_probability_max_pct: pop,
            sunrise: "2026-08-11T06:00".into(),
            sunset: "2026-08-11T20:00".into(),
            uv_index_max: 5.0,
        }
    }

    fn hourly(i: usize, code: u8) -> HourlyPoint {
        HourlyPoint {
            time: format!("2026-08-11T{:02}:00", i % 24),
            temperature_c: 20.0,
            weather_code: code,
            is_day: true,
            precipitation_probability_pct: 0.0,
        }
    }

    fn weather(wind: f64, days: Vec<DailyPoint>, hours: Vec<HourlyPoint>) -> Weather {
        Weather {
            current: CurrentConditions {
                temperature_c: 20.0,
                apparent_temperature_c: 20.0,
                weather_code: 0,
                is_day: true,
                relative_humidity_pct: 50.0,
                wind_speed_kmh: wind,
                wind_direction_deg: 0.0,
                precipitation_mm: 0.0,
                cloud_cover_pct: 0.0,
                uv_index: 1.0,
            },
            hourly: hours,
            daily: days,
            timezone: "UTC".into(),
            provider: WeatherProviderId::OpenMeteo,
        }
    }

    fn alert(id: &str, sev: Severity) -> Alert {
        Alert {
            id: id.into(),
            source: AlertSource::Nws,
            event: "Heat Advisory".into(),
            display_event: "Heat Advisory".into(),
            class: "alert-heat-adv".into(),
            headline: Some("Hot".into()),
            description: None,
            instruction: None,
            severity: sev,
            area_desc: None,
            onset: None,
            sent: None,
            expires: None,
            issuing_office: None,
            url: None,
            geometry: None,
            affected_zones: vec![],
            vtec: None,
        }
    }

    #[test]
    fn outlook_quiet_is_none() {
        let w = weather(10.0, vec![daily("2026-08-11", 0, 10.0)], vec![]);
        assert_eq!(today_outlook(&w, UnitPref::C), None);
        assert_eq!(
            today_outlook(&weather(0.0, vec![], vec![]), UnitPref::C),
            None
        );
    }

    #[test]
    fn outlook_parts() {
        let w = weather(10.0, vec![daily("2026-08-11", 63, 70.0)], vec![]);
        assert_eq!(
            today_outlook(&w, UnitPref::C).unwrap(),
            "Today's outlook: Rain · 70% precip"
        );
        let w = weather(50.0, vec![daily("2026-08-11", 63, 70.0)], vec![]);
        assert_eq!(
            today_outlook(&w, UnitPref::C).unwrap(),
            "Today's outlook: Rain · 70% precip · wind 50 km/h"
        );
        let w = weather(50.0, vec![daily("2026-08-11", 0, 0.0)], vec![]);
        assert_eq!(
            today_outlook(&w, UnitPref::F).unwrap(),
            "Today's outlook: Clear Sky · wind 31 mph"
        );
        let w = weather(0.0, vec![daily("2026-08-11", 95, 10.0)], vec![]);
        assert_eq!(
            today_outlook(&w, UnitPref::C).unwrap(),
            "Today's outlook: Thunderstorm"
        );
    }

    #[test]
    fn notifications() {
        let hours: Vec<_> = (0..24)
            .map(|i| hourly(i, if i == 8 { 95 } else { 0 }))
            .collect();
        let w = weather(
            0.0,
            vec![daily("2026-08-11", 0, 0.0), daily("2026-08-12", 95, 80.0)],
            hours,
        );
        let alerts = vec![alert("a1", Severity::Severe), alert("a2", Severity::Minor)];
        let n = notification_candidates("Home", &w, &alerts, "2026-08-11");
        let keys: Vec<_> = n.iter().map(|x| x.key.as_str()).collect();
        assert_eq!(
            keys,
            [
                "alert:Home:a1",
                "forecast-rain:Home:2026-08-12",
                "forecast-severe:Home:2026-08-12",
                "severe-heads-up:Home:2026-08-11"
            ]
        );
        assert_eq!(n[0].title, "Heat Advisory");
        assert_eq!(n[1].title, "Rain likely tomorrow");
    }

    #[test]
    fn heads_up_only_in_next_12() {
        let hours: Vec<_> = (0..24)
            .map(|i| hourly(i, if i == 20 { 95 } else { 0 }))
            .collect();
        let w = weather(0.0, vec![daily("2026-08-11", 0, 0.0)], hours);
        assert!(notification_candidates("Home", &w, &[], "2026-08-11").is_empty());
    }
}
