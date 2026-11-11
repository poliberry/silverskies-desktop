//! Output device ownership and one-shot sample playback.

use std::num::NonZero;

use rodio::buffer::SamplesBuffer;
use rodio::mixer::Mixer;
use rodio::{DeviceSinkBuilder, MixerDeviceSink, Player};

use crate::{tone, AudioError};

/// Owns the default output device.
///
/// `MixerDeviceSink` wraps a `cpal::Stream`, which is `!Send` on some
/// platforms. Treat `AudioEngine` as thread-affine: create it and keep it on
/// the UI thread. Handles it produces ([`SoundHandle`], and the mixer given to
/// the stream player) are `Send`.
pub struct AudioEngine {
    sink: MixerDeviceSink,
}

/// Handle to a playing one-shot sound. Dropping it stops the sound; call
/// [`SoundHandle::detach`] to let it finish on its own.
pub struct SoundHandle {
    sink: Player,
}

impl SoundHandle {
    pub fn stop(&self) {
        self.sink.stop();
    }

    pub fn is_finished(&self) -> bool {
        self.sink.empty()
    }

    pub fn set_volume(&self, v: f32) {
        self.sink.set_volume(v.max(0.0));
    }

    /// Let the sound play to the end even after this handle is dropped.
    pub fn detach(self) {
        self.sink.detach();
    }
}

impl AudioEngine {
    /// Open the default output device. Never panics; returns
    /// [`AudioError::NoDevice`] when no device can be opened.
    pub fn new() -> Result<AudioEngine, AudioError> {
        let opened = std::panic::catch_unwind(DeviceSinkBuilder::open_default_sink)
            .map_err(|_| AudioError::NoDevice("audio backend panicked".into()))?;
        let mut sink = opened.map_err(|e| AudioError::NoDevice(e.to_string()))?;
        sink.log_on_drop(false);
        Ok(AudioEngine { sink })
    }

    /// Cloneable, `Send` handle to the mixer for building players off-thread.
    pub fn mixer(&self) -> Mixer {
        self.sink.mixer().clone()
    }

    /// Play mono f32 samples.
    pub fn play_samples(&self, samples: Vec<f32>, sample_rate: u32) -> SoundHandle {
        let player = Player::connect_new(self.sink.mixer());
        if let (Some(ch), Some(sr)) = (NonZero::new(1u16), NonZero::new(sample_rate)) {
            player.append(SamplesBuffer::new(ch, sr, samples));
        }
        SoundHandle { sink: player }
    }

    pub fn play_attention_tone(&self, seconds: f32, gain: f32) -> SoundHandle {
        const SR: u32 = 44_100;
        self.play_samples(tone::attention_tone(SR, seconds, gain), SR)
    }

    /// Fire-and-forget UI beep.
    pub fn beep(&self, hz: f32, ms: u32, gain: f32) {
        const SR: u32 = 44_100;
        let mut s = tone::sine(hz, ms as f32 / 1000.0, SR, gain);
        tone::fade(&mut s, 5, SR);
        self.play_samples(s, SR).detach();
    }
}
