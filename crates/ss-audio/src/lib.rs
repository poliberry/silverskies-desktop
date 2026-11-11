//! Silver Skies audio layer: tone synthesis, TTS, and live-stream playback.
//!
//! Threading notes for the app layer:
//! - [`AudioEngine`] owns the OS output stream (`cpal::Stream`) and is `!Send`
//!   on at least some platforms; create it and keep it on one thread (the UI
//!   thread). Everything derived from it ([`SoundHandle`], [`StreamPlayer`])
//!   only holds a cloneable mixer handle and is `Send`.
//! - [`TtsHandle`] is `Send + Sync`-friendly (a channel plus an atomic); the
//!   backing `tts::Tts` lives on its own thread.

mod engine;
mod error;
mod stream;
pub mod tone;
mod tts;

pub use engine::{AudioEngine, SoundHandle};
pub use error::AudioError;
pub use stream::{SampleSink, StreamPlayer, StreamStatus};
pub use tts::{alert_announcement, Tts, TtsCmd, TtsHandle};
