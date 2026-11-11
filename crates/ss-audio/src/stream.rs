//! Live HTTP audio stream player (MP3/AAC Icecast-style).

use std::io::BufReader;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use rodio::mixer::Mixer;
use rodio::{ChannelCount, Decoder, Player, Sample, SampleRate, Source};
use stream_download::http::reqwest::Url;
use stream_download::storage::temp::TempStorageProvider;
use stream_download::{Settings, StreamDownload};

use crate::{AudioEngine, AudioError};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const FIRST_AUDIO_TIMEOUT: Duration = Duration::from_secs(8);
/// Bytes buffered before the first read is served. The crate default (256 KiB)
/// takes over a minute to fill on a 32 kbps NWR stream and trips the connect
/// timeout; 32 KiB is a few seconds at any common radio bitrate.
const PREFETCH_BYTES: u64 = 32 * 1024;
const TAP_CHUNK: usize = 2048;

/// Receives decoded PCM (mono f32) as the stream plays. Runs on the audio
/// thread: keep `push` fast and non-blocking.
pub trait SampleSink: Send {
    fn push(&mut self, mono: &[f32], sample_rate: u32);
}

#[derive(Debug, Clone)]
pub enum StreamStatus {
    Idle,
    Connecting,
    Playing { url: String, since: Instant },
    Failed { url: String, error: String },
    Ended,
}

/// Sink shared between successive candidate attempts.
struct SharedSink(Arc<Mutex<Box<dyn SampleSink>>>);

impl SampleSink for SharedSink {
    fn push(&mut self, mono: &[f32], sample_rate: u32) {
        self.0.lock().push(mono, sample_rate);
    }
}

/// Pass-through `Source` that copies a mono downmix to a [`SampleSink`].
pub(crate) struct Tap<S: Source> {
    inner: S,
    sink: Option<Box<dyn SampleSink>>,
    buf: Vec<f32>,
    chunk: usize,
    channels: usize,
    acc: f32,
    idx: usize,
    got_audio: Arc<AtomicBool>,
    on_end: Option<Box<dyn FnOnce() + Send>>,
}

impl<S: Source> Tap<S> {
    pub(crate) fn new(
        inner: S,
        sink: Option<Box<dyn SampleSink>>,
        got_audio: Arc<AtomicBool>,
        on_end: Option<Box<dyn FnOnce() + Send>>,
    ) -> Self {
        Tap {
            inner,
            sink,
            buf: Vec::with_capacity(TAP_CHUNK),
            chunk: TAP_CHUNK,
            channels: 1,
            acc: 0.0,
            idx: 0,
            got_audio,
            on_end,
        }
    }

    #[cfg(test)]
    fn with_chunk(mut self, chunk: usize) -> Self {
        self.chunk = chunk;
        self
    }

    fn flush(&mut self) {
        if self.buf.is_empty() {
            return;
        }
        if let Some(sink) = self.sink.as_mut() {
            sink.push(&self.buf, self.inner.sample_rate().get());
        }
        self.buf.clear();
    }

    fn finish(&mut self) {
        self.flush();
        if let Some(f) = self.on_end.take() {
            f();
        }
    }
}

impl<S: Source> Iterator for Tap<S> {
    type Item = Sample;

    fn next(&mut self) -> Option<Sample> {
        let Some(s) = self.inner.next() else {
            self.finish();
            return None;
        };
        if self.idx == 0 {
            self.channels = self.inner.channels().get() as usize;
            self.acc = 0.0;
        }
        self.acc += s;
        self.idx += 1;
        if self.idx >= self.channels {
            self.buf.push(self.acc / self.channels as f32);
            self.idx = 0;
            if self.buf.len() >= self.chunk {
                self.got_audio.store(true, Ordering::Relaxed);
                self.flush();
            }
        }
        Some(s)
    }
}

