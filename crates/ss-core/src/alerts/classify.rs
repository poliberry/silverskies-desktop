//! Event-name -> hazard class classification.

use crate::Severity;
use once_cell::sync::Lazy;
use regex::Regex;

/// Ordered `(pattern, class)` table matched case-insensitively against the
/// event name; first match wins. Specific entries must precede the general
/// ones they contain (e.g. `coastal flood warning` before `flood warning`).
pub(crate) const RULES: &[(&str, &str)] = &[
    ("tornado warning", "alert-tornado-warning"),
    ("tornado watch", "alert-tornado-watch"),
    ("severe thunderstorm warning", "alert-severe-tstorm-warn"),
    ("severe thunderstorm watch", "alert-severe-tstorm-watch"),
    ("severe weather statement", "alert-severe-wx-stmt"),
    ("hurricane warning", "alert-hurricane-warning"),
    ("hurricane watch", "alert-hurricane-watch"),
    ("hurricane local statement", "alert-hurricane-statement"),
    ("tropical storm warning", "alert-tropical-storm-warn"),
    ("tropical storm watch", "alert-tropical-storm-watch"),
    ("tropical depression", "alert-tropical-depression"),
    ("flash flood emergency", "alert-flash-flood-emergency"),
    ("flash flood warning", "alert-flash-flood-warn"),
    ("flash flood watch", "alert-flash-flood-watch"),
    ("coastal flood warning", "alert-coastal-flood-warn"),
    ("coastal flood watch", "alert-coastal-flood-watch"),
    ("coastal flood advisory", "alert-coastal-flood-adv"),
    ("lakeshore flood warning", "alert-lakeshore-flood-warn"),
    ("flood warning", "alert-flood-warning"),
    ("hydrologic(al)? outlook|hydrology", "alert-hydrological"),
    ("blizzard warning", "alert-blizzard"),
    ("ice storm warning", "alert-ice-storm"),
    ("snow squall warning", "alert-snow-squall"),
    ("lake effect snow warning", "alert-lake-effect-snow-warn"),
    ("lake effect snow advisory", "alert-lake-effect-snow-adv"),
    ("wind chill warning", "alert-wind-chill-warn"),
    ("wind chill watch", "alert-wind-chill-watch"),
    ("wind chill advisory", "alert-wind-chill-adv"),
    (
        "freezing rain advisory|freezing drizzle",
        "alert-freezing-rain-adv",
    ),
    ("sleet warning|sleet advisory", "alert-sleet-warn"),
    ("hard freeze warning", "alert-hard-freeze-warn"),
    ("hard freeze watch", "alert-hard-freeze-watch"),
    ("freeze warning", "alert-freeze-warn"),
    ("freeze watch", "alert-freeze-watch"),
    ("extreme wind warning", "alert-extreme"),
    ("high wind warning", "alert-severe"),
    ("high wind watch", "alert-moderate"),
    ("wind advisory", "alert-wind-adv"),
    ("gale warning", "alert-gale-warn"),
    ("red flag warning", "alert-severe"),
    ("fire weather watch", "alert-fire-watch"),
    ("extreme fire danger", "alert-extreme-fire"),
    ("excessive heat warning", "alert-extreme"),
    ("excessive heat watch", "alert-excessive-heat-watch"),
    ("heat advisory", "alert-heat-adv"),
    ("extreme heat warning", "alert-extreme"),
    ("dense fog advisory", "alert-dense-fog-adv"),
    ("dense smoke advisory", "alert-dense-smoke-adv"),
    ("air quality (alert|advisory)", "alert-air-quality"),
    ("low water advisory", "alert-low-water-adv"),
    ("dust storm warning", "alert-dust-storm"),
    ("blowing dust advisory", "alert-blowing-dust"),
    ("storm surge warning", "alert-storm-surge-warn"),
    ("storm surge watch", "alert-storm-surge-watch"),
    ("tsunami warning", "alert-tsunami-warn"),
    ("tsunami watch", "alert-tsunami-watch"),
    ("tsunami advisory", "alert-tsunami-adv"),
    ("high surf warning", "alert-high-surf-warn"),
    ("high surf advisory", "alert-high-surf-adv"),
    ("rip current statement", "alert-rip-current"),
    ("special marine warning", "alert-marine-warning"),
    ("volcano warning", "alert-volcano"),
    ("ashfall warning", "alert-ashfall-warn"),
    ("ashfall advisory", "alert-ashfall-adv"),
    ("debris flow", "alert-debris-flow"),
    ("avalanche warning", "alert-avalanche-warn"),
    ("avalanche watch", "alert-avalanche-watch"),
    ("avalanche advisory", "alert-avalanche-adv"),
    ("earthquake warning", "alert-earthquake"),
    ("earthquake advisory", "alert-earthquake-advisory"),
    ("aftershock", "alert-aftershock"),
    (r"evacuation\s*-?\s*immediate", "alert-evacuation"),
    ("evacuation warning", "alert-evacuation-warning"),
    ("evacuation watch", "alert-evacuation-watch"),
    ("civil emergency", "alert-civil-emergency"),
    ("shelter.?in.?place", "alert-shelter-in-place"),
    ("blue alert", "alert-blue-alert"),
    ("law enforcement", "alert-law-enforcement"),
    ("child abduction emergency|amber alert", "alert-amber"),
    ("911 telephone outage", "alert-911-outage"),
    ("nuclear power plant", "alert-nuclear"),
    (
        "emergency action notification|national emergency",
        "alert-ean",
    ),
    ("administrative message", "alert-admin-message"),
    ("asteroid", "alert-asteroid"),
    ("special weather statement", "alert-special-wx-stmt"),
    ("mesoscale discussion", "alert-mesoscale-discussion"),
];

