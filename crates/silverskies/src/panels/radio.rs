use std::time::Duration;

use egui::{RichText, Ui};
use ss_core::command::{Command, RadioCmd};
use ss_core::theme::Palette;
use ss_core::{PanelKind, RadioMode};

use super::{Panel, PanelCx};
use crate::state::{RadioStatus, Shared};
use crate::theme::{c32, c32a};

/// Weather radio controls and status (simulated and live NWR streams).
pub struct RadioPanel;

impl Panel for RadioPanel {
    fn kind(&self) -> PanelKind {
        PanelKind::Radio
    }

    fn ui(&mut self, ui: &mut Ui, cx: &mut PanelCx) {
        let p = cx.palette;
        radio_ui(ui, cx.shared, &p, cx.emit);
    }
}

fn mono(text: impl Into<String>, color: egui::Color32) -> RichText {
    RichText::new(text.into()).monospace().color(color)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{}…", head.trim_end())
}

fn mmss(d: Duration) -> String {
    let s = d.as_secs();
    format!("{:02}:{:02}", s / 60, s % 60)
}

fn button(ui: &mut Ui, p: &Palette, label: &str) -> bool {
    ui.add(egui::Button::new(mono(format!("[ {label} ]"), c32(p.a0))).frame(false))
        .clicked()
}