impl<S: Source> Source for Tap<S> {
    fn current_span_len(&self) -> Option<usize> {
        self.inner.current_span_len()
    }
    fn channels(&self) -> ChannelCount {
        self.inner.channels()
    }
    fn sample_rate(&self) -> SampleRate {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

impl<S: Source> Drop for Tap<S> {
    fn drop(&mut self) {
        // Player stopped/cleared mid-stream: still notify (callback is generation-guarded).
        if let Some(f) = self.on_end.take() {
            f();
        }
    }
}

/// Plays one live stream at a time.
///
/// `play` blocks the calling thread while connecting (up to 15 s): call it
/// from a worker thread, not the UI thread. The player is `Send`.
///
/// The decoder runs on the audio mixer thread, reading from a buffered
/// download; a stalled network can therefore briefly starve audio output.
pub struct StreamPlayer {
    mixer: Mixer,
    rt: tokio::runtime::Handle,
    status: Arc<Mutex<StreamStatus>>,
    generation: Arc<AtomicU64>,
    player: Option<Player>,
    got_audio: Arc<AtomicBool>,
    volume: f32,
}

impl StreamPlayer {
    pub fn new(engine: &AudioEngine, rt: tokio::runtime::Handle) -> StreamPlayer {
        StreamPlayer {
            mixer: engine.mixer(),
            rt,
            status: Arc::new(Mutex::new(StreamStatus::Idle)),
            generation: Arc::new(AtomicU64::new(0)),
            player: None,
            got_audio: Arc::new(AtomicBool::new(false)),
            volume: 1.0,
        }
    }

    pub fn status(&self) -> StreamStatus {
        self.status.lock().clone()
    }

    /// Whether decoded audio has flowed since the last `play`.
    pub fn has_audio(&self) -> bool {
        self.got_audio.load(Ordering::Relaxed)
    }

    pub fn set_volume(&mut self, v: f32) {
        self.volume = v.clamp(0.0, 2.0);
        if let Some(p) = &self.player {
            p.set_volume(self.volume);
        }
    }

    pub fn stop(&mut self) {
        // Invalidate callbacks of the current stream before dropping it.
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(p) = self.player.take() {
            p.stop();
        }
        *self.status.lock() = StreamStatus::Idle;
    }

    /// Connect to `url` and start playback. Blocks until playback is queued
    /// (or fails). Status becomes `Playing` on success.
    pub fn play(&mut self, url: &str, sink: Option<Box<dyn SampleSink>>) -> Result<(), AudioError> {
        self.stop();
        let gen = self.generation.load(Ordering::SeqCst);
        *self.status.lock() = StreamStatus::Connecting;
        self.got_audio = Arc::new(AtomicBool::new(false));

        match self.connect(url, sink, gen) {
            Ok(()) => Ok(()),
            Err(e) => {
                *self.status.lock() = StreamStatus::Failed {
                    url: url.to_string(),
                    error: e.to_string(),
                };
                Err(e)
            }
        }
    }

    fn connect(
        &mut self,
        url: &str,
        sink: Option<Box<dyn SampleSink>>,
        gen: u64,
    ) -> Result<(), AudioError> {
        let parsed: Url = url
            .parse()
            .map_err(|e| AudioError::Stream(format!("invalid url: {e}")))?;
        let deadline = Instant::now() + CONNECT_TIMEOUT;

        // Open the HTTP stream on the async runtime.
        let (tx, rx) = crossbeam_channel::bounded(1);
        self.rt.spawn(async move {
            let r = StreamDownload::new_http(
                parsed,
                TempStorageProvider::new(),
                Settings::default().prefetch_bytes(PREFETCH_BYTES),
            )
            .await
            .map_err(|e| e.to_string());
            let _ = tx.send(r);
        });
        let download = rx
            .recv_timeout(CONNECT_TIMEOUT)
            .map_err(|_| AudioError::Timeout)?
            .map_err(AudioError::Stream)?;

        // Probing the format reads from the stream and blocks: do it on a
        // helper thread so we can enforce the timeout.
        let (dtx, drx) = crossbeam_channel::bounded(1);
        std::thread::Builder::new()
            .name("ss-stream-probe".into())
            .spawn(move || {
                let r = Decoder::builder()
                    .with_data(BufReader::new(download))
                    .with_seekable(false)
                    .build()
                    .map_err(|e| e.to_string());
                let _ = dtx.send(r);
            })
            .map_err(|e| AudioError::Stream(e.to_string()))?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        let decoder = drx
            .recv_timeout(remaining)
            .map_err(|_| AudioError::Timeout)?
            .map_err(AudioError::Decode)?;

        let status = self.status.clone();
        let generation = self.generation.clone();
        let started = Instant::now();
        let url_owned = url.to_string();
        let on_end: Box<dyn FnOnce() + Send> = Box::new(move || {
            if generation.load(Ordering::SeqCst) != gen {
                return;
            }
            let mut st = status.lock();
            if matches!(*st, StreamStatus::Playing { .. }) {
                *st = StreamStatus::Ended;
            }
        });
        let tap = Tap::new(decoder, sink, self.got_audio.clone(), Some(on_end));

        let player = Player::connect_new(&self.mixer);
        player.set_volume(self.volume);
        *self.status.lock() = StreamStatus::Playing {
            url: url_owned,
            since: started,
        };
        player.append(tap);
        self.player = Some(player);
        Ok(())
    }

    /// Try each URL in order; a candidate counts only once decoded audio has
    /// flowed (8 s limit). Returns the URL that worked.
    pub fn try_candidates(
        &mut self,
        urls: &[String],
        sink: Option<Box<dyn SampleSink>>,
    ) -> Result<String, AudioError> {
        let shared = sink.map(|s| Arc::new(Mutex::new(s)));
        let mut last = AudioError::Stream("no candidate urls".into());
        for url in urls {
            let attempt_sink = shared
                .as_ref()
                .map(|s| Box::new(SharedSink(s.clone())) as Box<dyn SampleSink>);
            match self.play(url, attempt_sink) {
                Ok(()) => {
                    let start = Instant::now();
                    loop {
                        if self.got_audio.load(Ordering::Relaxed) {
                            return Ok(url.clone());
                        }
                        if !matches!(self.status(), StreamStatus::Playing { .. }) {
                            last = AudioError::Stream(format!("{url}: stream ended before audio"));
                            break;
                        }
                        if start.elapsed() >= FIRST_AUDIO_TIMEOUT {
                            last = AudioError::Timeout;
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(50));
                    }
                    tracing::debug!("candidate {url} produced no audio: {last}");
                    self.stop();
                    *self.status.lock() = StreamStatus::Failed {
                        url: url.clone(),
                        error: last.to_string(),
                    };
                }
                Err(e) => {
                    tracing::debug!("candidate {url} failed: {e}");
                    last = e;
                }
            }
        }
        Err(last)
    }
}

impl Drop for StreamPlayer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::num::NonZero;

    struct FakeSource {
        data: std::vec::IntoIter<f32>,
        ch: u16,
    }

    impl FakeSource {
        fn new(data: Vec<f32>, ch: u16) -> Self {
            Self {
                data: data.into_iter(),
                ch,
            }
        }
    }

    impl Iterator for FakeSource {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            self.data.next()
        }
    }

