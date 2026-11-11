//! Locally generated demo / easter-egg alerts.

use super::classify::{classify, display_event};
use crate::{Alert, AlertSource, Severity};
use chrono::{DateTime, Duration, SecondsFormat, Utc};

pub struct DemoGroup {
    pub name: &'static str,
    pub items: &'static [(&'static str, Severity)],
}

use Severity::{Extreme as X, Minor as Mi, Moderate as Mo, Severe as Sv};

pub static DEMO_GROUPS: &[DemoGroup] = &[
    DemoGroup {
        name: "Tornado",
        items: &[
            ("Tornado Warning", X),
            ("Tornado Watch", Sv),
            ("Tornado Emergency", X),
            ("Tornado Warning PDS", X),
        ],
    },
    DemoGroup {
        name: "Severe Thunderstorm",
        items: &[
            ("Severe Thunderstorm Warning", Sv),
            ("Severe Thunderstorm Watch", Mo),
            ("Severe Weather Statement", Mo),
            ("Special Weather Statement", Mi),
        ],
    },
    DemoGroup {
        name: "Tropical",
        items: &[
            ("Hurricane Warning", X),
            ("Hurricane Watch", Sv),
            ("Tropical Storm Warning", Sv),
            ("Tropical Storm Watch", Mo),
            ("Storm Surge Warning", X),
        ],
    },
    DemoGroup {
        name: "Flood",
        items: &[
            ("Flash Flood Emergency", X),
            ("Flash Flood Warning", Sv),
            ("Flash Flood Watch", Mo),
            ("Flood Warning", Mo),
            ("Coastal Flood Warning", Sv),
        ],
    },
    DemoGroup {
        name: "Winter",
        items: &[
            ("Blizzard Warning", Sv),
            ("Ice Storm Warning", Sv),
            ("Snow Squall Warning", Sv),
            ("Winter Storm Warning", Sv),
            ("Wind Chill Warning", Sv),
            ("Freeze Warning", Mo),
        ],
    },
    DemoGroup {
        name: "Wind",
        items: &[
            ("Extreme Wind Warning", X),
            ("High Wind Warning", Sv),
            ("Wind Advisory", Mi),
            ("Gale Warning", Mo),
        ],
    },
    DemoGroup {
        name: "Fire",
        items: &[
            ("Red Flag Warning", Sv),
            ("Fire Weather Watch", Mo),
            ("Extreme Fire Danger", X),
        ],
    },
    DemoGroup {
        name: "Heat",
        items: &[("Excessive Heat Warning", X), ("Heat Advisory", Mo)],
    },
    DemoGroup {
        name: "Fog/Visibility/Air",
        items: &[
            ("Dense Fog Advisory", Mi),
            ("Dense Smoke Advisory", Mi),
            ("Air Quality Alert", Mi),
        ],
    },
    DemoGroup {
        name: "Dust",
        items: &[("Dust Storm Warning", Sv), ("Blowing Dust Advisory", Mi)],
    },
    DemoGroup {
        name: "Coastal/Marine",
        items: &[
            ("Special Marine Warning", Sv),
            ("High Surf Advisory", Mi),
            ("Rip Current Statement", Mi),
            ("Tsunami Warning", X),
        ],
    },
    DemoGroup {
        name: "Volcanic/Geologic",
        items: &[
            ("Volcano Warning", X),
            ("Ashfall Advisory", Mi),
            ("Earthquake Warning", X),
            ("Avalanche Warning", Sv),
        ],
    },
    DemoGroup {
        name: "Evacuation",
        items: &[("Evacuation - Immediate", X), ("Evacuation Warning", Sv)],
    },
    DemoGroup {
        name: "Civil/Government",
        items: &[
            ("Civil Emergency Message", X),
            ("Shelter In Place Warning", X),
            ("Blue Alert", Sv),
            ("Child Abduction Emergency", Sv),
            ("911 Telephone Outage", Mi),
            ("Nuclear Power Plant Warning", X),
            ("Emergency Action Notification", X),
        ],
    },
    DemoGroup {
        name: "General",
        items: &[("Administrative Message", Mi), ("Mesoscale Discussion", Mo)],
    },
];

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    out.trim_end_matches('-').to_string()
}

