//! The vim-style `:` command bar and the terminal log region above it.

use egui::{Event, FontId, Id, Key, Modifiers, RichText, TextEdit, TextStyle, Ui};
use ss_core::command::{self, Command};
use ss_core::theme::Palette;
use ss_core::weather::units::fmt_ago;
use ss_core::SavedLocation;

use crate::state::{LogLevel, Shared};
use crate::theme::{c32, c32a};

/// Lines of terminal output visible in the collapsed log region.
pub const LOG_LINES: usize = 6;

/// What a submitted line turned into.
#[derive(Debug, Clone, PartialEq)]
pub enum Interpreted {
    Empty,
    ToggleLog,
    Clear,
    Command(Command),
    Error(String),
}

/// Parse a raw line (leading `:` optional). `log` and `clear` are local to the
/// bar and never reach `ss-core`.
pub fn interpret(line: &str) -> Interpreted {
    let raw = line.trim().trim_start_matches(':').trim();
    match raw.to_ascii_lowercase().as_str() {
        "" => return Interpreted::Empty,
        "log" => return Interpreted::ToggleLog,
        "clear" => return Interpreted::Clear,
        _ => {}
    }
    match command::parse(raw) {
        Ok(c) => Interpreted::Command(c),
        Err(e) => Interpreted::Error(e.to_string()),
    }
}

/// Height of the live suggestion strip drawn above the input row.
pub const SUGGEST_H: f32 = 18.0;
/// Most candidates shown in the strip before collapsing into `…+N`.
const MAX_SHOWN: usize = 8;

/// The part of a completion `line` that is not already typed as fixed tokens:
/// for input `layer al` and line `layer alerts` this is `alerts`.
pub fn display_word(line: &str, input: &str) -> String {
    let line = line.trim_start_matches(':');
    let fixed_end = input
        .char_indices()
        .rev()
        .find(|(_, c)| c.is_whitespace())
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(0);
    let fixed = &input[..fixed_end];
    line.strip_prefix(fixed).unwrap_or(line).to_string()
}

#[derive(Default)]
pub struct CommandBar {
    /// Text without the leading colon (the prompt glyph is drawn separately).
    pub input: String,
    pub open: bool,
    pub history: Vec<String>,
    pub history_idx: Option<usize>,
    pub completions: Vec<String>,
    /// Currently cycled candidate, if any.
    pub completion_idx: Option<usize>,
    /// Terminal region expanded to half the window (`:log`).
    pub expanded: bool,
    draft: String,
    last_applied: String,
    /// Input text the suggestions were last computed for.
    last_input: String,
    request_focus: bool,
}

impl CommandBar {
    pub fn open_bar(&mut self) {
        self.open = true;
        self.request_focus = true;
        self.input.clear();
        self.history_idx = None;
        self.completions.clear();
        self.completion_idx = None;
        self.last_input.clear();
        self.last_applied.clear();
    }

    pub fn close(&mut self) {
        self.open = false;
        self.input.clear();
        self.history_idx = None;
        self.completions.clear();
        self.completion_idx = None;
        self.last_applied.clear();
        self.last_input.clear();
    }

    /// Up arrow: walk back through history.
    pub fn history_prev(&mut self) {
        if self.history.is_empty() {
            return;
        }
        let idx = match self.history_idx {
            None => {
                self.draft = self.input.clone();
                self.history.len() - 1
            }
            Some(i) => i.saturating_sub(1),
        };
        self.history_idx = Some(idx);
        self.input = self.history[idx].clone();
        self.completions.clear();
        self.completion_idx = None;
    }

    /// Down arrow: walk forward, ending back at the draft.
    pub fn history_next(&mut self) {
        let Some(i) = self.history_idx else { return };
        if i + 1 < self.history.len() {
            self.history_idx = Some(i + 1);
            self.input = self.history[i + 1].clone();
        } else {
            self.history_idx = None;
            self.input = std::mem::take(&mut self.draft);
        }
        self.completions.clear();
        self.completion_idx = None;
    }

    fn compute_completions(&mut self) {
        self.completions = command::complete(&format!(":{}", self.input))
            .into_iter()
            .map(|s| s.trim_start_matches(':').to_string())
            .collect();
        self.completion_idx = None;
    }

    /// Refresh the suggestion list when the input was edited (not when it was
    /// filled in by a completion, so cycling keeps the full candidate list).
    fn refresh_suggestions(&mut self) {
        if self.input != self.last_input {
            if self.input != self.last_applied || self.completions.is_empty() {
                self.compute_completions();
            }
            self.last_input = self.input.clone();
        }
    }

