//! Unit conversion and display formatting. Values are stored metric.

use crate::{TimeFormat, UnitPref};
use chrono::{Datelike, NaiveDate};

pub fn c_to_f(c: f64) -> f64 {
    c * 9.0 / 5.0 + 32.0
}

fn round_i(v: f64) -> i64 {
    let r = v.round();
    if r == 0.0 {
        0
    } else {
        r as i64
    }
}

pub fn fmt_temp(c: f64, units: UnitPref) -> String {
    match units {
        UnitPref::F => format!("{}°F", round_i(c_to_f(c))),
        UnitPref::C => format!("{}°C", round_i(c)),
    }
}

pub fn fmt_wind(kmh: f64, units: UnitPref) -> String {
    match units {
        UnitPref::F => format!("{} mph", round_i(kmh * 0.621_371)),
        UnitPref::C => format!("{} km/h", round_i(kmh)),
    }
}

pub fn fmt_precip(mm: f64, units: UnitPref) -> String {
    match units {
        UnitPref::F => format!("{:.2} in", mm / 25.4),
        UnitPref::C => format!("{mm:.1} mm"),
    }
}

pub fn compass_8(deg: f64) -> &'static str {
    const D: [&str; 8] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    D[(((deg.rem_euclid(360.0)) + 22.5) / 45.0) as usize % 8]
}

pub fn uv_label(uv: f64) -> (&'static str, [u8; 3]) {
    if uv <= 2.0 {
        ("Low", [0x5d, 0xff, 0xb0])
    } else if uv <= 5.0 {
        ("Moderate", [0xff, 0xcc, 0x44])
    } else if uv <= 7.0 {
        ("High", [0xff, 0x88, 0x44])
    } else if uv <= 10.0 {
        ("Very High", [0xff, 0x66, 0x44])
    } else {
        ("Extreme", [0xff, 0x44, 0xaa])
    }
}

/// Hour-only label: `3 PM` / `15:00`.
pub fn fmt_hour(hh: u32, fmt: TimeFormat) -> String {
    match fmt {
        TimeFormat::H24 => format!("{:02}:00", hh % 24),
        TimeFormat::H12 => {
            let h = hh % 24;
            let suffix = if h < 12 { "AM" } else { "PM" };
            let h12 = if h.is_multiple_of(12) { 12 } else { h % 12 };
            format!("{h12} {suffix}")
        }
    }
}

/// Full clock: `3:05 PM` / `15:05`.
pub fn fmt_clock(hh: u32, mm: u32, fmt: TimeFormat) -> String {
    match fmt {
        TimeFormat::H24 => format!("{:02}:{:02}", hh % 24, mm),
        TimeFormat::H12 => {
            let h = hh % 24;
            let suffix = if h < 12 { "AM" } else { "PM" };
            let h12 = if h.is_multiple_of(12) { 12 } else { h % 12 };
            format!("{h12}:{mm:02} {suffix}")
        }
    }
}

/// Parse the `HH:MM` out of `YYYY-MM-DDTHH:MM[...]`.
fn parse_hhmm(iso_local: &str) -> Option<(u32, u32)> {
    let time = iso_local.split_once('T')?.1;
    let hh: u32 = time.get(0..2)?.parse().ok()?;
    let mm: u32 = time.get(3..5)?.parse().ok()?;
    (hh < 24 && mm < 60).then_some((hh, mm))
}

/// Hour-only label from an ISO local time. Unparseable input is returned as-is.
pub fn fmt_time(iso_local: &str, fmt: TimeFormat) -> String {
    match parse_hhmm(iso_local) {
        Some((h, _)) => fmt_hour(h, fmt),
        None => iso_local.to_string(),
    }
}

/// Full clock from an ISO local time (e.g. sunrise). Unparseable input is returned as-is.
pub fn fmt_time_full(iso_local: &str, fmt: TimeFormat) -> String {
    match parse_hhmm(iso_local) {
        Some((h, m)) => fmt_clock(h, m, fmt),
        None => iso_local.to_string(),
    }
}

