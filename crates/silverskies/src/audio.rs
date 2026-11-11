//! Alert announcer (attention tone + TTS) and the weather radio worker.
//!
//! Threading: the [`AudioEngine`] lives on the UI thread inside the
//! [`LiveBackend`]. Everything that can block (stream connects, TTS start-up)
//! runs on helper threads that report back through [`AppEvent`]s.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, Sender, TryRecvError};
use ss_audio::{AudioEngine, SampleSink, SoundHandle, StreamPlayer, StreamStatus, TtsHandle};
use ss_core::same::{DecodedMessage, SameDecoder, ATTENTION_GAIN, ATTENTION_SECONDS};
use ss_core::{Alert, Config, LiveFeedMode, RadioMode};

use crate::events::AppEvent;
use crate::state::{LogLevel, RadioStatus};

const TICK_REPAINT: Duration = Duration::from_millis(200);
const STATUS_POLL: Duration = Duration::from_millis(500);
const TEST_TONE_SECS: f32 = 3.0;
const TEST_TEXT: &str = "Weather Radio Test. This is a test of the Silver Skies weather radio.";
const TTS_PITCH: f32 = 0.85;

// ---------------------------------------------------------------------------
// Announcer state machine
// ---------------------------------------------------------------------------

/// Side effects the announcer needs; faked in tests.
pub trait Backend {
    fn play_tone(&mut self, secs: f32, gain: f32);
    fn tone_done(&self) -> bool;
    fn speak(&mut self, text: &str);
    fn speaking(&self) -> bool;
    fn stop(&mut self);
    /// False while the backend is still starting up; the announcer waits.
    fn ready(&mut self) -> bool {
        true
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Announcement {
    pub text: String,
    pub tone: bool,
    pub tone_secs: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Tone,
    Speaking,
}

pub struct Announcer<B: Backend> {
    backend: B,
    queue: VecDeque<Announcement>,
    current: Option<Announcement>,
    phase: Phase,
}

impl<B: Backend> Announcer<B> {
    pub fn new(backend: B) -> Self {
        Announcer {
            backend,
            queue: VecDeque::new(),
            current: None,
            phase: Phase::Idle,
        }
    }

    pub fn backend_mut(&mut self) -> &mut B {
        &mut self.backend
    }

    pub fn enqueue(&mut self, a: Announcement) {
        self.queue.push_back(a);
    }

    /// Stop whatever is playing and drop everything queued.
    pub fn clear(&mut self) {
        self.queue.clear();
        self.current = None;
        self.phase = Phase::Idle;
        self.backend.stop();
    }

    pub fn is_active(&self) -> bool {
        self.phase != Phase::Idle || !self.queue.is_empty()
    }

    /// Text of the announcement being played, if any.
    pub fn current(&self) -> Option<&str> {
        self.current.as_ref().map(|a| a.text.as_str())
    }

    /// Announcements waiting behind the current one.
    pub fn queued(&self) -> usize {
        self.queue.len()
    }

    pub fn tick(&mut self) {
        // At most a few transitions per call (finish -> start next -> speak).
        for _ in 0..3 {
            match self.phase {
                Phase::Idle => {
                    if self.queue.is_empty() || !self.backend.ready() {
                        return;
                    }
                    let Some(a) = self.queue.pop_front() else {
                        return;
                    };
                    if a.tone {
                        self.backend.play_tone(a.tone_secs, ATTENTION_GAIN);
                        self.phase = Phase::Tone;
                    } else {
                        self.backend.speak(&a.text);
                        self.phase = Phase::Speaking;
                    }
                    self.current = Some(a);
                }
                Phase::Tone => {
                    if !self.backend.tone_done() {
                        return;
                    }
                    if let Some(a) = &self.current {
                        self.backend.speak(&a.text);
                    }
                    self.phase = Phase::Speaking;
                    return;
                }
                Phase::Speaking => {
                    if self.backend.speaking() {
                        return;
                    }
                    self.current = None;
                    self.phase = Phase::Idle;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Live backend: output device + TTS
// ---------------------------------------------------------------------------

enum TtsSlot {
    Pending(Receiver<Option<TtsHandle>>),
    Ready(TtsHandle),
    Unavailable,
}

pub struct LiveBackend {
    engine: Option<AudioEngine>,
    tone: Option<SoundHandle>,
    tts: TtsSlot,
    rate: f32,
}

impl LiveBackend {
    fn poll_tts(&mut self) {
        let next = match &self.tts {
            TtsSlot::Pending(rx) => match rx.try_recv() {
                Ok(Some(h)) => {
                    h.set_rate(self.rate);
                    h.set_pitch(TTS_PITCH);
                    Some(TtsSlot::Ready(h))
                }
                Ok(None) | Err(TryRecvError::Disconnected) => Some(TtsSlot::Unavailable),
                Err(TryRecvError::Empty) => None,
            },
            _ => None,
        };
        if let Some(n) = next {
            self.tts = n;
        }
    }

    fn set_rate(&mut self, rate: f32) {
        self.rate = rate;
        if let TtsSlot::Ready(h) = &self.tts {
            h.set_rate(rate);
        }
    }
}

impl Backend for LiveBackend {
    fn play_tone(&mut self, secs: f32, gain: f32) {
        self.tone = self
            .engine
            .as_ref()
            .map(|e| e.play_attention_tone(secs, gain));
    }

    fn tone_done(&self) -> bool {
        self.tone.as_ref().is_none_or(SoundHandle::is_finished)
    }

    fn speak(&mut self, text: &str) {
        self.tone = None;
        if let TtsSlot::Ready(h) = &self.tts {
            h.speak_queue(text);
        }
    }

    fn speaking(&self) -> bool {
        match &self.tts {
            TtsSlot::Ready(h) => h.is_busy(),
            _ => false,
        }
    }

    fn stop(&mut self) {
        if let Some(t) = self.tone.take() {
            t.stop();
        }
        if let TtsSlot::Ready(h) = &self.tts {
            h.stop();
        }
    }

    fn ready(&mut self) -> bool {
        self.poll_tts();
        !matches!(self.tts, TtsSlot::Pending(_))
    }
}

// ---------------------------------------------------------------------------
// Radio worker
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct RadioCandidate {
    pub label: String,
    pub url: String,
}

enum RadioMsg {
    Play {
        candidates: Vec<RadioCandidate>,
        same: bool,
    },
    Stop,
    Volume(f32),
}

fn post(tx: &Sender<AppEvent>, ctx: &egui::Context, ev: AppEvent) {
    let _ = tx.send(ev);
    ctx.request_repaint();
}

/// Feeds decoded stream audio to a SAME decoder and posts what it finds.
struct SameSink {
    decoder: Option<(SameDecoder, u32)>,
    tx: Sender<AppEvent>,
    ctx: egui::Context,
}

impl SampleSink for SameSink {
    fn push(&mut self, mono: &[f32], sample_rate: u32) {
        let dec = match &mut self.decoder {
            Some((d, sr)) if *sr == sample_rate => d,
            slot => &mut slot.insert((SameDecoder::new(sample_rate), sample_rate)).0,
        };
        let msgs = dec.push_samples(mono);
        if msgs.is_empty() {
            return;
        }
        for m in msgs {
            let ev = match m {
                DecodedMessage::Header(h) => AppEvent::SameHeader(h),
                DecodedMessage::EndOfMessage => AppEvent::SameEom,
            };
            let _ = self.tx.send(ev);
        }
        self.ctx.request_repaint();
    }
}

struct RadioWorker {
    tx: Option<Sender<RadioMsg>>,
    events: Sender<AppEvent>,
    ctx: egui::Context,
}

impl RadioWorker {
    fn new(
        engine: Option<&AudioEngine>,
        rt: tokio::runtime::Handle,
        events: Sender<AppEvent>,
        ctx: egui::Context,
    ) -> RadioWorker {
        let tx = engine.and_then(|e| {
            let player = StreamPlayer::new(e, rt);
            let (tx, rx) = crossbeam_channel::unbounded();
            let (ev, cx) = (events.clone(), ctx.clone());
            let spawned = std::thread::Builder::new()
                .name("ss-radio".into())
                .spawn(move || radio_loop(player, rx, ev, cx));
            match spawned {
                Ok(_) => Some(tx),
                Err(e) => {
                    post(
                        &events,
                        &ctx,
                        AppEvent::Log(LogLevel::Warn, format!("radio thread: {e}")),
                    );
                    None
                }
            }
        });
        RadioWorker { tx, events, ctx }
    }

    fn send(&self, m: RadioMsg) {
        if let Some(tx) = &self.tx {
            let _ = tx.send(m);
        }
    }
}

fn candidates_label(c: &[RadioCandidate]) -> String {
    match c {
        [one] => one.label.clone(),
        many => format!("all {} feeds", many.len()),
    }
}

fn radio_loop(
    mut player: StreamPlayer,
    rx: Receiver<RadioMsg>,
    tx: Sender<AppEvent>,
    ctx: egui::Context,
) {
    let status = |s: RadioStatus| post(&tx, &ctx, AppEvent::RadioStatus(s));
    let mut pending: VecDeque<RadioMsg> = VecDeque::new();
    // Label of the stream currently playing (None when idle/failed).
    let mut active: Option<String> = None;
    loop {
        let msg = match pending.pop_front() {
            Some(m) => Some(m),
            None => match rx.recv_timeout(STATUS_POLL) {
                Ok(m) => Some(m),
                Err(crossbeam_channel::RecvTimeoutError::Timeout) => None,
                Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                    player.stop();
                    return;
                }
            },
        };
        match msg {
            Some(RadioMsg::Volume(v)) => player.set_volume(v),
            Some(RadioMsg::Stop) => {
                player.stop();
                active = None;
            }
            Some(RadioMsg::Play { candidates, same }) => {
                active = None;
                let Some(first) = candidates.first() else {
                    continue;
                };
                status(RadioStatus::Connecting {
                    label: first.label.clone(),
                });
                let urls: Vec<String> = candidates.iter().map(|c| c.url.clone()).collect();
                let sink = same.then(|| {
                    Box::new(SameSink {
                        decoder: None,
                        tx: tx.clone(),
                        ctx: ctx.clone(),
                    }) as Box<dyn SampleSink>
                });
                let result = player.try_candidates(&urls, sink);
                // Anything sent while we were blocked supersedes this result.
                pending.extend(rx.try_iter());
                let superseded = pending
                    .iter()
                    .any(|m| matches!(m, RadioMsg::Play { .. } | RadioMsg::Stop));
                if superseded {
                    player.stop();
                    continue;
                }
                match result {
                    Ok(url) => {
                        let label = candidates
                            .iter()
                            .find(|c| c.url == url)
                            .map(|c| c.label.clone())
                            .unwrap_or_else(|| first.label.clone());
                        status(RadioStatus::Playing {
                            label: label.clone(),
                            url,
                            since: Instant::now(),
                        });
                        active = Some(label);
                    }
                    Err(e) => status(RadioStatus::Failed {
                        label: candidates_label(&candidates),
                        error: e.to_string(),
                    }),
                }
            }
            None => {
                if let Some(label) = &active {
                    match player.status() {
                        StreamStatus::Ended => {
                            status(RadioStatus::Ended {
                                label: label.clone(),
                            });
                            active = None;
                        }
                        StreamStatus::Failed { error, .. } => {
                            status(RadioStatus::Failed {
                                label: label.clone(),
                                error,
                            });
                            active = None;
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// AudioState
// ---------------------------------------------------------------------------

/// Config snapshot that decides what the radio should be doing.
#[derive(Debug, Clone, PartialEq)]
pub struct RadioSyncKey {
    pub enabled: bool,
    pub mode: RadioMode,
    pub feed_mode: LiveFeedMode,
    pub url: Option<String>,
    pub active_location_id: Option<String>,
    pub tts_rate: f32,
}

impl RadioSyncKey {
    pub fn new(cfg: &Config, active_location_id: Option<&str>) -> Self {
        RadioSyncKey {
            enabled: cfg.weather_radio_enabled,
            mode: cfg.weather_radio_mode,
            feed_mode: cfg.weather_radio_live_feed_mode,
            url: cfg.weather_radio_live_stream_url.clone(),
            // Only auto feed resolution depends on where we are.
            active_location_id: (cfg.weather_radio_enabled
                && cfg.weather_radio_mode == RadioMode::Live
                && cfg.weather_radio_live_feed_mode == LiveFeedMode::Auto)
                .then_some(active_location_id)
                .flatten()
                .map(str::to_string),
            tts_rate: cfg.tts_rate,
        }
    }
}

pub struct AudioState {
    announcer: Announcer<LiveBackend>,
    radio: RadioWorker,
    last_sync: Option<RadioSyncKey>,
}

impl AudioState {
    pub fn new(rt: tokio::runtime::Handle, tx: Sender<AppEvent>, ctx: egui::Context) -> Self {
        let engine = match AudioEngine::new() {
            Ok(e) => Some(e),
            Err(e) => {
                post(
                    &tx,
                    &ctx,
                    AppEvent::Log(LogLevel::Warn, format!("audio output unavailable: {e}")),
                );
                None
            }
        };
        let radio = RadioWorker::new(engine.as_ref(), rt, tx.clone(), ctx.clone());
        radio.send(RadioMsg::Volume(0.8));

        // TTS start-up can take seconds: initialise it off the UI thread.
        let (ttx, trx) = crossbeam_channel::bounded(1);
        let (etx, ectx) = (tx.clone(), ctx.clone());
        let spawned = std::thread::Builder::new()
            .name("ss-tts-init".into())
            .spawn(move || match TtsHandle::spawn() {
                Ok(h) => {
                    let _ = ttx.send(Some(h));
                }
                Err(e) => {
                    post(
                        &etx,
                        &ectx,
                        AppEvent::Log(LogLevel::Warn, format!("text-to-speech unavailable: {e}")),
                    );
                    let _ = ttx.send(None);
                }
            });
        let tts = match spawned {
            Ok(_) => TtsSlot::Pending(trx),
            Err(e) => {
                post(
                    &tx,
                    &ctx,
                    AppEvent::Log(LogLevel::Warn, format!("text-to-speech thread: {e}")),
                );
                TtsSlot::Unavailable
            }
        };
        AudioState {
            announcer: Announcer::new(LiveBackend {
                engine,
                tone: None,
                tts,
                rate: 1.0,
            }),
            radio,
            last_sync: None,
        }
    }

    /// Queue an announcement with the standard attention tone length.
    pub fn announce(&mut self, text: String, tone: bool) {
        self.announcer.enqueue(Announcement {
            text,
            tone,
            tone_secs: ATTENTION_SECONDS,
        });
    }

    /// Stop whatever is being said and speak `text` right away.
    pub fn speak_now(&mut self, text: String) {
        self.announcer.clear();
        self.announcer.enqueue(Announcement {
            text,
            tone: false,
            tone_secs: 0.0,
        });
    }

    /// Stop speech and tones and drop the queue. The radio stream is untouched.
    pub fn mute(&mut self) {
        self.announcer.clear();
    }

    pub fn test(&mut self) {
        self.announcer.enqueue(Announcement {
            text: TEST_TEXT.to_string(),
            tone: true,
            tone_secs: TEST_TONE_SECS,
        });
    }

    pub fn set_rate(&mut self, rate: f32) {
        self.announcer.backend_mut().set_rate(rate);
    }

    pub fn radio_play(&mut self, candidates: Vec<RadioCandidate>, same: bool) {
        if candidates.is_empty() {
            return;
        }
        if self.radio.tx.is_none() {
            post(
                &self.radio.events,
                &self.radio.ctx,
                AppEvent::RadioStatus(RadioStatus::Failed {
                    label: candidates_label(&candidates),
                    error: "no audio output device".into(),
                }),
            );
            return;
        }
        self.radio.send(RadioMsg::Play { candidates, same });
    }

    pub fn radio_stop(&mut self) {
        self.radio.send(RadioMsg::Stop);
    }

    pub fn radio_volume(&mut self, v: f32) {
        self.radio.send(RadioMsg::Volume(v.clamp(0.0, 1.0)));
    }

    /// Make the next `sync_changed` report a change (used by `radio retry`).
    pub fn force_resync(&mut self) {
        self.last_sync = None;
    }

    /// Record the current config snapshot. Returns true when it differs from
    /// the previous one; applies the TTS rate when that changed.
    pub fn sync_changed(&mut self, key: RadioSyncKey) -> bool {
        if self.last_sync.as_ref() == Some(&key) {
            return false;
        }
        if self
            .last_sync
            .as_ref()
            .is_none_or(|k| k.tts_rate != key.tts_rate)
        {
            self.set_rate(key.tts_rate);
        }
        self.last_sync = Some(key);
        true
    }

    /// Drive the announcer; call every frame.
    pub fn tick(&mut self, ctx: &egui::Context) {
        self.announcer.tick();
        if self.announcer.is_active() {
            ctx.request_repaint_after(TICK_REPAINT);
        }
    }

    pub fn speaking(&self) -> Option<&str> {
        self.announcer.current()
    }

    pub fn queued(&self) -> usize {
        self.announcer.queued()
    }
}

/// Whether a fresh alert should be announced; `Some(tone)` when it should.
pub fn should_announce(cfg: &Config, alert: &Alert, is_active: bool) -> Option<bool> {
    let simulated = cfg.weather_radio_enabled && cfg.weather_radio_mode == RadioMode::Simulated;
    let tts = cfg.tts_alerts_enabled && cfg.tts_severity_filter.allows(alert.severity);
    if !(tts || simulated) || !(is_active || cfg.tts_all_saved_locations) {
        return None;
    }
    Some(cfg.tts_attention_tone || simulated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ss_core::{AlertSource, Severity, TtsSeverityFilter};
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    #[derive(Default)]
    struct Fake {
        log: Rc<RefCell<Vec<String>>>,
        tone_ticks: u32,
        speech_ticks: u32,
        tone_left: Cell<u32>,
        speech_left: Cell<u32>,
    }

    impl Fake {
        fn new(tone_ticks: u32, speech_ticks: u32) -> (Self, Rc<RefCell<Vec<String>>>) {
            let log = Rc::new(RefCell::new(Vec::new()));
            (
                Fake {
                    log: log.clone(),
                    tone_ticks,
                    speech_ticks,
                    ..Default::default()
                },
                log,
            )
        }
    }

    impl Backend for Fake {
        fn play_tone(&mut self, secs: f32, _gain: f32) {
            self.log.borrow_mut().push(format!("tone {secs}"));
            self.tone_left.set(self.tone_ticks);
        }
        fn tone_done(&self) -> bool {
            let n = self.tone_left.get();
            if n == 0 {
                return true;
            }
            self.tone_left.set(n - 1);
            false
        }
        fn speak(&mut self, text: &str) {
            self.log.borrow_mut().push(format!("speak {text}"));
            self.speech_left.set(self.speech_ticks);
        }
        fn speaking(&self) -> bool {
            let n = self.speech_left.get();
            if n == 0 {
                return false;
            }
            self.speech_left.set(n - 1);
            true
        }
        fn stop(&mut self) {
            self.log.borrow_mut().push("stop".into());
            self.tone_left.set(0);
            self.speech_left.set(0);
        }
    }

    fn ann(text: &str, tone: bool) -> Announcement {
        Announcement {
            text: text.into(),
            tone,
            tone_secs: 8.0,
        }
    }

    fn run(a: &mut Announcer<Fake>, ticks: usize) {
        for _ in 0..ticks {
            a.tick();
        }
    }

    #[test]
    fn tone_then_speech_then_next_in_order() {
        let (b, log) = Fake::new(2, 2);
        let mut a = Announcer::new(b);
        a.enqueue(ann("one", true));
        a.enqueue(ann("two", true));
        assert!(a.is_active());
        run(&mut a, 40);
        assert_eq!(
            *log.borrow(),
            ["tone 8", "speak one", "tone 8", "speak two"]
        );
        assert!(!a.is_active());
        assert_eq!(a.current(), None);
    }

    #[test]
    fn no_tone_when_disabled() {
        let (b, log) = Fake::new(2, 1);
        let mut a = Announcer::new(b);
        a.enqueue(ann("quiet", false));
        a.tick();
        assert_eq!(*log.borrow(), ["speak quiet"]);
        assert_eq!(a.current(), Some("quiet"));
        run(&mut a, 10);
        assert!(!a.is_active());
    }

    #[test]
    fn speech_waits_for_tone_to_finish() {
        let (b, log) = Fake::new(3, 1);
        let mut a = Announcer::new(b);
        a.enqueue(ann("x", true));
        a.tick();
        a.tick();
        assert_eq!(*log.borrow(), ["tone 8"], "still in the tone");
        run(&mut a, 3);
        assert_eq!(*log.borrow(), ["tone 8", "speak x"]);
    }

    #[test]
    fn clear_mid_speech_stops_and_empties() {
        let (b, log) = Fake::new(0, 50);
        let mut a = Announcer::new(b);
        a.enqueue(ann("long", true));
        a.enqueue(ann("never", true));
        run(&mut a, 5);
        assert_eq!(a.current(), Some("long"));
        assert_eq!(a.queued(), 1);
        a.clear();
        assert!(!a.is_active());
        assert_eq!(a.current(), None);
        run(&mut a, 10);
        assert_eq!(log.borrow().last().map(String::as_str), Some("stop"));
        assert!(!log.borrow().iter().any(|l| l == "speak never"));
    }

    struct NotReady(bool, Vec<String>);
    impl Backend for NotReady {
        fn play_tone(&mut self, _: f32, _: f32) {}
        fn tone_done(&self) -> bool {
            true
        }
        fn speak(&mut self, t: &str) {
            self.1.push(t.into());
        }
        fn speaking(&self) -> bool {
            false
        }
        fn stop(&mut self) {}
        fn ready(&mut self) -> bool {
            self.0
        }
    }

    #[test]
    fn waits_until_backend_ready() {
        let mut a = Announcer::new(NotReady(false, vec![]));
        a.enqueue(ann("hold", false));
        run_generic(&mut a, 3);
        assert!(a.backend_mut().1.is_empty());
        a.backend_mut().0 = true;
        a.tick();
        assert_eq!(a.backend_mut().1, ["hold"]);
    }

    fn run_generic<B: Backend>(a: &mut Announcer<B>, n: usize) {
        for _ in 0..n {
            a.tick();
        }
    }

    fn alert(sev: Severity) -> Alert {
        Alert {
            id: "x".into(),
            source: AlertSource::Nws,
            event: "Tornado Warning".into(),
            display_event: "Tornado Warning".into(),
            class: "tornado-warning".into(),
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
    fn should_announce_combinations() {
        let mut c = Config::default();
        let a = alert(Severity::Severe);
        // Everything off.
        c.weather_radio_enabled = false;
        c.tts_alerts_enabled = false;
        assert_eq!(should_announce(&c, &a, true), None);
        // TTS on, tone setting decides.
        c.tts_alerts_enabled = true;
        c.tts_severity_filter = TtsSeverityFilter::SevereAndUp;
        c.tts_attention_tone = true;
        assert_eq!(should_announce(&c, &a, true), Some(true));
        c.tts_attention_tone = false;
        assert_eq!(should_announce(&c, &a, true), Some(false));
        // Severity filter.
        assert_eq!(should_announce(&c, &alert(Severity::Minor), true), None);
        c.tts_severity_filter = TtsSeverityFilter::All;
        assert_eq!(
            should_announce(&c, &alert(Severity::Minor), true),
            Some(false)
        );
        // Non-active location needs the all-locations flag.
        assert_eq!(should_announce(&c, &a, false), None);
        c.tts_all_saved_locations = true;
        assert_eq!(should_announce(&c, &a, false), Some(false));
        // Simulated radio announces regardless of TTS setting and forces the tone.
        c.tts_alerts_enabled = false;
        c.tts_all_saved_locations = false;
        c.weather_radio_enabled = true;
        c.weather_radio_mode = RadioMode::Simulated;
        assert_eq!(
            should_announce(&c, &alert(Severity::Minor), true),
            Some(true)
        );
        assert_eq!(should_announce(&c, &a, false), None);
        // Live mode is not a simulated announcer.
        c.weather_radio_mode = RadioMode::Live;
        assert_eq!(should_announce(&c, &a, true), None);
    }

    #[test]
    fn sync_key_changes() {
        let mut c = Config::default();
        // Location only matters for auto-resolved live feeds.
        assert_eq!(
            RadioSyncKey::new(&c, Some("a")),
            RadioSyncKey::new(&c, Some("b"))
        );
        c.weather_radio_enabled = true;
        c.weather_radio_mode = RadioMode::Live;
        c.weather_radio_live_feed_mode = LiveFeedMode::Auto;
        let k = RadioSyncKey::new(&c, Some("a"));
        assert_eq!(k, RadioSyncKey::new(&c, Some("a")));
        assert_ne!(k, RadioSyncKey::new(&c, Some("b")));
    }
}