struct Rule {
    src: &'static str,
    re: Regex,
    class: &'static str,
}

static TABLE: Lazy<Vec<Rule>> = Lazy::new(|| {
    RULES
        .iter()
        .map(|(src, class)| Rule {
            src,
            re: Regex::new(&format!("(?i){src}")).expect("valid classify regex"),
            class,
        })
        .collect()
});

static TOR_WARN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)tornado warning").unwrap());
static SVR_WARN: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)severe thunderstorm warning").unwrap());
static PDS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"particularly dangerous situation|\bpds\b").unwrap());
static OBSERVED: Lazy<Regex> = Lazy::new(|| Regex::new(r"(confirmed|observed) tornado").unwrap());
static AIR: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)air quality|smoke").unwrap());

fn first_rule(event: &str) -> Option<&'static Rule> {
    TABLE.iter().find(|r| r.re.is_match(event))
}

/// Classify an alert into its hazard class key.
pub fn classify(
    event: &str,
    headline: Option<&str>,
    description: Option<&str>,
    severity: Severity,
) -> String {
    let text = format!(
        "{} {} {}",
        event,
        headline.unwrap_or(""),
        description.unwrap_or("")
    )
    .to_lowercase();
    if text.contains("tornado emergency") {
        return "alert-tornado-emergency".into();
    }
    let pds = PDS.is_match(&text);
    if TOR_WARN.is_match(event) {
        if pds {
            return "alert-tornado-pds".into();
        }
        if OBSERVED.is_match(&text) {
            return "alert-tornado-observed".into();
        }
    }
    if SVR_WARN.is_match(event) {
        if pds {
            return "alert-svr-pds".into();
        }
        if text.contains("destructive") {
            return "alert-svr-destructive".into();
        }
    }
    if let Some(r) = first_rule(event) {
        return r.class.into();
    }
    match severity {
        Severity::Extreme => "alert-extreme",
        Severity::Severe => "alert-severe",
        Severity::Moderate => "alert-moderate",
        Severity::Minor => "alert-minor",
        Severity::Unknown => "alert-unknown",
    }
    .into()
}

/// Human-facing event name, with tier overrides for tornado / SVR variants.
pub fn display_event(event: &str, class: &str) -> String {
    match class {
        "alert-tornado-emergency" => "Tornado Emergency".into(),
        "alert-tornado-pds" => "Tornado Warning (PDS)".into(),
        "alert-tornado-observed" => "Tornado Warning (Confirmed)".into(),
        "alert-svr-pds" => "Severe Thunderstorm Warning (PDS)".into(),
        "alert-svr-destructive" => "Severe Thunderstorm Warning (Destructive)".into(),
        _ => event.to_string(),
    }
}

/// Grouping key for the "hazard group" UI: tier classes keep their class,
/// everything else groups by the matched pattern, else the lowercase event.
pub fn hazard_group_key(event: &str, class: &str) -> String {
    const TIERS: [&str; 5] = [
        "alert-tornado-emergency",
        "alert-tornado-pds",
        "alert-tornado-observed",
        "alert-svr-pds",
        "alert-svr-destructive",
    ];
    if TIERS.contains(&class) {
        return class.to_string();
    }
    match first_rule(event) {
        Some(r) => r.src.to_string(),
        None => event.to_lowercase(),
    }
}