/// `Tue 11` from `2026-08-11`.
pub fn fmt_date_short(date: &str) -> String {
    match NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        Ok(d) => format!("{} {}", d.format("%a"), d.day()),
        Err(_) => date.to_string(),
    }
}

/// `Updated 2m ago`.
pub fn fmt_ago(secs: i64) -> String {
    if secs < 60 {
        "Updated just now".to_string()
    } else if secs < 3600 {
        format!("Updated {}m ago", secs / 60)
    } else if secs < 86_400 {
        format!("Updated {}h ago", secs / 3600)
    } else {
        format!("Updated {}d ago", secs / 86_400)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temps() {
        assert_eq!(c_to_f(100.0), 212.0);
        assert_eq!(fmt_temp(22.0, UnitPref::C), "22°C");
        assert_eq!(fmt_temp(22.2, UnitPref::F), "72°F");
        assert_eq!(fmt_temp(-0.2, UnitPref::C), "0°C");
        assert_eq!(fmt_temp(-10.0, UnitPref::C), "-10°C");
    }

    #[test]
    fn wind_precip() {
        assert_eq!(fmt_wind(19.0, UnitPref::C), "19 km/h");
        assert_eq!(fmt_wind(19.0, UnitPref::F), "12 mph");
        assert_eq!(fmt_precip(25.4, UnitPref::F), "1.00 in");
        assert_eq!(fmt_precip(3.04, UnitPref::C), "3.0 mm");
    }

    #[test]
    fn compass() {
        assert_eq!(compass_8(0.0), "N");
        assert_eq!(compass_8(44.0), "NE");
        assert_eq!(compass_8(90.0), "E");
        assert_eq!(compass_8(225.0), "SW");
        assert_eq!(compass_8(359.0), "N");
        assert_eq!(compass_8(-45.0), "NW");
        assert_eq!(compass_8(360.0 + 180.0), "S");
    }

    #[test]
    fn uv() {
        assert_eq!(uv_label(0.0).0, "Low");
        assert_eq!(uv_label(2.0).1, [0x5d, 0xff, 0xb0]);
        assert_eq!(uv_label(5.0).0, "Moderate");
        assert_eq!(uv_label(7.0).0, "High");
        assert_eq!(uv_label(10.0).0, "Very High");
        assert_eq!(uv_label(11.0), ("Extreme", [0xff, 0x44, 0xaa]));
    }

    #[test]
    fn times() {
        assert_eq!(fmt_time("2026-08-11T15:00", TimeFormat::H12), "3 PM");
        assert_eq!(fmt_time("2026-08-11T15:00", TimeFormat::H24), "15:00");
        assert_eq!(fmt_time("2026-08-11T00:00", TimeFormat::H12), "12 AM");
        assert_eq!(fmt_time("2026-08-11T12:30", TimeFormat::H12), "12 PM");
        assert_eq!(fmt_time("garbage", TimeFormat::H12), "garbage");
        assert_eq!(fmt_hour(9, TimeFormat::H12), "9 AM");
        assert_eq!(fmt_clock(15, 5, TimeFormat::H12), "3:05 PM");
        assert_eq!(fmt_clock(15, 5, TimeFormat::H24), "15:05");
        assert_eq!(
            fmt_time_full("2026-08-11T06:07", TimeFormat::H12),
            "6:07 AM"
        );
    }

    #[test]
    fn dates_and_ago() {
        assert_eq!(fmt_date_short("2026-08-11"), "Tue 11");
        assert_eq!(fmt_date_short("nope"), "nope");
        assert_eq!(fmt_ago(5), "Updated just now");
        assert_eq!(fmt_ago(120), "Updated 2m ago");
        assert_eq!(fmt_ago(7200), "Updated 2h ago");
        assert_eq!(fmt_ago(172_800), "Updated 2d ago");
        assert_eq!(fmt_ago(-4), "Updated just now");
    }
}
