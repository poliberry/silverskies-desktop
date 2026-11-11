//! Default hazard-class colors, pulse colors and user overrides.

use super::classify::is_air_quality;
use crate::{Alert, AlertTypeOverride, Severity};
use std::collections::BTreeMap;

const FALLBACK: [u8; 3] = [0x88, 0x88, 0x88];

/// `(class key, human label, default hex)` for every known class.
pub static ALL_CLASSES: &[(&str, &str, &str)] = &[
    ("alert-tornado-emergency", "Tornado Emergency", "#8a0ba5"),
    ("alert-tornado-warning", "Tornado Warning", "#ff0550"),
    ("alert-tornado-watch", "Tornado Watch", "#7302ff"),
    (
        "alert-svr-pds",
        "Severe Thunderstorm Warning (PDS)",
        "#ff3300",
    ),
    (
        "alert-svr-destructive",
        "Severe Thunderstorm Warning (Destructive)",
        "#ff3300",
    ),
    ("alert-tornado-pds", "Tornado Warning (PDS)", "#7300ff"),
    (
        "alert-tornado-observed",
        "Tornado Warning (Confirmed)",
        "#bd0065",
    ),
    (
        "alert-severe-tstorm-warn",
        "Severe Thunderstorm Warning",
        "#ff7905",
    ),
    (
        "alert-severe-tstorm-watch",
        "Severe Thunderstorm Watch",
        "#a14c00",
    ),
    ("alert-hurricane-warning", "Hurricane Warning", "#ff0550"),
    ("alert-hurricane-watch", "Hurricane Watch", "#ff6680"),
    (
        "alert-hurricane-statement",
        "Hurricane Local Statement",
        "#ff9999",
    ),
    (
        "alert-tropical-storm-warn",
        "Tropical Storm Warning",
        "#ff7905",
    ),
    (
        "alert-tropical-storm-watch",
        "Tropical Storm Watch",
        "#ffaa44",
    ),
    (
        "alert-tropical-depression",
        "Tropical Depression",
        "#ffcc88",
    ),
    ("alert-flash-flood-warn", "Flash Flood Warning", "#00d9c0"),
    (
        "alert-flash-flood-emergency",
        "Flash Flood Emergency",
        "#00d9c0",
    ),
    ("alert-flood-warning", "Flood Warning", "#00d9c0"),
    ("alert-flash-flood-watch", "Flash Flood Watch", "#007060"),
    ("alert-marine-warning", "Special Marine Warning", "#c060a0"),
    (
        "alert-special-wx-stmt",
        "Special Weather Statement",
        "#daadff",
    ),
    ("alert-wind-chill-warn", "Wind Chill Warning", "#99ccff"),
    ("alert-wind-chill-watch", "Wind Chill Watch", "#7799cc"),
    ("alert-wind-chill-adv", "Wind Chill Advisory", "#5577aa"),
    (
        "alert-lake-effect-snow-warn",
        "Lake Effect Snow Warning",
        "#aaddff",
    ),
    (
        "alert-lake-effect-snow-adv",
        "Lake Effect Snow Advisory",
        "#88bbdd",
    ),
    (
        "alert-freezing-rain-adv",
        "Freezing Rain Advisory",
        "#66aadd",
    ),
    ("alert-sleet-warn", "Sleet Warning", "#5599cc"),
    ("alert-blizzard", "Blizzard Warning", "#5533cc"),
    ("alert-ice-storm", "Ice Storm Warning", "#44aaee"),
    ("alert-snow-squall", "Snow Squall Warning", "#c0ddff"),
    ("alert-fire-watch", "Fire Weather Watch", "#cc6600"),
    ("alert-extreme-fire", "Extreme Fire Danger", "#ff4400"),
    ("alert-wind-adv", "Wind Advisory", "#ddaa55"),
    ("alert-gale-warn", "Gale Warning", "#bb8833"),
    ("alert-heat-adv", "Heat Advisory", "#ff9944"),
    (
        "alert-excessive-heat-watch",
        "Excessive Heat Watch",
        "#ff6600",
    ),
    ("alert-hard-freeze-warn", "Hard Freeze Warning", "#aaccff"),
    ("alert-hard-freeze-watch", "Hard Freeze Watch", "#88aadd"),
    ("alert-freeze-warn", "Freeze Warning", "#4477aa"),
    ("alert-freeze-watch", "Freeze Watch", "#6688bb"),
    ("alert-storm-surge-warn", "Storm Surge Warning", "#ff44aa"),
    ("alert-storm-surge-watch", "Storm Surge Watch", "#cc3388"),
    ("alert-tsunami-warn", "Tsunami Warning", "#ff00cc"),
    ("alert-tsunami-watch", "Tsunami Watch", "#cc00aa"),
    ("alert-tsunami-adv", "Tsunami Advisory", "#990088"),
    (
        "alert-coastal-flood-warn",
        "Coastal Flood Warning",
        "#00bbdd",
    ),
    (
        "alert-coastal-flood-watch",
        "Coastal Flood Watch",
        "#0099bb",
    ),
    (
        "alert-coastal-flood-adv",
        "Coastal Flood Advisory",
        "#007799",
    ),
    (
        "alert-lakeshore-flood-warn",
        "Lakeshore Flood Warning",
        "#00aacc",
    ),
    ("alert-high-surf-warn", "High Surf Warning", "#0088cc"),
    ("alert-high-surf-adv", "High Surf Advisory", "#0066aa"),
    ("alert-rip-current", "Rip Current Statement", "#0055aa"),
    ("alert-dense-fog-adv", "Dense Fog Advisory", "#aaaaaa"),
    ("alert-dense-smoke-adv", "Dense Smoke Advisory", "#888877"),
    ("alert-low-water-adv", "Low Water Advisory", "#886644"),
    (
        "alert-severe-wx-stmt",
        "Severe Weather Statement",
        "#ffcc44",
    ),
    ("alert-ashfall-warn", "Ashfall Warning", "#aa8855"),
    ("alert-ashfall-adv", "Ashfall Advisory", "#997744"),
    ("alert-debris-flow", "Debris Flow", "#886633"),
    ("alert-avalanche-warn", "Avalanche Warning", "#ffffff"),
    ("alert-avalanche-watch", "Avalanche Watch", "#dddddd"),
    ("alert-avalanche-adv", "Avalanche Advisory", "#bbbbbb"),
    ("alert-air-quality", "Air Quality Alert", "#aaaa44"),
    ("alert-hydrological", "Hydrological Outlook", "#4488aa"),
    ("alert-volcano", "Volcano Warning", "#cc4400"),
    ("alert-dust-storm", "Dust Storm Warning", "#b08040"),
    ("alert-blowing-dust", "Blowing Dust Advisory", "#c8a87a"),
    (
        "alert-law-enforcement",
        "Law Enforcement Warning",
        "#4a6fa5",
    ),
    ("alert-blue-alert", "Blue Alert", "#1a6eff"),
    (
        "alert-civil-emergency",
        "Civil Emergency Message",
        "#e75480",
    ),
    ("alert-earthquake", "Earthquake Warning", "#ff2020"),
    (
        "alert-earthquake-advisory",
        "Earthquake Advisory",
        "#cc6644",
    ),
    ("alert-aftershock", "Aftershock", "#aa5533"),
    (
        "alert-shelter-in-place",
        "Shelter In Place Warning",
        "#ff2020",
    ),
    ("alert-evacuation", "Evacuation - Immediate", "#ffffff"),
    ("alert-evacuation-warning", "Evacuation Warning", "#ffe8b0"),
    ("alert-evacuation-watch", "Evacuation Watch", "#ddaa44"),
    ("alert-amber", "Amber Alert / Child Abduction", "#ffdd00"),
    ("alert-911-outage", "911 Telephone Outage", "#7a9ab5"),
    ("alert-nuclear", "Nuclear Power Plant Warning", "#39ff14"),
    ("alert-ean", "Emergency Action Notification", "#ffffff"),
    ("alert-admin-message", "Administrative Message", "#888888"),
    ("alert-extreme", "Extreme (other)", "#ff0550"),
    ("alert-severe", "Severe (other)", "#ff7905"),
    ("alert-moderate", "Moderate (other)", "#ffd040"),
    ("alert-minor", "Minor (other)", "#80d0ff"),
    ("alert-unknown", "Unknown", "#888888"),
    ("alert-asteroid", "Asteroid Impact Warning", "#ff4400"),
    (
        "alert-mesoscale-discussion",
        "Mesoscale Discussion",
        "#4a90d9",
    ),
    ("eccc-red", "ECCC Red Warning", "#cc0000"),
    ("eccc-orange", "ECCC Orange Warning", "#dd5500"),
    ("eccc-yellow", "ECCC Yellow Warning", "#bb8800"),
    ("eccc-statement", "ECCC Statement", "#555566"),
];