    /// Tab: complete, or cycle forward through candidates if the text is
    /// untouched since the last completion.
    pub fn tab(&mut self) {
        self.cycle(true);
    }

    /// Shift+Tab: cycle backward.
    pub fn tab_back(&mut self) {
        self.cycle(false);
    }

    fn cycle(&mut self, forward: bool) {
        if self.completions.is_empty() || self.input != self.last_applied {
            self.compute_completions();
        }
        let n = self.completions.len();
        if n == 0 {
            return;
        }
        let next = match (self.completion_idx, forward) {
            (None, true) => 0,
            (None, false) => n - 1,
            (Some(i), true) => (i + 1) % n,
            (Some(i), false) => (i + n - 1) % n,
        };
        self.completion_idx = Some(next);
        let c = self.completions[next].clone();
        self.input = c.clone();
        self.last_applied = c.clone();
        self.last_input = c;
    }

    /// Enter: record history and close. Returns the trimmed line.
    pub fn submit(&mut self) -> String {
        let line = self.input.trim().to_string();
        if !line.is_empty() && self.history.last() != Some(&line) {
            self.history.push(line.clone());
        }
        self.close();
        line
    }

    /// Global key handling: `:` opens the bar when no text field has focus.
    pub fn handle_global_keys(&mut self, ctx: &egui::Context) {
        if self.open || ctx.egui_wants_keyboard_input() {
            return;
        }
        let pressed = ctx.input(|i| {
            i.events
                .iter()
                .any(|e| matches!(e, Event::Text(t) if t == ":"))
        });
        if pressed {
            // Swallow the colon so it does not land in the freshly focused field.
            ctx.input_mut(|i| {
                i.events
                    .retain(|e| !matches!(e, Event::Text(t) if t == ":"))
            });
            self.open_bar();
        }
    }

    pub fn panel_height(&self, window_height: f32) -> f32 {
        let extra = if self.open { SUGGEST_H } else { 0.0 };
        if self.expanded {
            (window_height * 0.5).max(120.0) + extra
        } else {
            LOG_LINES as f32 * 15.0 + 36.0 + extra
        }
    }

    /// Paint the candidate list and usage hint into `strip`.
    fn paint_suggestions(&self, painter: &egui::Painter, strip: egui::Rect, p: &Palette) {
        let font = FontId::monospace(11.0);
        let dim = c32a(p.text3);
        let hi = c32(p.a0);

        let mut job = egui::text::LayoutJob::default();
        let fmt = |color| egui::TextFormat {
            font_id: font.clone(),
            color,
            ..Default::default()
        };
        for (i, line) in self.completions.iter().take(MAX_SHOWN).enumerate() {
            if i > 0 {
                job.append("  ", 0.0, fmt(dim));
            }
            let color = if self.completion_idx == Some(i) {
                hi
            } else {
                dim
            };
            job.append(&display_word(line, &self.input), 0.0, fmt(color));
        }
        if self.completions.len() > MAX_SHOWN {
            job.append(
                &format!("  …+{}", self.completions.len() - MAX_SHOWN),
                0.0,
                fmt(dim),
            );
        }
        let mut cand_w = 0.0;
        if !self.completions.is_empty() {
            let g = painter.layout_job(job);
            cand_w = g.size().x;
            painter.galley(
                egui::pos2(strip.left() + 2.0, strip.center().y - g.size().y / 2.0),
                g,
                dim,
            );
        }

        let head = self.input.split_whitespace().next().unwrap_or("");
        if let Some((usage, _)) = command::usage_for(head) {
            let g = painter.layout_no_wrap(usage.to_string(), font, dim);
            // Right-align, but never overlap the candidates.
            let x = (strip.right() - g.size().x - 4.0).max(strip.left() + cand_w + 16.0);
            if x + g.size().x <= strip.right() + 0.5 {
                painter.galley(egui::pos2(x, strip.center().y - g.size().y / 2.0), g, dim);
            }
        }
    }

