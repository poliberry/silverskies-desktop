//! Grammar for the embedded `:` command prompt.
//!
//! Conventions: user-facing indices (`move radar left 2`, `alerts show 3`,
//! `frame`) are 1-based where they address a list position, and are converted
//! to 0-based in the parsed [`Command`]. `Frame` is a relative step.

use crate::alerts::demo::DEMO_GROUPS;
use crate::theme::builtin_themes;
use crate::{Column, PanelKind, RadarProduct, TimeFormat, UnitPref, WindowRole};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq)]
pub enum RadarCmd {
    New,
    Popout,
    Recenter,
    Scheme(u8),
    Nowcast(bool),
    Satellite(bool),
    /// Composite opacity percent 0..=100.
    Opacity(u8),
    Smooth(bool),
    Snow(bool),
    Arrows(bool),
    Cells(bool),
    Legend(bool),
    /// Jump the loop back to the latest observed frame and resume live tracking.
    Live,
}

#[derive(Debug, Clone, PartialEq)]
pub enum AlertsCmd {
    List,
    /// 0-based index into the visible alert list.
    Show(usize),
    Clear,
    Filter(Option<String>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum RadioCmd {
    Toggle,
    /// Live mode, optionally with an explicit stream URL.
    Live(Option<String>),
    Simulated,
    Stop,
    /// Stream volume, 0..=100.
    Volume(u8),
    /// Re-resolve and reconnect the live stream.
    Retry,
    /// Play a test tone and announcement.
    Test,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Command {
    Goto {
        query: String,
    },
    GotoCoords {
        lat: f64,
        lon: f64,
    },
    Add {
        label: Option<String>,
    },
    Remove {
        target: String,
    },
    Select {
        target: String,
    },
    Refresh,
    Units(Option<UnitPref>),
    Time(Option<TimeFormat>),
    Theme(Option<String>),
    /// `index` is 0-based.
    Move {
        panel: PanelKind,
        col: Column,
        index: Option<usize>,
    },
    Swap(PanelKind, PanelKind),
    Hide(PanelKind),
    Show(PanelKind),
    Popout(PanelKind),
    ResetLayout,
    Radar(RadarCmd),
    Alerts(AlertsCmd),
    Speak(Option<String>),
    Mute,
    Radio(RadioCmd),
    Set {
        key: String,
        value: String,
    },
    Open(WindowRole),
    Close,
    Help(Option<String>),
    Quit,
    Demo {
        group: Option<String>,
    },
    Asteroid,
    Zoom(f32),
    /// `on: None` toggles.
    Layer {
        name: String,
        on: Option<bool>,
    },
    Product(RadarProduct),
    Site(Option<String>),
    Play,
    Pause,
    /// Relative frame step (`+1`, `-1`, ...).
    Frame(i32),
    Fullscreen,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ParseError {
    #[error("empty command")]
    Empty,
    #[error("unknown command: {0}")]
    Unknown(String),
    #[error("{cmd}: missing {arg}")]
    MissingArg {
        cmd: &'static str,
        arg: &'static str,
    },
    #[error("{cmd}: invalid {arg}: {value}")]
    BadArg {
        cmd: &'static str,
        arg: &'static str,
        value: String,
    },
    #[error("unterminated quote")]
    UnterminatedQuote,
}

struct CmdInfo {
    name: &'static str,
    aliases: &'static [&'static str],
    usage: &'static str,
    summary: &'static str,
}

const fn ci(
    name: &'static str,
    aliases: &'static [&'static str],
    usage: &'static str,
    summary: &'static str,
) -> CmdInfo {
    CmdInfo {
        name,
        aliases,
        usage,
        summary,
    }
}

static COMMANDS: &[CmdInfo] = &[
    ci(
        "goto",
        &["g", "go"],
        "goto <place> | goto <lat> <lon>",
        "Search for a place or jump to coordinates",
    ),
    ci("add", &["a"], "add [label]", "Save the current location"),
    ci(
        "remove",
        &["rm", "del", "delete"],
        "remove <name|number>",
        "Remove a saved location",
    ),
    ci(
        "select",
        &["sel"],
        "select <name|number>",
        "Switch to a saved location",
    ),
    ci(
        "refresh",
        &["r"],
        "refresh",
        "Refresh weather and alerts now",
    ),
    ci(
        "units",
        &["u"],
        "units [f|c]",
        "Show or set temperature units",
    ),
    ci("time", &[], "time [12|24]", "Show or set the clock format"),
    ci("theme", &[], "theme [id]", "Show or set the theme"),
    ci(
        "move",
        &["mv"],
        "move <panel> <left|center|right> [position]",
        "Move a panel to a column",
    ),
    ci(
        "swap",
        &[],
        "swap <panel> <panel>",
        "Swap two docked panels",
    ),
    ci("hide", &[], "hide <panel>", "Hide a panel"),
    ci("show", &[], "show <panel>", "Show a hidden panel"),
    ci(
        "popout",
        &["pop"],
        "popout <panel>",
        "Open a panel in its own window",
    ),
    ci(
        "reset-layout",
        &["reset", "resetlayout"],
        "reset-layout",
        "Restore the default panel layout",
    ),
    ci(
        "radar",
        &["rad"],
        "radar new|popout|recenter|live|scheme <n>|opacity <0-100>|nowcast|satellite|smooth|snow|arrows|cells|legend [on|off]",
        "Radar window and map options",
    ),
    ci(
        "alerts",
        &["al"],
        "alerts [list|show <n>|clear|filter [text]]",
        "Inspect and filter alerts",
    ),
    ci(
        "speak",
        &["tts", "say"],
        "speak [text]",
        "Read text (or the top alert) aloud",
    ),
    ci("mute", &[], "mute", "Stop speech and weather radio audio"),
    ci(
        "radio",
        &[],
        "radio [toggle|live [url]|simulated|stop|volume <0-100>|retry|test]",
        "Control the weather radio",
    ),
    ci("set", &[], "set <key> <value>", "Change a setting"),
    ci(
        "open",
        &[],
        "open <window>",
        "Open a window (radar, conditions, audit-log, radio, settings)",
    ),
    ci(
        "settings",
        &["prefs", "preferences"],
        "settings",
        "Open the settings window",
    ),
    ci("close", &[], "close", "Close the current window"),
    ci("help", &["h", "?"], "help [command]", "Show help"),
    ci("quit", &["q", "exit"], "quit", "Quit Silver Skies"),
    ci("demo", &[], "demo [group|event]", "Fire demo alerts"),
    ci("asteroid", &[], "asteroid", "Do not"),
    ci("zoom", &["z"], "zoom <level>", "Set the map zoom level"),
    ci(
        "layer",
        &["l"],
        "layer <alerts|satellite|nowcast|spc|md|barbs|owm-wind|owm-temp|owm-precip|aqi|sites|legend|nexrad|arrows|cells> [on|off]",
        "Toggle a map layer",
    ),
    ci(
        "product",
        &["p"],
        "product <name>",
        "Select the radar product",
    ),
    ci(
        "site",
        &["s"],
        "site [id]",
        "Select or clear the radar site",
    ),
    ci("play", &[], "play", "Play the radar loop"),
    ci("pause", &[], "pause", "Pause the radar loop"),
    ci("frame", &["f"], "frame <+n|-n>", "Step the radar loop"),
    ci("fullscreen", &["fs"], "fullscreen", "Toggle fullscreen"),
];

fn resolve(word: &str) -> Option<&'static CmdInfo> {
    let w = word.to_ascii_lowercase();
    COMMANDS
        .iter()
        .find(|c| c.name == w || c.aliases.contains(&w.as_str()))
}

/// Split into words honoring `"double"` and `'single'` quotes.
fn tokenize(line: &str) -> Result<Vec<String>, ParseError> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_tok = false;
    let mut quote: Option<char> = None;
    for ch in line.chars() {
        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => cur.push(ch),
            None => match ch {
                '"' | '\'' => {
                    quote = Some(ch);
                    in_tok = true;
                }
                c if c.is_whitespace() => {
                    if in_tok {
                        out.push(std::mem::take(&mut cur));
                        in_tok = false;
                    }
                }
                c => {
                    cur.push(c);
                    in_tok = true;
                }
            },
        }
    }
    if quote.is_some() {
        return Err(ParseError::UnterminatedQuote);
    }
    if in_tok {
        out.push(cur);
    }
    Ok(out)
}

