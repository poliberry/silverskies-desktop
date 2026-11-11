//! Cross-source merging and region/feed planning.

use crate::{Alert, Severity};
use std::cmp::Ordering;
use std::collections::HashSet;

/// De-dupe on `Alert::dedupe_key` (first wins), then sort by severity
/// (most severe first), then onset descending with missing onsets last.
pub fn dedupe_and_sort(alerts: Vec<Alert>) -> Vec<Alert> {
    let mut seen = HashSet::new();
    let mut out: Vec<Alert> = alerts
        .into_iter()
        .filter(|a| seen.insert(a.dedupe_key()))
        .collect();
    out.sort_by(|a, b| {
        a.severity
            .rank()
            .cmp(&b.severity.rank())
            .then_with(|| match (&a.onset, &b.onset) {
                (Some(x), Some(y)) => y.cmp(x),
                (Some(_), None) => Ordering::Less,
                (None, Some(_)) => Ordering::Greater,
                (None, None) => Ordering::Equal,
            })
    });
    out
}

pub fn is_canada(lat: f64, lon: f64) -> bool {
    (41.7..=83.1).contains(&lat) && (-141.0..=-52.6).contains(&lon)
}

pub fn is_australia(lat: f64, lon: f64) -> bool {
    (-44.0..=-10.0).contains(&lat) && (112.0..=154.0).contains(&lon)
}

pub fn in_nws_coverage(lat: f64, lon: f64) -> bool {
    (15.0..=72.0).contains(&lat) && (-180.0..=-60.0).contains(&lon)
}

pub fn is_us_like(lat: f64, lon: f64) -> bool {
    in_nws_coverage(lat, lon) && !is_canada(lat, lon)
}

/// Which feeds to query for a location.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeedPlan {
    pub nws: bool,
    pub eccc: bool,
    pub bom: bool,
    pub spc_md: bool,
    pub librewxr: bool,
}

pub fn feed_plan(lat: f64, lon: f64, has_willy_key: bool) -> FeedPlan {
    let canada = is_canada(lat, lon);
    let australia = is_australia(lat, lon);
    let nws_cov = in_nws_coverage(lat, lon);
    FeedPlan {
        nws: nws_cov,
        eccc: canada,
        bom: australia && has_willy_key,
        spc_md: nws_cov,
        librewxr: !nws_cov && !canada && (!australia || !has_willy_key),
    }
}

/// Map a WillyWeather warning classification to a severity.
pub fn severity_from_willy(classification: &str) -> Severity {
    match classification.trim().to_ascii_lowercase().as_str() {
        "tsunami" | "tornado" | "hurricane" | "typhoon" | "cyclone" | "volcano" | "earthquake" => {
            Severity::Extreme
        }
        "fire" | "flood" | "storm" | "strong-wind" | "wind" | "cold" | "heat" | "blizzard"
        | "avalanche" | "hazmat" => Severity::Severe,
        "marine"
        | "surf"
        | "frost"
        | "fog"
        | "cold-rain"
        | "wind-chill"
        | "road"
        | "dust-smoke-pollution" => Severity::Moderate,
        "farming" | "sheep" => Severity::Minor,
        _ => Severity::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AlertSource;

    fn a(event: &str, area: &str, onset: Option<&str>, sev: Severity) -> Alert {
        Alert {
            id: format!("{event}{area}"),
            source: AlertSource::Nws,
            event: event.into(),
            display_event: event.into(),
            class: "alert-unknown".into(),
            headline: None,
            description: None,
            instruction: None,
            severity: sev,
            area_desc: Some(area.into()),
            onset: onset.map(String::from),
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
    fn dedupes_keeping_first() {
        let mut first = a(
            "Heat Advisory",
            "X",
            Some("2026-01-01T00:00:00Z"),
            Severity::Minor,
        );
        first.id = "first".into();
        let mut dup = a(
            "HEAT ADVISORY",
            "x",
            Some("2026-01-01T00:00:00Z"),
            Severity::Minor,
        );
        dup.id = "second".into();
        let out = dedupe_and_sort(vec![first, dup]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "first");
    }

    #[test]
    fn sorts_severity_then_onset_desc_none_last() {
        let out = dedupe_and_sort(vec![
            a("B", "1", Some("2026-01-01T00:00:00Z"), Severity::Severe),
            a("C", "1", None, Severity::Severe),
            a("D", "1", Some("2026-02-01T00:00:00Z"), Severity::Severe),
            a("A", "1", Some("2025-01-01T00:00:00Z"), Severity::Extreme),
            a("E", "1", None, Severity::Minor),
        ]);
        let names: Vec<_> = out.iter().map(|x| x.event.as_str()).collect();
        assert_eq!(names, ["A", "D", "B", "C", "E"]);
    }

    #[test]
    fn regions() {
        assert!(is_canada(45.4, -75.7)); // Ottawa
        assert!(!is_canada(32.8, -109.7));
        assert!(is_australia(-33.9, 151.2)); // Sydney
        assert!(!is_australia(40.0, -100.0));
        assert!(in_nws_coverage(21.3, -157.8)); // Honolulu
        assert!(is_us_like(32.8, -109.7));
        assert!(!is_us_like(45.4, -75.7));
    }

    #[test]
    fn plans() {
        let us = feed_plan(32.8, -109.7, false);
        assert_eq!(
            us,
            FeedPlan {
                nws: true,
                eccc: false,
                bom: false,
                spc_md: true,
                librewxr: false
            }
        );
        let ca = feed_plan(45.4, -75.7, false);
        assert!(ca.eccc && ca.spc_md && !ca.librewxr);
        let au_key = feed_plan(-33.9, 151.2, true);
        assert!(au_key.bom && !au_key.librewxr && !au_key.spc_md);
        let au_nokey = feed_plan(-33.9, 151.2, false);
        assert!(!au_nokey.bom && au_nokey.librewxr && !au_nokey.nws);
        let eu = feed_plan(51.5, -0.1, true);
        assert!(!eu.nws && !eu.spc_md && eu.librewxr && !eu.eccc && !eu.bom);
    }

    #[test]
    fn willy() {
        assert_eq!(severity_from_willy("tsunami"), Severity::Extreme);
        assert_eq!(severity_from_willy("Strong-Wind"), Severity::Severe);
        assert_eq!(severity_from_willy("wind-chill"), Severity::Moderate);
        assert_eq!(severity_from_willy("cold-rain"), Severity::Moderate);
        assert_eq!(severity_from_willy("cold"), Severity::Severe);
        assert_eq!(severity_from_willy("sheep"), Severity::Minor);
        assert_eq!(severity_from_willy("zzz"), Severity::Unknown);
    }
}