/// Draw the radio panel. Pure over `&Shared`; commands go to `emit`.
pub fn radio_ui(ui: &mut Ui, sh: &Shared, p: &Palette, emit: &mut Vec<Command>) {
    let cfg = &sh.config;
    let radio = &sh.radio;
    let live = cfg.weather_radio_enabled && cfg.weather_radio_mode == RadioMode::Live;

    // Header.
    ui.horizontal(|ui| {
        ui.label(mono("WX RADIO", c32(p.text)).strong());
        if !cfg.weather_radio_enabled {
            ui.label(mono("OFF", c32a(p.text3)));
        } else if live {
            let on = ((ui.input(|i| i.time) * 2.0) as u64).is_multiple_of(2);
            let dot = if on { "●" } else { " " };
            ui.label(mono(format!("{dot} LIVE"), c32(p.a0)));
        } else {
            ui.label(mono("SIMULATED", c32(p.safe)));
        }
    });
    if live {
        ui.ctx().request_repaint_after(Duration::from_millis(500));
    }
    ui.add_space(4.0);

    // Status.
    let dim = c32a(p.text2);
    match &radio.status {
        RadioStatus::Off | RadioStatus::Connecting { .. } | RadioStatus::NoFeed(_)
            if !cfg.weather_radio_enabled =>
        {
            ui.label(mono(
                "Disabled — turn it on in Settings → Radio or run :radio.",
                dim,
            ));
        }
        _ if !live => {
            ui.label(mono("Enabled — simulated tone + speech mode.", dim));
        }
        RadioStatus::Off => {
            ui.label(mono("Starting…", dim));
        }
        RadioStatus::Connecting { label } => {
            ui.label(mono(format!("Connecting to {label}…"), dim));
        }
        RadioStatus::Playing { label, since, .. } => {
            ui.label(mono(
                format!("{label}  ▶ {} elapsed", mmss(since.elapsed())),
                c32(p.text),
            ));
        }
        RadioStatus::Failed { label, error } => {
            ui.add(egui::Label::new(mono(format!("{label}: {error}"), c32(p.danger))).wrap());
        }
        RadioStatus::Ended { label } => {
            ui.label(mono(format!("{label}: stream ended"), c32(p.danger)));
        }
        RadioStatus::NoFeed(msg) => {
            ui.add(egui::Label::new(mono(msg.clone(), dim)).wrap());
        }
    }

    // Candidate feeds.
    if live && !radio.candidates.is_empty() {
        ui.add_space(4.0);
        for f in &radio.candidates {
            let playing = matches!(
                &radio.status,
                RadioStatus::Playing { url, .. } if *url == f.stream_url
            );
            let mark = if playing { "▶" } else { " " };
            let color = if playing { c32(p.a0) } else { dim };
            ui.label(mono(
                format!(
                    "{mark} {}  {}, {}  ({})",
                    f.callsign, f.city, f.state, f.provider
                ),
                color,
            ));
        }
    }

    if let Some((name, _, at)) = &radio.last_same {
        ui.add_space(4.0);
        ui.label(mono(
            format!("SAME {name} {}s ago", at.elapsed().as_secs()),
            c32(p.a0),
        ));
    }

    if let Some(text) = &radio.speaking {
        ui.add_space(4.0);
        ui.label(mono(format!("speaking: {}", truncate(text, 80)), dim));
        if radio.queued > 0 {
            ui.label(mono(format!("queued: {}", radio.queued), dim));
        }
    }

    // Controls.
    ui.add_space(8.0);
    ui.horizontal_wrapped(|ui| {
        if button(ui, p, "ON/OFF") {
            emit.push(Command::Radio(RadioCmd::Toggle));
        }
        if button(ui, p, "LIVE") {
            emit.push(Command::Radio(RadioCmd::Live(None)));
        }
        if button(ui, p, "SIM") {
            emit.push(Command::Radio(RadioCmd::Simulated));
        }
        if live && button(ui, p, "RETRY") {
            emit.push(Command::Radio(RadioCmd::Retry));
        }
        if button(ui, p, "TEST") {
            emit.push(Command::Radio(RadioCmd::Test));
        }
        if button(ui, p, "MUTE") {
            emit.push(Command::Mute);
        }
    });
    ui.horizontal(|ui| {
        ui.label(mono("volume", dim));
        let mut vol = radio.volume;
        if ui.add(egui::Slider::new(&mut vol, 0..=100)).changed() {
            emit.push(Command::Radio(RadioCmd::Volume(vol)));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::{Config, LocationsFile, NwrFeed, SessionFile};
    use std::time::Instant;

    fn shared() -> Shared {
        Shared::new(
            Config::default(),
            LocationsFile::default(),
            SessionFile::default(),
        )
    }

    fn render(sh: &Shared) -> Vec<Command> {
        let p = sh.palette;
        let ctx = egui::Context::default();
        let mut emit = Vec::new();
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
            radio_ui(ui, sh, &p, &mut emit);
        });
        out.textures_delta.clear();
        emit
    }

    #[test]
    fn renders_off_headless() {
        let sh = shared();
        assert!(render(&sh).is_empty());
    }

    #[test]
    fn renders_every_live_state_headless() {
        let mut sh = shared();
        sh.config.weather_radio_enabled = true;
        sh.config.weather_radio_mode = RadioMode::Live;
        sh.radio.candidates = vec![NwrFeed {
            callsign: "WXK86".into(),
            city: "Austin".into(),
            state: "TX".into(),
            lat: 30.0,
            lon: -97.0,
            coverage: String::new(),
            stream_url: "https://x/y".into(),
            provider: "Test".into(),
        }];
        sh.radio.last_same = Some(("Tornado Warning".into(), "WXR TOR".into(), Instant::now()));
        sh.radio.speaking = Some("x".repeat(200));
        sh.radio.queued = 2;
        let states = [
            RadioStatus::Off,
            RadioStatus::NoFeed("nothing".into()),
            RadioStatus::Connecting { label: "A".into() },
            RadioStatus::Playing {
                label: "WXK86 Austin, TX".into(),
                url: "https://x/y".into(),
                since: Instant::now(),
            },
            RadioStatus::Failed {
                label: "A".into(),
                error: "boom".into(),
            },
            RadioStatus::Ended { label: "A".into() },
        ];
        for s in states {
            sh.radio.status = s.clone();
            assert!(render(&sh).is_empty(), "{s:?} emitted commands");
        }
        sh.config.weather_radio_mode = RadioMode::Simulated;
        assert!(render(&sh).is_empty());
    }

    #[test]
    fn helpers() {
        assert_eq!(mmss(Duration::from_secs(125)), "02:05");
        assert_eq!(truncate("abc", 80), "abc");
        assert_eq!(truncate(&"x".repeat(100), 80).chars().count(), 81);
    }
}