fn parse_panel(s: &str) -> Option<PanelKind> {
    if let Some(p) = PanelKind::parse(s) {
        return Some(p);
    }
    match s.trim().to_ascii_lowercase().as_str() {
        "loc" | "locs" | "location" => Some(PanelKind::Locations),
        "log" | "audit" | "alerts" => Some(PanelKind::AuditLog),
        "cond" | "current" => Some(PanelKind::Conditions),
        "7day" | "daily" | "7-day" | "week" => Some(PanelKind::Forecast),
        "hour" | "hours" => Some(PanelKind::Hourly),
        "wxradio" | "wx-radio" | "wx" => Some(PanelKind::Radio),
        _ => None,
    }
}

fn parse_role(s: &str) -> Option<WindowRole> {
    match s
        .trim()
        .to_ascii_lowercase()
        .replace(['-', '_', ' '], "")
        .as_str()
    {
        "main" => Some(WindowRole::Main),
        "radar" => Some(WindowRole::Radar),
        "conditions" | "cond" => Some(WindowRole::Conditions),
        "alert" => Some(WindowRole::Alert),
        "auditlog" | "audit" | "log" => Some(WindowRole::AuditLog),
        "radio" | "weatherradio" | "wx" => Some(WindowRole::WeatherRadio),
        "settings" | "prefs" | "preferences" => Some(WindowRole::Settings),
        _ => None,
    }
}

fn parse_bool(s: &str) -> Option<bool> {
    match s.to_ascii_lowercase().as_str() {
        "on" | "true" | "yes" | "1" | "y" | "show" => Some(true),
        "off" | "false" | "no" | "0" | "n" | "hide" => Some(false),
        _ => None,
    }
}

fn bad(cmd: &'static str, arg: &'static str, value: &str) -> ParseError {
    ParseError::BadArg {
        cmd,
        arg,
        value: value.to_string(),
    }
}

fn missing(cmd: &'static str, arg: &'static str) -> ParseError {
    ParseError::MissingArg { cmd, arg }
}

fn rest_joined(args: &[String]) -> Option<String> {
    let s = args.join(" ");
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_string())
}

fn want_panel(cmd: &'static str, args: &[String], i: usize) -> Result<PanelKind, ParseError> {
    let a = args.get(i).ok_or_else(|| missing(cmd, "panel"))?;
    parse_panel(a).ok_or_else(|| bad(cmd, "panel", a))
}