/// ECCC colour-coded risk -> class.
pub fn eccc_class(risk_colour: Option<&str>) -> &'static str {
    let c = risk_colour.unwrap_or("").to_ascii_lowercase();
    if c.contains("red") {
        "eccc-red"
    } else if c.contains("orange") {
        "eccc-orange"
    } else if c.contains("yellow") {
        "eccc-yellow"
    } else {
        "eccc-statement"
    }
}

pub fn is_air_quality(event: &str) -> bool {
    AIR.is_match(event)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StormTier {
    None,
    Warning,
    Pds,
    Emergency,
}

/// Emphasis tier for storm-based (polygon) warnings.
pub fn storm_tier(class: &str) -> StormTier {
    match class {
        "alert-tornado-emergency" | "alert-flash-flood-emergency" => StormTier::Emergency,
        "alert-tornado-pds"
        | "alert-tornado-observed"
        | "alert-svr-pds"
        | "alert-svr-destructive" => StormTier::Pds,
        "alert-tornado-warning"
        | "alert-severe-tstorm-warn"
        | "alert-flash-flood-warn"
        | "alert-marine-warning"
        | "alert-snow-squall"
        | "alert-extreme"
        | "alert-dust-storm" => StormTier::Warning,
        _ => StormTier::None,
    }
}

/// Short (<= 4 char) terminal glyph for a class.
pub fn icon_glyph(class: &str) -> &'static str {
    let c = class.strip_prefix("alert-").unwrap_or(class);
    if c.starts_with("tornado") {
        "TOR"
    } else if c.starts_with("svr") || c.starts_with("severe-tstorm") || c.starts_with("severe-wx") {
        "SVR"
    } else if c.starts_with("flash-flood") {
        "FFW"
    } else if c.contains("flood") || c == "hydrological" || c == "low-water-adv" {
        "FLD"
    } else if c.starts_with("hurricane")
        || c.starts_with("tropical")
        || c.starts_with("storm-surge")
    {
        "HUR"
    } else if c.contains("snow")
        || c.contains("wind-chill")
        || c.contains("freez")
        || c.contains("sleet")
        || c == "blizzard"
        || c == "ice-storm"
    {
        "WIN"
    } else if c.contains("wind") || c.starts_with("gale") {
        "WND"
    } else if c.contains("fire") {
        "FIR"
    } else if c.contains("heat") {
        "HEAT"
    } else if c.contains("fog") || c.contains("smoke") || c == "air-quality" {
        "FOG"
    } else if c.contains("marine")
        || c.contains("surf")
        || c.contains("rip")
        || c.starts_with("tsunami")
    {
        "MAR"
    } else if c.contains("volcano") || c.starts_with("ashfall") {
        "VOL"
    } else if c.contains("earthquake") || c == "aftershock" {
        "EQ"
    } else if c.starts_with("evacuation") || c == "shelter-in-place" {
        "EVAC"
    } else if c == "civil-emergency" {
        "CIV"
    } else if c == "nuclear" {
        "RAD"
    } else if c == "ean" {
        "EAN"
    } else if c == "mesoscale-discussion" {
        "MD"
    } else if c == "asteroid" {
        "AST"
    } else {
        "!"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cls(e: &str) -> String {
        classify(e, None, None, Severity::Unknown)
    }

    #[test]
    fn basic_events() {
        assert_eq!(cls("Tornado Warning"), "alert-tornado-warning");
        assert_eq!(cls("tornado watch"), "alert-tornado-watch");
        assert_eq!(
            cls("Severe Thunderstorm Warning"),
            "alert-severe-tstorm-warn"
        );
        assert_eq!(cls("Flash Flood Warning"), "alert-flash-flood-warn");
        assert_eq!(cls("Evacuation - Immediate"), "alert-evacuation");
        assert_eq!(cls("Evacuation  Immediate"), "alert-evacuation");
        assert_eq!(cls("Shelter In Place Warning"), "alert-shelter-in-place");
        assert_eq!(cls("Hydrologic Outlook"), "alert-hydrological");
        assert_eq!(cls("Child Abduction Emergency"), "alert-amber");
    }

    #[test]
    fn specific_before_general() {
        assert_eq!(cls("Flood Warning"), "alert-flood-warning");
        assert_eq!(cls("Coastal Flood Warning"), "alert-coastal-flood-warn");
        assert_eq!(cls("Lakeshore Flood Warning"), "alert-lakeshore-flood-warn");
        assert_eq!(cls("Hard Freeze Warning"), "alert-hard-freeze-warn");
        assert_eq!(cls("Freeze Warning"), "alert-freeze-warn");
        assert_eq!(cls("Wind Chill Advisory"), "alert-wind-chill-adv");
    }

    #[test]
    fn pre_rules() {
        assert_eq!(
            classify(
                "Tornado Warning",
                Some("TORNADO EMERGENCY for X"),
                None,
                Severity::Extreme
            ),
            "alert-tornado-emergency"
        );
        assert_eq!(
            classify(
                "Tornado Warning",
                None,
                Some("This is a PARTICULARLY DANGEROUS SITUATION."),
                Severity::Extreme
            ),
            "alert-tornado-pds"
        );
        assert_eq!(
            classify(
                "Tornado Warning",
                None,
                Some("PDS tornado"),
                Severity::Extreme
            ),
            "alert-tornado-pds"
        );
        assert_eq!(
            classify(
                "Tornado Warning",
                None,
                Some("A confirmed tornado was seen"),
                Severity::Extreme
            ),
            "alert-tornado-observed"
        );
        assert_eq!(
            classify(
                "Severe Thunderstorm Warning",
                None,
                Some("particularly dangerous situation"),
                Severity::Severe
            ),
            "alert-svr-pds"
        );
        assert_eq!(
            classify(
                "Severe Thunderstorm Warning",
                None,
                Some("destructive winds"),
                Severity::Severe
            ),
            "alert-svr-destructive"
        );
        // "pds" must be word-bounded
        assert_eq!(
            classify("Tornado Warning", None, Some("epdsx"), Severity::Severe),
            "alert-tornado-warning"
        );
        // Pre-rules only apply to warnings
        assert_eq!(
            classify(
                "Tornado Watch",
                None,
                Some("particularly dangerous situation"),
                Severity::Severe
            ),
            "alert-tornado-watch"
        );
    }

    #[test]
    fn severity_fallback() {
        assert_eq!(
            classify("Weird Thing", None, None, Severity::Extreme),
            "alert-extreme"
        );
        assert_eq!(
            classify("Weird Thing", None, None, Severity::Severe),
            "alert-severe"
        );
        assert_eq!(
            classify("Weird Thing", None, None, Severity::Moderate),
            "alert-moderate"
        );
        assert_eq!(
            classify("Weird Thing", None, None, Severity::Minor),
            "alert-minor"
        );
        assert_eq!(
            classify("Weird Thing", None, None, Severity::Unknown),
            "alert-unknown"
        );
    }

    #[test]
    fn every_rule_compiles_and_self_matches() {
        assert_eq!(TABLE.len(), RULES.len());
    }

    #[test]
    fn display_and_group() {
        assert_eq!(
            display_event("Tornado Warning", "alert-tornado-pds"),
            "Tornado Warning (PDS)"
        );
        assert_eq!(
            display_event("Heat Advisory", "alert-heat-adv"),
            "Heat Advisory"
        );
        assert_eq!(
            hazard_group_key("Tornado Warning", "alert-tornado-pds"),
            "alert-tornado-pds"
        );
        assert_eq!(
            hazard_group_key("Heat Advisory", "alert-heat-adv"),
            "heat advisory"
        );
        assert_eq!(
            hazard_group_key("Mystery Event", "alert-unknown"),
            "mystery event"
        );
    }

    #[test]
    fn eccc_and_air() {
        assert_eq!(eccc_class(Some("Red")), "eccc-red");
        assert_eq!(eccc_class(Some("ORANGE")), "eccc-orange");
        assert_eq!(eccc_class(Some("yellow warning")), "eccc-yellow");
        assert_eq!(eccc_class(None), "eccc-statement");
        assert!(is_air_quality("Air Quality Alert"));
        assert!(is_air_quality("Dense Smoke Advisory"));
        assert!(!is_air_quality("Tornado Warning"));
    }

    #[test]
    fn tiers() {
        assert_eq!(storm_tier("alert-tornado-emergency"), StormTier::Emergency);
        assert_eq!(storm_tier("alert-svr-pds"), StormTier::Pds);
        assert_eq!(storm_tier("alert-severe-tstorm-warn"), StormTier::Warning);
        assert_eq!(storm_tier("alert-heat-adv"), StormTier::None);
    }

    #[test]
    fn glyphs_short() {
        assert_eq!(icon_glyph("alert-tornado-pds"), "TOR");
        assert_eq!(icon_glyph("alert-flash-flood-warn"), "FFW");
        assert_eq!(icon_glyph("alert-nothing"), "!");
        for (class, _, _) in crate::alerts::colors::ALL_CLASSES {
            assert!(icon_glyph(class).chars().count() <= 4, "{class}");
        }
    }
}