fn ts(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// Build a demo alert for a menu item. The `"... PDS"` item is a Tornado
/// Warning whose text carries the PDS phrase.
pub fn build_demo_alert(event: &str, severity: Severity, now: DateTime<Utc>) -> Alert {
    let is_pds = event.trim_end().ends_with(" PDS");
    let event_name = if is_pds {
        event.trim_end().trim_end_matches(" PDS").trim_end()
    } else {
        event
    };
    let mut description =
        String::from("This is a demonstration alert generated locally. No action required.");
    if is_pds {
        description.push_str(" This is a particularly dangerous situation.");
    }
    let headline = format!("{event_name} issued (DEMO)");
    let class = classify(event_name, Some(&headline), Some(&description), severity);
    Alert {
        id: format!("demo:{}:{}", slug(event), now.timestamp()),
        source: AlertSource::Demo,
        event: event_name.to_string(),
        display_event: display_event(event_name, &class),
        class,
        headline: Some(headline),
        description: Some(description),
        instruction: None,
        severity,
        area_desc: Some("Demo County, Test State".into()),
        onset: Some(ts(now)),
        sent: Some(ts(now)),
        expires: Some(ts(now + Duration::hours(6))),
        issuing_office: None,
        url: None,
        geometry: None,
        affected_zones: vec![],
        vtec: None,
    }
}

/// The asteroid easter egg.
pub fn build_asteroid_alert(now: DateTime<Utc>, countdown_secs: u64) -> Alert {
    let description = format!(
        "A large asteroid has been detected on a collision course with Earth. Impact is projected in \
         {countdown_secs} seconds. This is not a drill.\n\n\
         Impact will produce a catastrophic shockwave, extreme heat, and widespread destruction. \
         Seek shelter below ground immediately. Move away from windows and exterior walls, and stay \
         away from the coast.\n\n\
         Do not attempt to travel. Remain calm, help those around you, and stay tuned to official \
         channels for further instructions. Impact in {countdown_secs} seconds."
    );
    Alert {
        id: format!("demo:asteroid:{}", now.timestamp()),
        source: AlertSource::Demo,
        event: "Asteroid Impact Warning".into(),
        display_event: "Asteroid Impact Warning".into(),
        class: "alert-asteroid".into(),
        headline: Some(format!(
            "Asteroid Impact Warning - impact in {countdown_secs} seconds"
        )),
        description: Some(description),
        instruction: Some("Seek shelter below ground immediately.".into()),
        severity: Severity::Extreme,
        area_desc: Some("Everywhere".into()),
        onset: Some(ts(now)),
        sent: Some(ts(now)),
        expires: Some(ts(now + Duration::seconds(countdown_secs as i64))),
        issuing_office: None,
        url: None,
        geometry: None,
        affected_zones: vec![],
        vtec: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 8, 11, 12, 0, 0).unwrap()
    }

    #[test]
    fn groups_shape() {
        assert_eq!(DEMO_GROUPS.len(), 15);
        assert_eq!(DEMO_GROUPS[0].name, "Tornado");
        assert_eq!(DEMO_GROUPS[0].items.len(), 4);
    }

    #[test]
    fn every_demo_item_gets_a_specific_class() {
        for g in DEMO_GROUPS {
            for (ev, sev) in g.items {
                let a = build_demo_alert(ev, *sev, now());
                assert_eq!(a.source, AlertSource::Demo);
                assert!(a.id.starts_with("demo:"), "{ev}");
                assert_eq!(a.area_desc.as_deref(), Some("Demo County, Test State"));
                // Only the generic "Winter Storm Warning" has no dedicated class.
                if *ev != "Winter Storm Warning" {
                    assert!(
                        !matches!(
                            a.class.as_str(),
                            "alert-extreme"
                                | "alert-severe"
                                | "alert-moderate"
                                | "alert-minor"
                                | "alert-unknown"
                        ) || matches!(
                            *ev,
                            "High Wind Warning"
                                | "Red Flag Warning"
                                | "Extreme Wind Warning"
                                | "Excessive Heat Warning"
                                | "Extreme Fire Danger"
                        ),
                        "{ev} -> {}",
                        a.class
                    );
                }
            }
        }
    }

    #[test]
    fn tiers() {
        let pds = build_demo_alert("Tornado Warning PDS", Severity::Extreme, now());
        assert_eq!(pds.event, "Tornado Warning");
        assert_eq!(pds.class, "alert-tornado-pds");
        assert_eq!(pds.display_event, "Tornado Warning (PDS)");
        assert!(pds
            .description
            .unwrap()
            .contains("particularly dangerous situation"));
        let em = build_demo_alert("Tornado Emergency", Severity::Extreme, now());
        assert_eq!(em.class, "alert-tornado-emergency");
        let plain = build_demo_alert("Tornado Warning", Severity::Extreme, now());
        assert_eq!(plain.class, "alert-tornado-warning");
        assert_eq!(
            plain.headline.as_deref(),
            Some("Tornado Warning issued (DEMO)")
        );
    }

    #[test]
    fn id_and_expiry() {
        let a = build_demo_alert("Heat Advisory", Severity::Moderate, now());
        assert_eq!(a.id, format!("demo:heat-advisory:{}", now().timestamp()));
        assert_eq!(a.expires.as_deref(), Some("2026-08-11T18:00:00Z"));
        assert_eq!(a.onset.as_deref(), Some("2026-08-11T12:00:00Z"));
    }

    #[test]
    fn asteroid() {
        let a = build_asteroid_alert(now(), 60);
        assert_eq!(a.class, "alert-asteroid");
        assert_eq!(a.severity, Severity::Extreme);
        assert_eq!(a.expires.as_deref(), Some("2026-08-11T12:01:00Z"));
        let d = a.description.unwrap();
        assert!(d.contains("in 60 seconds"));
        assert!(d.contains("below ground"));
        assert_eq!(d.split("\n\n").count(), 3);
        assert_eq!(
            classify("Asteroid Impact Warning", None, None, Severity::Extreme),
            "alert-asteroid"
        );
    }
}