/// Parse a command line. The leading `:` is optional.
pub fn parse(line: &str) -> Result<Command, ParseError> {
    let line = line.trim();
    let line = line.strip_prefix(':').unwrap_or(line).trim();
    let toks = tokenize(line)?;
    let (head, args) = toks.split_first().ok_or(ParseError::Empty)?;
    let info = resolve(head).ok_or_else(|| ParseError::Unknown(head.clone()))?;
    let name = info.name;

    match name {
        "goto" => {
            let q = rest_joined(args).ok_or_else(|| missing(name, "place"))?;
            let nums: Vec<&str> = q
                .split(|c: char| c == ',' || c.is_whitespace())
                .filter(|s| !s.is_empty())
                .collect();
            if nums.len() == 2 {
                if let (Ok(lat), Ok(lon)) = (nums[0].parse::<f64>(), nums[1].parse::<f64>()) {
                    if !(-90.0..=90.0).contains(&lat) {
                        return Err(bad(name, "latitude", nums[0]));
                    }
                    if !(-180.0..=180.0).contains(&lon) {
                        return Err(bad(name, "longitude", nums[1]));
                    }
                    return Ok(Command::GotoCoords { lat, lon });
                }
            }
            Ok(Command::Goto { query: q })
        }
        "add" => Ok(Command::Add {
            label: rest_joined(args),
        }),
        "remove" => Ok(Command::Remove {
            target: rest_joined(args).ok_or_else(|| missing(name, "target"))?,
        }),
        "select" => Ok(Command::Select {
            target: rest_joined(args).ok_or_else(|| missing(name, "target"))?,
        }),
        "refresh" => Ok(Command::Refresh),
        "units" => match args.first() {
            None => Ok(Command::Units(None)),
            Some(a) => match a.to_ascii_lowercase().as_str() {
                "f" | "fahrenheit" | "imperial" | "us" => Ok(Command::Units(Some(UnitPref::F))),
                "c" | "celsius" | "metric" => Ok(Command::Units(Some(UnitPref::C))),
                _ => Err(bad(name, "unit", a)),
            },
        },
        "time" => match args.first() {
            None => Ok(Command::Time(None)),
            Some(a) => match a.to_ascii_lowercase().as_str() {
                "12" | "12h" => Ok(Command::Time(Some(TimeFormat::H12))),
                "24" | "24h" => Ok(Command::Time(Some(TimeFormat::H24))),
                _ => Err(bad(name, "format", a)),
            },
        },
        "theme" => Ok(Command::Theme(rest_joined(args))),
        "move" => {
            let panel = want_panel(name, args, 0)?;
            let c = args.get(1).ok_or_else(|| missing(name, "column"))?;
            let col = Column::parse(c).ok_or_else(|| bad(name, "column", c))?;
            let index = match args.get(2) {
                None => None,
                Some(i) => match i.parse::<usize>() {
                    Ok(n) if n >= 1 => Some(n - 1),
                    _ => return Err(bad(name, "position", i)),
                },
            };
            Ok(Command::Move { panel, col, index })
        }
        "swap" => Ok(Command::Swap(
            want_panel(name, args, 0)?,
            want_panel(name, args, 1)?,
        )),
        "hide" => Ok(Command::Hide(want_panel(name, args, 0)?)),
        "show" => Ok(Command::Show(want_panel(name, args, 0)?)),
        "popout" => Ok(Command::Popout(want_panel(name, args, 0)?)),
        "reset-layout" => Ok(Command::ResetLayout),
        "radar" => parse_radar(args),
        "alerts" => parse_alerts(args),
        "speak" => Ok(Command::Speak(rest_joined(args))),
        "mute" => Ok(Command::Mute),
        "radio" => match args.first().map(|s| s.to_ascii_lowercase()).as_deref() {
            None | Some("toggle") => Ok(Command::Radio(RadioCmd::Toggle)),
            Some("live") => Ok(Command::Radio(RadioCmd::Live(rest_joined(&args[1..])))),
            Some("simulated") | Some("sim") => Ok(Command::Radio(RadioCmd::Simulated)),
            Some("stop") | Some("off") => Ok(Command::Radio(RadioCmd::Stop)),
            Some("retry") => Ok(Command::Radio(RadioCmd::Retry)),
            Some("test") => Ok(Command::Radio(RadioCmd::Test)),
            Some("volume") | Some("vol") => {
                let v = args.get(1).ok_or_else(|| missing(name, "volume"))?;
                match v.parse::<u8>() {
                    Ok(n) if n <= 100 => Ok(Command::Radio(RadioCmd::Volume(n))),
                    _ => Err(bad(name, "volume", v)),
                }
            }
            Some(_) => Err(bad(name, "subcommand", &args[0])),
        },
        "set" => {
            let key = args.first().ok_or_else(|| missing(name, "key"))?;
            if let (Some((k, v)), true) = (key.split_once('='), args.len() == 1) {
                if k.is_empty() {
                    return Err(missing(name, "key"));
                }
                return Ok(Command::Set {
                    key: k.to_string(),
                    value: v.to_string(),
                });
            }
            let value = rest_joined(&args[1..]).ok_or_else(|| missing(name, "value"))?;
            Ok(Command::Set {
                key: key.clone(),
                value,
            })
        }
        "open" => {
            let a = args.first().ok_or_else(|| missing(name, "window"))?;
            Ok(Command::Open(
                parse_role(a).ok_or_else(|| bad(name, "window", a))?,
            ))
        }
        "settings" => Ok(Command::Open(WindowRole::Settings)),
        "close" => Ok(Command::Close),
        "help" => Ok(Command::Help(rest_joined(args))),
        "quit" => Ok(Command::Quit),
        "demo" => Ok(Command::Demo {
            group: rest_joined(args),
        }),
        "asteroid" => Ok(Command::Asteroid),
        "zoom" => {
            let a = args.first().ok_or_else(|| missing(name, "level"))?;
            match a.parse::<f32>() {
                Ok(z) if z.is_finite() => Ok(Command::Zoom(z)),
                _ => Err(bad(name, "level", a)),
            }
        }
        "layer" => {
            let n = args.first().ok_or_else(|| missing(name, "layer name"))?;
            let on = match args.get(1) {
                None => None,
                Some(v) => Some(parse_bool(v).ok_or_else(|| bad(name, "state", v))?),
            };
            Ok(Command::Layer {
                name: n.to_ascii_lowercase(),
                on,
            })
        }
        "product" => {
            let a = args.first().ok_or_else(|| missing(name, "product"))?;
            Ok(Command::Product(
                RadarProduct::parse(a).ok_or_else(|| bad(name, "product", a))?,
            ))
        }
        "site" => Ok(Command::Site(rest_joined(args))),
        "play" => Ok(Command::Play),
        "pause" => Ok(Command::Pause),
        "frame" => {
            let a = args.first().ok_or_else(|| missing(name, "step"))?;
            let n = a.strip_prefix('+').unwrap_or(a);
            n.parse::<i32>()
                .map(Command::Frame)
                .map_err(|_| bad(name, "step", a))
        }
        "fullscreen" => Ok(Command::Fullscreen),
        _ => Err(ParseError::Unknown(head.clone())),
    }
}