    /// Draw the terminal region plus the input line. Returns a command to run.
    pub fn show(
        &mut self,
        ui: &mut Ui,
        shared: &mut Shared,
        location: Option<&SavedLocation>,
    ) -> Option<Command> {
        let p = shared.palette;
        let mut out = None;

        if self.open {
            self.refresh_suggestions();
        }

        // --- terminal output ---
        let reserved = if self.open { SUGGEST_H } else { 0.0 };
        let avail = ui.available_height() - 24.0 - reserved;
        egui::ScrollArea::vertical()
            .id_salt("terminal")
            .max_height(avail.max(30.0))
            .auto_shrink([false, false])
            .stick_to_bottom(true)
            .show(ui, |ui| {
                ui.spacing_mut().item_spacing.y = 1.0;
                for line in &shared.log {
                    ui.horizontal(|ui| {
                        ui.spacing_mut().item_spacing.x = 6.0;
                        ui.label(
                            RichText::new(line.time.format("%H:%M:%S").to_string())
                                .small()
                                .color(c32a(p.text3)),
                        );
                        let (text, color) = match line.level {
                            LogLevel::Info => (line.text.clone(), c32a(p.text2)),
                            LogLevel::Warn => (format!("warn: {}", line.text), c32(p.a0)),
                            LogLevel::Error => (format!("error: {}", line.text), c32(p.danger)),
                            LogLevel::Cmd => (format!(":{}", line.text), c32(p.a0)),
                        };
                        ui.add(egui::Label::new(RichText::new(text).color(color)).wrap());
                    });
                }
            });

        // --- suggestion strip (painted after input handling so it is current) ---
        let strip = self.open.then(|| {
            ui.allocate_exact_size(
                egui::vec2(ui.available_width(), SUGGEST_H),
                egui::Sense::hover(),
            )
            .0
        });
        let strip_painter = ui.painter().clone();

        // --- input line ---
        let (row, _) =
            ui.allocate_exact_size(egui::vec2(ui.available_width(), 20.0), egui::Sense::hover());
        let status = status_line(shared, location);
        let galley = ui
            .painter()
            .layout_no_wrap(status, FontId::monospace(11.0), c32a(p.text3));
        let status_w = galley.size().x + 8.0;
        ui.painter().galley(
            egui::pos2(
                row.right() - galley.size().x - 4.0,
                row.center().y - galley.size().y / 2.0,
            ),
            galley,
            c32a(p.text3),
        );

        let mut child = ui.new_child(
            egui::UiBuilder::new()
                .max_rect(egui::Rect::from_min_max(
                    row.min,
                    egui::pos2(row.right() - status_w, row.bottom()),
                ))
                .layout(egui::Layout::left_to_right(egui::Align::Center)),
        );
        let ui = &mut child;
        if self.open {
            ui.label(RichText::new(":").color(c32(p.a0)).strong());
            ui.input_mut(|i| {
                if i.consume_key(Modifiers::SHIFT, Key::Tab) {
                    self.tab_back();
                } else if i.consume_key(Modifiers::NONE, Key::Tab) {
                    self.tab();
                }
                if i.consume_key(Modifiers::NONE, Key::ArrowUp) {
                    self.history_prev();
                }
                if i.consume_key(Modifiers::NONE, Key::ArrowDown) {
                    self.history_next();
                }
            });
            let esc = ui.input_mut(|i| i.consume_key(Modifiers::NONE, Key::Escape));
            let r = ui.add(
                TextEdit::singleline(&mut self.input)
                    .id(Id::unique("cmdbar_input"))
                    .font(TextStyle::Monospace)
                    .frame(egui::Frame::NONE)
                    .desired_width(f32::INFINITY)
                    .lock_focus(true)
                    .hint_text("command  (help, log, clear)"),
            );
            if self.request_focus {
                r.request_focus();
                self.request_focus = false;
            }
            let enter = r.lost_focus() && ui.input(|i| i.key_pressed(Key::Enter));
            if esc {
                self.close();
            } else if enter {
                let line = self.submit();
                out = self.run_line(&line, shared);
            } else if r.lost_focus() {
                self.close();
            } else if let Some(strip) = strip {
                self.paint_suggestions(&strip_painter, strip, &p);
            }
        } else {
            ui.label(
                RichText::new("press : for commands")
                    .color(c32a(p.text3))
                    .small(),
            );
        }
        out
    }

    /// Log the line, handle local commands and parse errors, return a command.
    pub fn run_line(&mut self, line: &str, shared: &mut Shared) -> Option<Command> {
        let shown = line.trim().trim_start_matches(':').to_string();
        match interpret(line) {
            Interpreted::Empty => None,
            Interpreted::ToggleLog => {
                shared.log(LogLevel::Cmd, shown);
                self.expanded = !self.expanded;
                None
            }
            Interpreted::Clear => {
                shared.log.clear();
                None
            }
            Interpreted::Command(c) => {
                shared.log(LogLevel::Cmd, shown);
                Some(c)
            }
            Interpreted::Error(e) => {
                shared.log(LogLevel::Cmd, shown);
                shared.log(LogLevel::Error, e);
                None
            }
        }
    }
}

