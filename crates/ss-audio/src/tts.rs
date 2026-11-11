//! Native text-to-speech wrapper plus a thread-owning handle.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender};

use crate::AudioError;

fn tts_err(e: impl std::fmt::Display) -> AudioError {
    AudioError::Tts(e.to_string())
}

/// Map a user multiplier (0.5..=2.0, 1.0 = normal) onto a backend range.
///
/// Piecewise linear so that 1.0 always lands exactly on `normal` even when
/// the backend range is asymmetric. Monotonic in `mult`.
pub fn map_rate(mult: f32, min: f32, normal: f32, max: f32) -> f32 {
    let m = if mult.is_finite() {
        mult.clamp(0.5, 2.0)
    } else {
        1.0
    };
    if m <= 1.0 {
        min + (normal - min) * (m - 0.5) / 0.5
    } else {
        normal + (max - normal) * (m - 1.0)
    }
}

/// Thin wrapper over `tts::Tts`. May be `!Send` depending on the backend; use
/// [`TtsHandle`] from multi-threaded code.
pub struct Tts {
    inner: tts::Tts,
}

impl Tts {
    pub fn new() -> Result<Tts, AudioError> {
        let inner = tts::Tts::default().map_err(tts_err)?;
        Ok(Tts { inner })
    }

    /// Speak `text`. Returns `None` for backends that do not report an id.
    pub fn speak(
        &mut self,
        text: &str,
        interrupt: bool,
    ) -> Result<Option<tts::UtteranceId>, AudioError> {
        self.inner.speak(text, interrupt).map_err(tts_err)
    }

    pub fn stop(&mut self) -> Result<(), AudioError> {
        self.inner.stop().map(|_| ()).map_err(tts_err)
    }

    pub fn is_speaking(&self) -> bool {
        self.inner.is_speaking().unwrap_or(false)
    }

    /// `mult` in 0.5..=2.0, 1.0 = backend normal rate.
    pub fn set_rate(&mut self, mult: f32) -> Result<(), AudioError> {
        if !self.inner.supported_features().rate {
            return Ok(());
        }
        let r = map_rate(
            mult,
            self.inner.min_rate(),
            self.inner.normal_rate(),
            self.inner.max_rate(),
        );
        self.inner.set_rate(r).map(|_| ()).map_err(tts_err)
    }

    /// `mult` in 0.5..=2.0, 1.0 = backend normal pitch. No-op if unsupported.
    pub fn set_pitch(&mut self, mult: f32) -> Result<(), AudioError> {
        if !self.inner.supported_features().pitch {
            return Ok(());
        }
        let p = map_rate(
            mult,
            self.inner.min_pitch(),
            self.inner.normal_pitch(),
            self.inner.max_pitch(),
        );
        self.inner.set_pitch(p).map(|_| ()).map_err(tts_err)
    }

    pub fn voices(&self) -> Vec<String> {
        self.inner
            .voices()
            .map(|v| v.iter().map(|v| v.name()).collect())
            .unwrap_or_default()
    }

    pub fn set_voice_by_name(&mut self, name: &str) -> Result<(), AudioError> {
        let voices = self.inner.voices().map_err(tts_err)?;
        let voice = voices
            .iter()
            .find(|v| v.name() == name)
            .or_else(|| {
                let lower = name.to_lowercase();
                voices
                    .iter()
                    .find(|v| v.name().to_lowercase().contains(&lower))
            })
            .ok_or_else(|| AudioError::Tts(format!("voice not found: {name}")))?;
        self.inner.set_voice(voice).map_err(tts_err)
    }
}

/// Commands accepted by the TTS thread.
#[derive(Debug, Clone)]
pub enum TtsCmd {
    Speak { text: String, interrupt: bool },
    Stop,
    SetRate(f32),
    SetPitch(f32),
    SetVoice(String),
    Shutdown,
}

/// Cheap, thread-safe front for a TTS engine living on its own thread.
pub struct TtsHandle {
    tx: Sender<TtsCmd>,
    busy: Arc<AtomicBool>,
    voices: Arc<parking_lot::Mutex<Vec<String>>>,
    thread: Option<JoinHandle<()>>,
}