/// Canonical map-layer names accepted by `:layer`.
pub const LAYER_NAMES: &[&str] = &[
    "alerts",
    "satellite",
    "nowcast",
    "spc",
    "md",
    "barbs",
    "owm-wind",
    "owm-temp",
    "owm-precip",
    "aqi",
    "sites",
    "legend",
    "nexrad",
    "arrows",
    "cells",
];

/// Map-layer names accepted by `:layer`. Returns the canonical name.
pub fn canonical_layer(name: &str) -> Option<&'static str> {
    let n = name.trim().to_ascii_lowercase();
    let canon = match n.as_str() {
        "alerts" | "polygons" => "alerts",
        "satellite" | "sat" => "satellite",
        "nowcast" => "nowcast",
        "spc" | "outlook" => "spc",
        "md" | "mcd" | "discussions" => "md",
        "barbs" | "wind-barbs" | "winds" => "barbs",
        "owm-wind" | "wind" => "owm-wind",
        "owm-temp" | "temp" => "owm-temp",
        "owm-precip" | "precip" => "owm-precip",
        "aqi" => "aqi",
        "sites" | "stations" => "sites",
        "legend" => "legend",
        "nexrad" => "nexrad",
        "arrows" => "arrows",
        "cells" => "cells",
        _ => return None,
    };
    LAYER_NAMES.iter().copied().find(|l| *l == canon)
}

fn parse_radar(args: &[String]) -> Result<Command, ParseError> {
    const NAME: &str = "radar";
    let sub = args.first().ok_or_else(|| missing(NAME, "subcommand"))?;
    let on = |i: usize| -> Result<bool, ParseError> {
        match args.get(i) {
            None => Ok(true),
            Some(v) => parse_bool(v).ok_or_else(|| bad(NAME, "state", v)),
        }
    };
    let cmd = match sub.to_ascii_lowercase().as_str() {
        "new" => RadarCmd::New,
        "popout" | "pop" => RadarCmd::Popout,
        "recenter" | "center" => RadarCmd::Recenter,
        "scheme" => {
            let v = args.get(1).ok_or_else(|| missing(NAME, "scheme number"))?;
            RadarCmd::Scheme(v.parse().map_err(|_| bad(NAME, "scheme number", v))?)
        }
        "nowcast" => RadarCmd::Nowcast(on(1)?),
        "satellite" | "sat" => RadarCmd::Satellite(on(1)?),
        "opacity" => {
            let v = args.get(1).ok_or_else(|| missing(NAME, "opacity"))?;
            match v.trim_end_matches('%').parse::<u8>() {
                Ok(n) if n <= 100 => RadarCmd::Opacity(n),
                _ => return Err(bad(NAME, "opacity", v)),
            }
        }
        "smooth" => RadarCmd::Smooth(on(1)?),
        "snow" => RadarCmd::Snow(on(1)?),
        "arrows" => RadarCmd::Arrows(on(1)?),
        "cells" => RadarCmd::Cells(on(1)?),
        "legend" => RadarCmd::Legend(on(1)?),
        "live" => RadarCmd::Live,
        _ => return Err(bad(NAME, "subcommand", sub)),
    };
    Ok(Command::Radar(cmd))
}