    impl Source for FakeSource {
        fn current_span_len(&self) -> Option<usize> {
            None
        }
        fn channels(&self) -> ChannelCount {
            NonZero::new(self.ch).unwrap()
        }
        fn sample_rate(&self) -> SampleRate {
            NonZero::new(8000).unwrap()
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
    }

    #[derive(Default)]
    struct Rec {
        chunks: Vec<(Vec<f32>, u32)>,
    }

    struct RecSink(Arc<Mutex<Rec>>);

    impl SampleSink for RecSink {
        fn push(&mut self, mono: &[f32], sr: u32) {
            self.0.lock().chunks.push((mono.to_vec(), sr));
        }
    }

    #[test]
    fn stereo_downmix_and_chunking() {
        // 6 stereo frames: (1,3) (2,4) (0,0) (1,1) (2,2) (5,5)
        let data = vec![1., 3., 2., 4., 0., 0., 1., 1., 2., 2., 5., 5.];
        let rec = Arc::new(Mutex::new(Rec::default()));
        let got = Arc::new(AtomicBool::new(false));
        let ended = Arc::new(AtomicBool::new(false));
        let e2 = ended.clone();
        let tap = Tap::new(
            FakeSource::new(data.clone(), 2),
            Some(Box::new(RecSink(rec.clone()))),
            got.clone(),
            Some(Box::new(move || e2.store(true, Ordering::SeqCst))),
        )
        .with_chunk(4);
        let out: Vec<f32> = tap.collect();
        assert_eq!(out, data, "audio passes through untouched");
        let r = rec.lock();
        assert_eq!(r.chunks.len(), 2);
        assert_eq!(r.chunks[0], (vec![2., 3., 0., 1.], 8000));
        // Tail (2 frames) flushed at end of stream.
        assert_eq!(r.chunks[1], (vec![2., 5.], 8000));
        assert!(got.load(Ordering::Relaxed));
        assert!(ended.load(Ordering::SeqCst));
    }

    #[test]
    fn mono_passthrough_below_chunk_does_not_signal_audio() {
        let rec = Arc::new(Mutex::new(Rec::default()));
        let got = Arc::new(AtomicBool::new(false));
        let tap = Tap::new(
            FakeSource::new(vec![0.5; 10], 1),
            Some(Box::new(RecSink(rec.clone()))),
            got.clone(),
            None,
        )
        .with_chunk(100);
        assert_eq!(tap.count(), 10);
        assert!(!got.load(Ordering::Relaxed));
        assert_eq!(rec.lock().chunks.len(), 1);
    }

    #[test]
    fn on_end_fires_once_on_drop() {
        let n = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let n2 = n.clone();
        let tap = Tap::new(
            FakeSource::new(vec![0.0; 4], 1),
            None,
            Arc::new(AtomicBool::new(false)),
            Some(Box::new(move || {
                n2.fetch_add(1, Ordering::SeqCst);
            })),
        );
        drop(tap);
        assert_eq!(n.load(Ordering::SeqCst), 1);
    }
}
