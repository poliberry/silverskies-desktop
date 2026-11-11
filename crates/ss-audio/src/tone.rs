//! Small PCM synthesis helpers (mono f32).

use std::f32::consts::TAU;

/// Pure sine wave at `hz` for `secs` seconds.
pub fn sine(hz: f32, secs: f32, sr: u32, gain: f32) -> Vec<f32> {
    let n = (secs.max(0.0) * sr as f32) as usize;
    (0..n)
        .map(|i| (TAU * hz * i as f32 / sr as f32).sin() * gain)
        .collect()
}

/// Linear fade in at the start and fade out at the end, `ms` each.
pub fn fade(samples: &mut [f32], ms: u32, sr: u32) {
    let n = samples.len();
    let f = ((ms as u64 * sr as u64 / 1000) as usize).min(n / 2);
    if f == 0 {
        return;
    }
    for i in 0..f {
        let g = i as f32 / f as f32;
        samples[i] *= g;
        samples[n - 1 - i] *= g;
    }
}

/// Sample-wise sum; the result is as long as the longer input.
pub fn mix(a: &[f32], b: &[f32]) -> Vec<f32> {
    let n = a.len().max(b.len());
    (0..n)
        .map(|i| a.get(i).copied().unwrap_or(0.0) + b.get(i).copied().unwrap_or(0.0))
        .collect()
}

/// EAS attention signal: 853 Hz + 960 Hz. Each component is at `gain / 2` so
/// the peak never exceeds `gain`. 20 ms fades at both ends.
pub fn attention_tone(sample_rate: u32, seconds: f32, gain: f32) -> Vec<f32> {
    let a = sine(853.0, seconds, sample_rate, gain * 0.5);
    let b = sine(960.0, seconds, sample_rate, gain * 0.5);
    let mut out = mix(&a, &b);
    fade(&mut out, 20, sample_rate);
    out
}

/// Short 1 kHz tone (0.5 s) used as the simulated end-of-message marker.
pub fn eas_end_tone(sr: u32) -> Vec<f32> {
    let mut out = sine(1000.0, 0.5, sr, 0.3);
    fade(&mut out, 20, sr);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attention_length_and_bounds() {
        let t = attention_tone(8000, 8.0, 0.35);
        assert_eq!(t.len(), 64_000);
        let peak = t.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak <= 0.35 + 1e-4, "peak {peak}");
        assert!(peak > 0.2, "peak {peak}");
    }

    #[test]
    fn fade_starts_and_ends_near_zero() {
        let t = attention_tone(8000, 1.0, 0.35);
        assert!(t[0].abs() < 1e-3);
        assert!(t[t.len() - 1].abs() < 0.01);
        // After the fade the signal has full amplitude somewhere.
        let mid = t[1000..4000].iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(mid > 0.2);
    }

    #[test]
    fn mix_pads_shorter() {
        assert_eq!(mix(&[1.0, 1.0], &[0.5]), vec![1.5, 1.0]);
    }

    #[test]
    fn fade_handles_tiny_buffers() {
        let mut v = vec![1.0; 3];
        fade(&mut v, 20, 8000);
        // Fade length is clamped to half the buffer: only the edges are zeroed.
        assert_eq!(v, vec![0.0, 1.0, 0.0]);
        let mut empty: Vec<f32> = vec![];
        fade(&mut empty, 20, 8000);
    }

    #[test]
    fn end_tone_is_half_second() {
        let t = eas_end_tone(8000);
        assert_eq!(t.len(), 4000);
        assert!(t.iter().all(|s| s.abs() <= 0.3 + 1e-4));
    }
}