/// Parse `#rgb`, `#rrggbb`, with or without the `#`.
pub fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let h = s.trim().trim_start_matches('#');
    if !h.is_ascii() {
        return None;
    }
    match h.len() {
        3 => {
            let mut out = [0u8; 3];
            for (i, c) in h.chars().enumerate() {
                let v = c.to_digit(16)? as u8;
                out[i] = v * 17;
            }
            Some(out)
        }
        6 => {
            let p = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
            Some([p(0)?, p(2)?, p(4)?])
        }
        _ => None,
    }
}

/// Default color of a class; unknown classes are grey.
pub fn class_color(class: &str) -> [u8; 3] {
    ALL_CLASSES
        .iter()
        .find(|(c, _, _)| *c == class)
        .and_then(|(_, _, hex)| parse_hex(hex))
        .unwrap_or(FALLBACK)
}

/// Classes that make the UI glow/pulse.
pub fn pulse_color(class: &str) -> Option<[u8; 3]> {
    let hex = match class {
        "eccc-red" => "#cc0000",
        "eccc-orange" => "#dd5500",
        "alert-tornado-emergency" => "#8a0ba5",
        "alert-tornado-pds" => "#7300ff",
        "alert-tornado-observed" => "#bd0065",
        "alert-svr-pds" | "alert-svr-destructive" => "#ff3300",
        "alert-hurricane-warning" => "#ff0550",
        "alert-flash-flood-emergency" => "#00d9c0",
        "alert-civil-emergency" => "#e75480",
        "alert-earthquake" => "#ff2020",
        "alert-asteroid" => "#ff2200",
        "alert-dust-storm" => "#b08040",
        "alert-volcano" => "#cc4400",
        "alert-tsunami-warn" => "#ff00cc",
        "alert-avalanche-warn" => "#ffffff",
        "alert-debris-flow" => "#886633",
        "alert-ean" => "#ffffff",
        "alert-blue-alert" => "#1a6eff",
        "alert-amber" => "#ffdd00",
        "alert-nuclear" => "#39ff14",
        "alert-evacuation" => "#ffffff",
        _ => return None,
    };
    parse_hex(hex)
}