fn parse_alerts(args: &[String]) -> Result<Command, ParseError> {
    const NAME: &str = "alerts";
    let Some(sub) = args.first() else {
        return Ok(Command::Alerts(AlertsCmd::List));
    };
    let cmd = match sub.to_ascii_lowercase().as_str() {
        "list" | "ls" => AlertsCmd::List,
        "show" | "open" => {
            let v = args.get(1).ok_or_else(|| missing(NAME, "number"))?;
            match v.parse::<usize>() {
                Ok(n) if n >= 1 => AlertsCmd::Show(n - 1),
                _ => return Err(bad(NAME, "number", v)),
            }
        }
        "clear" => AlertsCmd::Clear,
        "filter" => AlertsCmd::Filter(rest_joined(&args[1..])),
        _ => return Err(bad(NAME, "subcommand", sub)),
    };
    Ok(Command::Alerts(cmd))
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

fn quote_if_needed(s: &str) -> String {
    if s.chars().any(char::is_whitespace) {
        format!("\"{s}\"")
    } else {
        s.to_string()
    }
}

fn panel_names() -> Vec<String> {
    PanelKind::ALL.iter().map(|p| p.id().to_string()).collect()
}

fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

fn arg_candidates(cmd: &str, idx: usize) -> Vec<String> {
    match (cmd, idx) {
        ("move", 0) | ("swap", 0) | ("swap", 1) | ("hide", 0) | ("show", 0) | ("popout", 0) => {
            panel_names()
        }
        ("move", 1) => strs(&["left", "center", "right"]),
        ("theme", 0) => {
            let mut v = strs(&["default", "custom"]);
            v.extend(builtin_themes().into_iter().map(|t| t.id));
            v
        }
        ("product", 0) => RadarProduct::ALL
            .iter()
            .map(|p| p.id().to_string())
            .collect(),
        ("units", 0) => strs(&["c", "f"]),
        ("time", 0) => strs(&["12", "24"]),
        ("radar", 0) => strs(&[
            "new",
            "popout",
            "recenter",
            "scheme",
            "nowcast",
            "satellite",
            "opacity",
            "smooth",
            "snow",
            "arrows",
            "cells",
            "legend",
            "live",
        ]),
        ("radar", 1) => strs(&["on", "off"]),
        ("alerts", 0) => strs(&["list", "show", "clear", "filter"]),
        ("radio", 0) => strs(&[
            "toggle",
            "live",
            "simulated",
            "stop",
            "volume",
            "retry",
            "test",
        ]),
        ("layer", 0) => strs(LAYER_NAMES),
        ("layer", 1) => strs(&["on", "off"]),
        ("open", 0) => strs(&[
            "main",
            "radar",
            "conditions",
            "audit-log",
            "radio",
            "settings",
        ]),
        ("help", 0) => COMMANDS.iter().map(|c| c.name.to_string()).collect(),
        ("demo", 0) => DEMO_GROUPS
            .iter()
            .map(|g| quote_if_needed(&g.name.to_ascii_lowercase()))
            .collect(),
        _ => vec![],
    }
}

/// Tab-completion candidates for the line typed so far. Each result is the
/// complete replacement line (a leading `:` is preserved).
pub fn complete(prefix: &str) -> Vec<String> {
    let (colon, rest) = match prefix.strip_prefix(':') {
        Some(r) => (":", r),
        None => ("", prefix),
    };
    let ends_ws = rest.ends_with(char::is_whitespace);
    let toks: Vec<&str> = rest.split_whitespace().collect();
    let mut out: Vec<String> = Vec::new();

    if toks.is_empty() || (toks.len() == 1 && !ends_ws) {
        let p = toks
            .first()
            .map(|t| t.to_ascii_lowercase())
            .unwrap_or_default();
        for c in COMMANDS {
            for n in std::iter::once(&c.name).chain(c.aliases.iter()) {
                if n.starts_with(&p) && n.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                {
                    out.push(format!("{colon}{n}"));
                }
            }
        }
    } else if let Some(info) = resolve(toks[0]) {
        let (idx, partial, fixed) = if ends_ws {
            (toks.len() - 1, String::new(), &toks[..])
        } else {
            (
                toks.len() - 2,
                toks[toks.len() - 1].to_ascii_lowercase(),
                &toks[..toks.len() - 1],
            )
        };
        for cand in arg_candidates(info.name, idx) {
            if cand.to_ascii_lowercase().starts_with(&partial)
                || cand.trim_matches('"').starts_with(&partial)
            {
                out.push(format!("{colon}{} {cand}", fixed.join(" ")));
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// `(usage, summary)` for a command or alias (leading `:` accepted).
pub fn usage_for(name_or_alias: &str) -> Option<(&'static str, &'static str)> {
    resolve(name_or_alias.trim().trim_start_matches(':')).map(|c| (c.usage, c.summary))
}

/// Help text: an overview, or details for one command (aliases accepted).
pub fn help_lines(topic: Option<&str>) -> Vec<String> {
    match topic.map(str::trim).filter(|t| !t.is_empty()) {
        None => {
            let mut v =
                vec!["Commands (leading ':' optional; 'help <command>' for details):".to_string()];
            for c in COMMANDS {
                v.push(format!("  {:<14} {}", c.name, c.summary));
            }
            v
        }
        Some(t) => match resolve(t.trim_start_matches(':')) {
            Some(c) => {
                let mut v = vec![
                    format!("{} - {}", c.name, c.summary),
                    format!("  usage: {}", c.usage),
                ];
                if !c.aliases.is_empty() {
                    v.push(format!("  aliases: {}", c.aliases.join(", ")));
                }
                v
            }
            None => vec![format!(
                "No help for '{t}'. Try 'help' for the command list."
            )],
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(s: &str) -> Command {
        parse(s).unwrap_or_else(|e| panic!("{s:?}: {e}"))
    }

    #[test]
    fn empty_and_unknown() {
        assert_eq!(parse(""), Err(ParseError::Empty));
        assert_eq!(parse("  :  "), Err(ParseError::Empty));
        assert_eq!(
            parse(":frobnicate"),
            Err(ParseError::Unknown("frobnicate".into()))
        );
        assert_eq!(parse("goto \"unclosed"), Err(ParseError::UnterminatedQuote));
    }

    #[test]
    fn goto_variants() {
        assert_eq!(
            p(":goto Tucson AZ"),
            Command::Goto {
                query: "Tucson AZ".into()
            }
        );
        assert_eq!(
            p("g \"Salt Lake City\""),
            Command::Goto {
                query: "Salt Lake City".into()
            }
        );
        assert_eq!(
            p("go 90210"),
            Command::Goto {
                query: "90210".into()
            }
        );
        assert_eq!(
            p("goto Paris, TX"),
            Command::Goto {
                query: "Paris, TX".into()
            }
        );
        assert_eq!(
            p("goto 32.83 -109.71"),
            Command::GotoCoords {
                lat: 32.83,
                lon: -109.71
            }
        );
        assert_eq!(
            p("goto 32.83,-109.71"),
            Command::GotoCoords {
                lat: 32.83,
                lon: -109.71
            }
        );
        assert_eq!(
            p("goto 32.83, -109.71"),
            Command::GotoCoords {
                lat: 32.83,
                lon: -109.71
            }
        );
        assert!(matches!(
            parse("goto 95 10"),
            Err(ParseError::BadArg {
                arg: "latitude",
                ..
            })
        ));
        assert!(matches!(
            parse("goto 45 190"),
            Err(ParseError::BadArg {
                arg: "longitude",
                ..
            })
        ));
        assert!(matches!(parse("goto"), Err(ParseError::MissingArg { .. })));
    }

    #[test]
    fn locations() {
        assert_eq!(p("add"), Command::Add { label: None });
        assert_eq!(
            p("a Home Base"),
            Command::Add {
                label: Some("Home Base".into())
            }
        );
        assert_eq!(p("rm 2"), Command::Remove { target: "2".into() });
        assert_eq!(
            p("del \"Home Base\""),
            Command::Remove {
                target: "Home Base".into()
            }
        );
        assert_eq!(p("remove x"), Command::Remove { target: "x".into() });
        assert!(parse("rm").is_err());
        assert_eq!(p("select 3"), Command::Select { target: "3".into() });
        assert_eq!(
            p("sel tucson"),
            Command::Select {
                target: "tucson".into()
            }
        );
        assert_eq!(p("r"), Command::Refresh);
        assert_eq!(p(":refresh"), Command::Refresh);
    }

    #[test]
    fn units_time_theme() {
        assert_eq!(p("u"), Command::Units(None));
        assert_eq!(p("u f"), Command::Units(Some(UnitPref::F)));
        assert_eq!(p("units C"), Command::Units(Some(UnitPref::C)));
        assert_eq!(p("units metric"), Command::Units(Some(UnitPref::C)));
        assert!(parse("units k").is_err());
        assert_eq!(p("time"), Command::Time(None));
        assert_eq!(p("time 24"), Command::Time(Some(TimeFormat::H24)));
        assert_eq!(p("time 12h"), Command::Time(Some(TimeFormat::H12)));
        assert!(parse("time 7").is_err());
        assert_eq!(p("theme"), Command::Theme(None));
        assert_eq!(
            p("theme nord-blue"),
            Command::Theme(Some("nord-blue".into()))
        );
    }

    #[test]
    fn layout_commands() {
        assert_eq!(
            p("mv radar left"),
            Command::Move {
                panel: PanelKind::Radar,
                col: Column::Left,
                index: None
            }
        );
        assert_eq!(
            p("move audit-log right 1"),
            Command::Move {
                panel: PanelKind::AuditLog,
                col: Column::Right,
                index: Some(0)
            }
        );
        assert_eq!(
            p("move log c 3"),
            Command::Move {
                panel: PanelKind::AuditLog,
                col: Column::Center,
                index: Some(2)
            }
        );
        assert!(parse("move radar left 0").is_err());
        assert!(parse("move radar sideways").is_err());
        assert!(parse("move nothing left").is_err());
        assert!(matches!(
            parse("move radar"),
            Err(ParseError::MissingArg { arg: "column", .. })
        ));
        assert_eq!(
            p("swap radar hourly"),
            Command::Swap(PanelKind::Radar, PanelKind::Hourly)
        );
        assert!(parse("swap radar").is_err());
        assert_eq!(p("hide forecast"), Command::Hide(PanelKind::Forecast));
        assert_eq!(p("show Locations"), Command::Show(PanelKind::Locations));
        assert_eq!(
            p("popout conditions"),
            Command::Popout(PanelKind::Conditions)
        );
        assert_eq!(p("pop radio"), Command::Popout(PanelKind::Radio));
        assert_eq!(p("reset-layout"), Command::ResetLayout);
        assert_eq!(p("reset"), Command::ResetLayout);
        assert!(parse("hide").is_err());
    }

    #[test]
    fn radar_commands() {
        assert_eq!(p("radar new"), Command::Radar(RadarCmd::New));
        assert_eq!(p("radar popout"), Command::Radar(RadarCmd::Popout));
        assert_eq!(p("radar recenter"), Command::Radar(RadarCmd::Recenter));
        assert_eq!(p("radar scheme 4"), Command::Radar(RadarCmd::Scheme(4)));
        assert_eq!(
            p("radar nowcast off"),
            Command::Radar(RadarCmd::Nowcast(false))
        );
        assert_eq!(p("radar nowcast"), Command::Radar(RadarCmd::Nowcast(true)));
        assert_eq!(p("rad sat on"), Command::Radar(RadarCmd::Satellite(true)));
        assert!(parse("radar").is_err());
        assert!(parse("radar scheme x").is_err());
        assert!(parse("radar scheme 300").is_err());
        assert!(parse("radar nowcast maybe").is_err());
        assert!(parse("radar bogus").is_err());
        assert_eq!(p("radar opacity 60"), Command::Radar(RadarCmd::Opacity(60)));
        assert_eq!(
            p("radar opacity 100"),
            Command::Radar(RadarCmd::Opacity(100))
        );
        assert!(parse("radar opacity 101").is_err());
        assert!(parse("radar opacity x").is_err());
        assert!(parse("radar opacity").is_err());
        assert_eq!(
            p("radar smooth off"),
            Command::Radar(RadarCmd::Smooth(false))
        );
        assert_eq!(p("radar snow"), Command::Radar(RadarCmd::Snow(true)));
        assert_eq!(p("radar arrows on"), Command::Radar(RadarCmd::Arrows(true)));
        assert_eq!(p("radar cells off"), Command::Radar(RadarCmd::Cells(false)));
        assert_eq!(
            p("radar legend off"),
            Command::Radar(RadarCmd::Legend(false))
        );
        assert_eq!(p("radar live"), Command::Radar(RadarCmd::Live));
        assert!(parse("radar legend maybe").is_err());
    }

    #[test]
    fn alerts_commands() {
        assert_eq!(p("alerts"), Command::Alerts(AlertsCmd::List));
        assert_eq!(p("al list"), Command::Alerts(AlertsCmd::List));
        assert_eq!(p("alerts show 2"), Command::Alerts(AlertsCmd::Show(1)));
        assert!(parse("alerts show 0").is_err());
        assert!(parse("alerts show").is_err());
        assert_eq!(p("alerts clear"), Command::Alerts(AlertsCmd::Clear));
        assert_eq!(p("alerts filter"), Command::Alerts(AlertsCmd::Filter(None)));
        assert_eq!(
            p("alerts filter flood warning"),
            Command::Alerts(AlertsCmd::Filter(Some("flood warning".into())))
        );
        assert!(parse("alerts wat").is_err());
    }

    #[test]
    fn speech_and_radio() {
        assert_eq!(p("speak"), Command::Speak(None));
        assert_eq!(
            p("tts hello there"),
            Command::Speak(Some("hello there".into()))
        );
        assert_eq!(p("say \"a  b\""), Command::Speak(Some("a  b".into())));
        assert_eq!(p("mute"), Command::Mute);
        assert_eq!(p("radio"), Command::Radio(RadioCmd::Toggle));
        assert_eq!(p("radio live"), Command::Radio(RadioCmd::Live(None)));
        assert_eq!(
            p("radio live http://x/y.mp3"),
            Command::Radio(RadioCmd::Live(Some("http://x/y.mp3".into())))
        );
        assert_eq!(p("radio sim"), Command::Radio(RadioCmd::Simulated));
        assert_eq!(p("radio stop"), Command::Radio(RadioCmd::Stop));
        assert_eq!(p("radio retry"), Command::Radio(RadioCmd::Retry));
        assert_eq!(p("radio test"), Command::Radio(RadioCmd::Test));
        assert_eq!(p("radio volume 55"), Command::Radio(RadioCmd::Volume(55)));
        assert_eq!(p("radio volume 0"), Command::Radio(RadioCmd::Volume(0)));
        assert!(parse("radio volume").is_err());
        assert!(parse("radio volume loud").is_err());
        assert!(parse("radio volume 101").is_err());
        assert!(parse("radio volume -5").is_err());
        assert!(parse("radio blast").is_err());
    }

    #[test]
    fn set_open_misc() {
        assert_eq!(
            p("set tts_rate 1.2"),
            Command::Set {
                key: "tts_rate".into(),
                value: "1.2".into()
            }
        );
        assert_eq!(
            p("set libre_wxr_host https://a b"),
            Command::Set {
                key: "libre_wxr_host".into(),
                value: "https://a b".into()
            }
        );
        assert_eq!(
            p("set units=c"),
            Command::Set {
                key: "units".into(),
                value: "c".into()
            }
        );
        assert!(parse("set").is_err());
        assert!(parse("set key").is_err());
        assert_eq!(p("open radar"), Command::Open(WindowRole::Radar));
        assert_eq!(p("open audit-log"), Command::Open(WindowRole::AuditLog));
        assert_eq!(p("open Settings"), Command::Open(WindowRole::Settings));
        assert_eq!(p("open radio"), Command::Open(WindowRole::WeatherRadio));
        assert!(parse("open nothing").is_err());
        assert!(parse("open").is_err());
        assert_eq!(p("close"), Command::Close);
        assert_eq!(p("h"), Command::Help(None));
        assert_eq!(p("?"), Command::Help(None));
        assert_eq!(p("help move"), Command::Help(Some("move".into())));
        assert_eq!(p("q"), Command::Quit);
        assert_eq!(p("exit"), Command::Quit);
        assert_eq!(p("quit"), Command::Quit);
        assert_eq!(p("demo"), Command::Demo { group: None });
        assert_eq!(
            p("demo tornado"),
            Command::Demo {
                group: Some("tornado".into())
            }
        );
        assert_eq!(p("asteroid"), Command::Asteroid);
        assert_eq!(p("fullscreen"), Command::Fullscreen);
        assert_eq!(p("fs"), Command::Fullscreen);
    }

    #[test]
    fn map_commands() {
        assert_eq!(p("z 7.5"), Command::Zoom(7.5));
        assert_eq!(p("zoom 3"), Command::Zoom(3.0));
        assert!(parse("zoom").is_err());
        assert!(parse("zoom far").is_err());
        assert!(parse("zoom NaN").is_err());
        assert_eq!(
            p("l SPC on"),
            Command::Layer {
                name: "spc".into(),
                on: Some(true)
            }
        );
        assert_eq!(
            p("layer wind off"),
            Command::Layer {
                name: "wind".into(),
                on: Some(false)
            }
        );
        assert_eq!(
            p("layer wind"),
            Command::Layer {
                name: "wind".into(),
                on: None
            }
        );
        assert!(parse("layer wind maybe").is_err());
        assert!(parse("layer").is_err());
        assert_eq!(p("p vel"), Command::Product(RadarProduct::SrBvel));
        assert_eq!(p("product sr_bref"), Command::Product(RadarProduct::SrBref));
        assert!(parse("product nope").is_err());
        assert_eq!(p("s"), Command::Site(None));
        assert_eq!(p("site KFSX"), Command::Site(Some("KFSX".into())));
        assert_eq!(p("play"), Command::Play);
        assert_eq!(p("pause"), Command::Pause);
        assert_eq!(p("frame +1"), Command::Frame(1));
        assert_eq!(p("f -3"), Command::Frame(-3));
        assert_eq!(p("frame 2"), Command::Frame(2));
        assert!(parse("frame x").is_err());
        assert!(parse("frame").is_err());
    }

    #[test]
    fn case_insensitive_and_whitespace() {
        assert_eq!(p("  :  REFRESH  "), Command::Refresh);
        assert_eq!(
            p("Move RADAR Left"),
            Command::Move {
                panel: PanelKind::Radar,
                col: Column::Left,
                index: None
            }
        );
    }

    #[test]
    fn error_messages_render() {
        assert_eq!(
            parse("goto").unwrap_err().to_string(),
            "goto: missing place"
        );
        assert_eq!(
            parse("units k").unwrap_err().to_string(),
            "units: invalid unit: k"
        );
        assert_eq!(
            parse("nope").unwrap_err().to_string(),
            "unknown command: nope"
        );
    }

    #[test]
    fn every_alias_resolves_and_is_unique() {
        let mut seen = std::collections::HashSet::new();
        for c in COMMANDS {
            for n in std::iter::once(&c.name).chain(c.aliases.iter()) {
                assert!(seen.insert(*n), "duplicate {n}");
                assert_eq!(resolve(n).unwrap().name, c.name);
            }
        }
    }

    #[test]
    fn complete_command_names() {
        assert_eq!(complete("mo"), ["move"]);
        assert_eq!(complete("m"), ["move", "mute", "mv"]);
        assert!(complete(":ra").contains(&":radar".to_string()));
        assert!(complete(":ra").contains(&":rad".to_string()));
        assert!(complete("").len() > 30);
        assert!(complete("zzz").is_empty());
    }

    #[test]
    fn complete_args() {
        assert_eq!(complete("move ra"), ["move radar", "move radio"]);
        assert_eq!(complete("move rada"), ["move radar"]);
        assert_eq!(
            complete(":move radar "),
            [
                ":move radar center",
                ":move radar left",
                ":move radar right"
            ]
        );
        assert_eq!(complete("move radar l"), ["move radar left"]);
        assert!(complete("swap radar h").contains(&"swap radar hourly".to_string()));
        assert_eq!(complete("hide au"), ["hide audit-log"]);
        assert_eq!(complete("theme nord"), ["theme nord-blue"]);
        assert!(complete("theme ").contains(&"theme custom".to_string()));
        assert!(complete("theme ").contains(&"theme green-term".to_string()));
        assert_eq!(complete("product sr_bv"), ["product sr_bvel"]);
        assert_eq!(complete("units "), ["units c", "units f"]);
        assert_eq!(complete("radar nowc"), ["radar nowcast"]);
        assert_eq!(
            complete("radar nowcast o"),
            ["radar nowcast off", "radar nowcast on"]
        );
        assert_eq!(complete("help mo"), ["help move"]);
        assert_eq!(complete("demo fog"), ["demo fog/visibility/air"]);
        assert_eq!(complete("demo severe"), ["demo \"severe thunderstorm\""]);
        assert!(complete("goto xyz").is_empty());
        assert!(complete("bogus a").is_empty());
    }

    #[test]
    fn completions_parse_back() {
        for line in complete("move radar ") {
            assert!(parse(&line).is_ok(), "{line}");
        }
        for line in complete("theme ") {
            assert!(parse(&line).is_ok(), "{line}");
        }
        for line in complete("demo ") {
            assert!(parse(&line).is_ok(), "{line}");
        }
    }

    #[test]
    fn settings_command_and_usage() {
        assert_eq!(p("settings"), Command::Open(WindowRole::Settings));
        assert_eq!(p(":prefs"), Command::Open(WindowRole::Settings));
        assert_eq!(p("preferences"), Command::Open(WindowRole::Settings));
        let c = complete(":set");
        assert!(c.contains(&":set".to_string()));
        assert!(c.contains(&":settings".to_string()));
        assert!(usage_for("prefs").is_some());
        assert_eq!(
            usage_for(":layer").unwrap().0.split(' ').next(),
            Some("layer")
        );
        assert!(usage_for("zzz").is_none());
    }

    #[test]
    fn help() {
        let all = help_lines(None);
        assert!(all.len() > COMMANDS.len());
        assert!(all.iter().any(|l| l.contains("goto")));
        let mv = help_lines(Some("mv"));
        assert!(mv[0].starts_with("move"));
        assert!(mv.iter().any(|l| l.contains("aliases: mv")));
        assert!(help_lines(Some(":quit"))[0].starts_with("quit"));
        assert!(help_lines(Some("zzz"))[0].contains("No help"));
        assert_eq!(help_lines(Some("  ")), all);
    }
}

#[cfg(test)]
mod layer_tests {
    use super::*;

    #[test]
    fn canonical_layer_aliases() {
        assert_eq!(canonical_layer("polygons"), Some("alerts"));
        assert_eq!(canonical_layer("SAT"), Some("satellite"));
        assert_eq!(canonical_layer("outlook"), Some("spc"));
        assert_eq!(canonical_layer("mcd"), Some("md"));
        assert_eq!(canonical_layer("discussions"), Some("md"));
        assert_eq!(canonical_layer("winds"), Some("barbs"));
        assert_eq!(canonical_layer("wind-barbs"), Some("barbs"));
        assert_eq!(canonical_layer("wind"), Some("owm-wind"));
        assert_eq!(canonical_layer("temp"), Some("owm-temp"));
        assert_eq!(canonical_layer("precip"), Some("owm-precip"));
        assert_eq!(canonical_layer("stations"), Some("sites"));
        assert_eq!(canonical_layer("bogus"), None);
        for n in LAYER_NAMES {
            assert_eq!(canonical_layer(n), Some(*n));
        }
    }

    #[test]
    fn layer_completions() {
        let c = complete("layer ow");
        assert!(c.contains(&"layer owm-wind".to_string()));
    }
}