impl TtsHandle {
    /// Spawn the TTS thread. Fails if the backend cannot be initialised.
    pub fn spawn() -> Result<TtsHandle, AudioError> {
        let (tx, rx) = crossbeam_channel::unbounded();
        let (init_tx, init_rx) = crossbeam_channel::bounded::<Result<Vec<String>, AudioError>>(1);
        let busy = Arc::new(AtomicBool::new(false));
        let voices = Arc::new(parking_lot::Mutex::new(Vec::new()));
        let busy_t = busy.clone();
        let thread = std::thread::Builder::new()
            .name("ss-tts".into())
            .spawn(move || match Tts::new() {
                Ok(tts) => {
                    let _ = init_tx.send(Ok(tts.voices()));
                    run_loop(tts, rx, busy_t);
                }
                Err(e) => {
                    let _ = init_tx.send(Err(e));
                }
            })
            .map_err(tts_err)?;
        match init_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(v)) => *voices.lock() = v,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err(AudioError::Timeout),
        }
        Ok(TtsHandle {
            tx,
            busy,
            voices,
            thread: Some(thread),
        })
    }

    pub fn speak_queue(&self, text: &str) {
        self.send(TtsCmd::Speak {
            text: text.to_string(),
            interrupt: false,
        });
    }

    pub fn speak_now(&self, text: &str) {
        self.send(TtsCmd::Speak {
            text: text.to_string(),
            interrupt: true,
        });
    }

    pub fn stop(&self) {
        self.send(TtsCmd::Stop);
    }

    pub fn set_rate(&self, mult: f32) {
        self.send(TtsCmd::SetRate(mult));
    }

    pub fn set_pitch(&self, mult: f32) {
        self.send(TtsCmd::SetPitch(mult));
    }

    pub fn set_voice(&self, name: &str) {
        self.send(TtsCmd::SetVoice(name.to_string()));
    }

    /// Voice names captured at startup.
    pub fn voices(&self) -> Vec<String> {
        self.voices.lock().clone()
    }

    /// True while speech is queued or playing.
    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::Relaxed)
    }

    fn send(&self, cmd: TtsCmd) {
        let _ = self.tx.send(cmd);
    }
}

impl Drop for TtsHandle {
    fn drop(&mut self) {
        let _ = self.tx.send(TtsCmd::Shutdown);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// After submitting speech, report busy for at least this long even if the
/// backend has not started playing yet (WinRT lags behind `speak`).
const BUSY_GRACE: Duration = Duration::from_millis(600);

fn run_loop(mut tts: Tts, rx: Receiver<TtsCmd>, busy: Arc<AtomicBool>) {
    let mut grace_until = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(TtsCmd::Speak { text, interrupt }) => match tts.speak(&text, interrupt) {
                Ok(_) => grace_until = Instant::now() + BUSY_GRACE,
                Err(e) => tracing::warn!("tts speak failed: {e}"),
            },
            Ok(TtsCmd::Stop) => {
                if let Err(e) = tts.stop() {
                    tracing::warn!("tts stop failed: {e}");
                }
                grace_until = Instant::now();
            }
            Ok(TtsCmd::SetRate(r)) => {
                if let Err(e) = tts.set_rate(r) {
                    tracing::warn!("tts set_rate failed: {e}");
                }
            }
            Ok(TtsCmd::SetPitch(p)) => {
                if let Err(e) = tts.set_pitch(p) {
                    tracing::warn!("tts set_pitch failed: {e}");
                }
            }
            Ok(TtsCmd::SetVoice(v)) => {
                if let Err(e) = tts.set_voice_by_name(&v) {
                    tracing::warn!("tts set_voice failed: {e}");
                }
            }
            Ok(TtsCmd::Shutdown) | Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                let _ = tts.stop();
                busy.store(false, Ordering::Relaxed);
                return;
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
        }
        busy.store(
            Instant::now() < grace_until || tts.is_speaking(),
            Ordering::Relaxed,
        );
    }
}