/// Color driving the top glow: first pulse-class alert, else the first
/// Extreme/Severe alert. Air-quality alerts never drive it.
pub fn active_pulse_color(alerts: &[Alert]) -> Option<[u8; 3]> {
    let relevant = || alerts.iter().filter(|a| !is_air_quality(&a.event));
    if let Some(c) = relevant().find_map(|a| pulse_color(&a.class)) {
        return Some(c);
    }
    relevant()
        .find(|a| matches!(a.severity, Severity::Extreme | Severity::Severe))
        .map(|a| class_color(&a.class))
}

/// Class color after applying the user's override (if parseable).
pub fn effective_color(class: &str, overrides: &BTreeMap<String, AlertTypeOverride>) -> [u8; 3] {
    overrides
        .get(class)
        .and_then(|o| o.color.as_deref())
        .and_then(parse_hex)
        .unwrap_or_else(|| class_color(class))
}

/// Whether the class is shown (default true).
pub fn effective_visible(class: &str, overrides: &BTreeMap<String, AlertTypeOverride>) -> bool {
    overrides.get(class).and_then(|o| o.visible).unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AlertSource;

    fn alert(event: &str, class: &str, sev: Severity) -> Alert {
        Alert {
            id: "x".into(),
            source: AlertSource::Nws,
            event: event.into(),
            display_event: event.into(),
            class: class.into(),
            headline: None,
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
    fn hex_parsing() {
        assert_eq!(parse_hex("#ff0550"), Some([255, 5, 80]));
        assert_eq!(parse_hex("ff0550"), Some([255, 5, 80]));
        assert_eq!(parse_hex("#fff"), Some([255, 255, 255]));
        assert_eq!(parse_hex("#a0c"), Some([0xaa, 0x00, 0xcc]));
        assert_eq!(parse_hex("#ff05"), None);
        assert_eq!(parse_hex("#gggggg"), None);
        assert_eq!(parse_hex("é12345"), None);
    }

    #[test]
    fn every_table_entry_parses_and_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for (c, _, hex) in ALL_CLASSES {
            assert!(parse_hex(hex).is_some(), "{c}");
            assert!(seen.insert(*c), "dup {c}");
        }
    }

    #[test]
    fn every_classify_rule_has_a_color_entry() {
        for (_, class) in super::super::classify::RULES {
            assert!(ALL_CLASSES.iter().any(|(c, _, _)| c == class), "{class}");
        }
        for c in [
            "alert-tornado-emergency",
            "alert-tornado-pds",
            "alert-tornado-observed",
            "alert-svr-pds",
            "alert-svr-destructive",
        ] {
            assert!(ALL_CLASSES.iter().any(|(k, _, _)| *k == c), "{c}");
        }
    }

    #[test]
    fn colors() {
        assert_eq!(class_color("alert-tornado-warning"), [255, 5, 80]);
        assert_eq!(class_color("eccc-red"), [0xcc, 0, 0]);
        assert_eq!(class_color("nope"), [0x88, 0x88, 0x88]);
    }

    #[test]
    fn pulse() {
        assert_eq!(pulse_color("alert-nuclear"), Some([0x39, 0xff, 0x14]));
        assert_eq!(pulse_color("alert-heat-adv"), None);
    }

    #[test]
    fn active_pulse() {
        let a = vec![
            alert("Air Quality Alert", "alert-ean", Severity::Extreme),
            alert("Heat Advisory", "alert-heat-adv", Severity::Minor),
            alert("Tornado Warning", "alert-tornado-pds", Severity::Extreme),
        ];
        assert_eq!(active_pulse_color(&a), Some([0x73, 0x00, 0xff]));
        let b = vec![
            alert("Heat Advisory", "alert-heat-adv", Severity::Minor),
            alert("Red Flag Warning", "alert-severe", Severity::Severe),
        ];
        assert_eq!(active_pulse_color(&b), Some(class_color("alert-severe")));
        let c = vec![alert(
            "Air Quality Alert",
            "alert-air-quality",
            Severity::Severe,
        )];
        assert_eq!(active_pulse_color(&c), None);
        assert_eq!(active_pulse_color(&[]), None);
    }

    #[test]
    fn overrides() {
        let mut m = BTreeMap::new();
        m.insert(
            "alert-heat-adv".to_string(),
            AlertTypeOverride {
                visible: Some(false),
                color: Some("#00ff00".into()),
            },
        );
        m.insert(
            "alert-wind-adv".to_string(),
            AlertTypeOverride {
                visible: None,
                color: Some("garbage".into()),
            },
        );
        assert_eq!(effective_color("alert-heat-adv", &m), [0, 255, 0]);
        assert!(!effective_visible("alert-heat-adv", &m));
        assert_eq!(
            effective_color("alert-wind-adv", &m),
            class_color("alert-wind-adv")
        );
        assert!(effective_visible("alert-wind-adv", &m));
        assert!(effective_visible("alert-other", &m));
    }
}