fn status_line(shared: &Shared, location: Option<&SavedLocation>) -> String {
    let mut parts = Vec::new();
    if let Some(l) = location {
        parts.push(l.label.clone());
    }
    if shared.refreshing {
        parts.push("REFRESHING…".to_string());
    } else if let Some(t) = shared.last_refresh {
        parts.push(fmt_ago(t.elapsed().as_secs() as i64));
    }
    let n = shared
        .all_alerts_for(location.map(|l| l.id.as_str()).unwrap_or(""))
        .len();
    parts.push(format!("{n} alert{}", if n == 1 { "" } else { "s" }));
    parts.join("  ·  ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bar_with_history(items: &[&str]) -> CommandBar {
        let mut b = CommandBar::default();
        for i in items {
            b.input = (*i).to_string();
            b.submit();
        }
        b
    }

    #[test]
    fn history_walks_back_and_restores_draft() {
        let mut b = bar_with_history(&["refresh", "units c"]);
        b.open_bar();
        b.input = "dra".into();
        b.history_prev();
        assert_eq!(b.input, "units c");
        b.history_prev();
        assert_eq!(b.input, "refresh");
        b.history_prev();
        assert_eq!(b.input, "refresh");
        b.history_next();
        assert_eq!(b.input, "units c");
        b.history_next();
        assert_eq!(b.input, "dra");
        assert_eq!(b.history_idx, None);
    }

    #[test]
    fn history_skips_empty_and_consecutive_duplicates() {
        let b = bar_with_history(&["refresh", "refresh", "", "  "]);
        assert_eq!(b.history, vec!["refresh".to_string()]);
    }

    #[test]
    fn tab_completes_and_cycles() {
        let mut b = CommandBar::default();
        b.open_bar();
        b.input = "ref".into();
        b.tab();
        assert_eq!(b.input, "refresh");
        // Several commands start with "r": cycling visits them all and wraps.
        b.input = "r".into();
        b.tab();
        let first = b.input.clone();
        let n = b.completions.len();
        assert!(n > 1);
        for _ in 0..n {
            b.tab();
        }
        assert_eq!(b.input, first);
    }

    #[test]
    fn editing_after_tab_restarts_completion() {
        let mut b = CommandBar {
            input: "u".into(),
            ..Default::default()
        };
        b.tab();
        assert!(b.input.starts_with('u'));
        b.input = "ti".into();
        b.tab();
        assert_eq!(b.input, "time");
    }

    #[test]
    fn display_word_strips_typed_tokens() {
        assert_eq!(display_word(":layer alerts", "layer al"), "alerts");
        assert_eq!(display_word("layer alerts", "layer "), "alerts");
        assert_eq!(display_word("refresh", "ref"), "refresh");
        assert_eq!(
            display_word("demo \"severe thunderstorm\"", "demo sev"),
            "\"severe thunderstorm\""
        );
        // Mismatched fixed tokens fall back to the whole line.
        assert_eq!(display_word("move radar", "mv ra"), "move radar");
    }

    #[test]
    fn shift_tab_cycles_backward() {
        let mut b = CommandBar::default();
        b.open_bar();
        b.input = "r".into();
        b.tab_back();
        assert_eq!(Some(b.input.clone()), b.completions.last().cloned());
        let n = b.completions.len();
        assert_eq!(b.completion_idx, Some(n - 1));
        b.tab();
        assert_eq!(b.completion_idx, Some(0));
        b.tab_back();
        assert_eq!(b.completion_idx, Some(n - 1));
    }

    #[test]
    fn show_computes_suggestions_live() {
        use ss_core::Config;
        let mut shared = Shared::new(Config::default(), Default::default(), Default::default());
        let mut bar = CommandBar::default();
        bar.open_bar();
        bar.input = "lay".into();
        let ctx = egui::Context::default();
        let mut out = ctx.run_ui(egui::RawInput::default(), |ui| {
            bar.show(ui, &mut shared, None);
        });
        out.textures_delta.clear();
        assert!(bar.completions.contains(&"layer".to_string()));
        assert_eq!(bar.completion_idx, None);
        assert!(bar.panel_height(600.0) > CommandBar::default().panel_height(600.0));
    }

    #[test]
    fn submit_closes_and_returns_line() {
        let mut b = CommandBar::default();
        b.open_bar();
        b.input = "  zoom 5 ".into();
        assert_eq!(b.submit(), "zoom 5");
        assert!(!b.open);
        assert!(b.input.is_empty());
    }

    #[test]
    fn interpret_handles_local_and_parsed_commands() {
        assert_eq!(interpret(""), Interpreted::Empty);
        assert_eq!(interpret(":log"), Interpreted::ToggleLog);
        assert_eq!(interpret("clear"), Interpreted::Clear);
        assert_eq!(
            interpret(":refresh"),
            Interpreted::Command(Command::Refresh)
        );
        assert!(matches!(interpret("frobnicate"), Interpreted::Error(_)));
    }
}