/// Collapse NWS text artifacts: `*` bullets, `...` pauses, newlines, repeated spaces.
fn clean(s: &str) -> String {
    let s = s.replace("...", ". ").replace('*', " ");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Strip trailing sentence punctuation/space so parts can be joined with ". ".
fn trim_end_punct(s: &str) -> &str {
    s.trim_end_matches(|c: char| c == '.' || c == '!' || c == '?' || c == ',' || c.is_whitespace())
}

/// Truncate at the last sentence boundary within `max_chars`; fall back to a
/// word boundary (with a trailing period).
fn truncate_sentences(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let cut_byte = s
        .char_indices()
        .nth(max_chars)
        .map(|(i, _)| i)
        .unwrap_or(s.len());
    let head = &s[..cut_byte];
    let next_is_space = s[cut_byte..].chars().next().is_none_or(char::is_whitespace);
    let mut end = None;
    for (i, c) in head.char_indices() {
        if matches!(c, '.' | '!' | '?') {
            let after = &head[i + c.len_utf8()..];
            let at_boundary = match after.chars().next() {
                Some(n) => n.is_whitespace(),
                None => next_is_space,
            };
            if at_boundary {
                end = Some(i + c.len_utf8());
            }
        }
    }
    if let Some(e) = end {
        return head[..e].to_string();
    }
    let word_cut = head.rfind(' ').map(|i| &head[..i]).unwrap_or(head);
    format!("{}.", trim_end_punct(word_cut))
}

/// Build the spoken text for an alert.
pub fn alert_announcement(
    display_event: &str,
    headline: Option<&str>,
    area: Option<&str>,
    description: Option<&str>,
    max_chars: usize,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    for p in [Some(display_event), headline, area].into_iter().flatten() {
        let c = clean(p);
        let t = trim_end_punct(&c);
        if !t.is_empty() {
            parts.push(format!("{t}."));
        }
    }
    if let Some(d) = description {
        let c = clean(d);
        // "...." artifacts can leave ". ." sequences behind.
        let c = c.replace(". .", ".");
        if !c.is_empty() {
            let t = truncate_sentences(&c, max_chars);
            if !t.is_empty() {
                parts.push(t);
            }
        }
    }
    parts.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_mapping() {
        assert_eq!(map_rate(1.0, 0.5, 1.0, 6.0), 1.0);
        assert_eq!(map_rate(0.5, 0.5, 1.0, 6.0), 0.5);
        assert_eq!(map_rate(2.0, 0.5, 1.0, 6.0), 6.0);
        assert_eq!(map_rate(9.0, 0.5, 1.0, 6.0), 6.0);
        assert_eq!(map_rate(f32::NAN, 0.5, 1.0, 6.0), 1.0);
        let mut prev = f32::MIN;
        for i in 0..=30 {
            let r = map_rate(0.5 + i as f32 * 0.05, 0.5, 1.0, 6.0);
            assert!(r >= prev);
            prev = r;
        }
    }

    #[test]
    fn announcement_basic() {
        let s = alert_announcement(
            "Tornado Warning",
            Some("Tornado Warning issued for Foo County"),
            Some("Foo; Bar"),
            Some("* WHAT...Tornado.\n\n* WHERE...Foo   County."),
            500,
        );
        assert_eq!(
            s,
            "Tornado Warning. Tornado Warning issued for Foo County. Foo; Bar. WHAT. Tornado. WHERE. Foo County."
        );
    }

    #[test]
    fn announcement_none_fields() {
        assert_eq!(
            alert_announcement("Flood Watch", None, None, None, 100),
            "Flood Watch."
        );
        assert_eq!(
            alert_announcement("Flood Watch", None, Some("Bar"), None, 100),
            "Flood Watch. Bar."
        );
    }

    #[test]
    fn announcement_truncates_at_sentence() {
        let d = "First sentence here. Second sentence is longer and runs on. Third.";
        let s = alert_announcement("Ev", None, None, Some(d), 40);
        assert_eq!(s, "Ev. First sentence here.");
        let s = alert_announcement("Ev", None, None, Some(d), 200);
        assert_eq!(s, format!("Ev. {d}"));
    }

    #[test]
    fn announcement_truncates_at_word_without_sentence() {
        let s = alert_announcement("Ev", None, None, Some("one two three four five"), 12);
        assert_eq!(s, "Ev. one two.");
    }

    #[test]
    fn truncation_is_char_safe() {
        let s = truncate_sentences("ééééé ééééé ééééé", 7);
        assert_eq!(s, "ééééé.");
    }
}
