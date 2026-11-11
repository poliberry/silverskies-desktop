//! SAME (Specific Area Message Encoding): header parsing and a small
//! non-coherent AFSK decoder / encoder.
//!
//! Modulation: 520.83 baud, mark (1) = 2083.3 Hz, space (0) = 1562.5 Hz,
//! bytes sent LSB first, preceded by a 16 x 0xAB preamble.

use crate::alerts::classify::classify;
use crate::Severity;
use once_cell::sync::Lazy;
use regex::Regex;
use std::f64::consts::TAU;

pub const BAUD: f64 = 520.83;
pub const MARK_HZ: f64 = 2083.3;
pub const SPACE_HZ: f64 = 1562.5;
pub const PREAMBLE_BYTE: u8 = 0xAB;
pub const ATTENTION_SECONDS: f32 = 8.0;
pub const ATTENTION_GAIN: f32 = 0.35;
const MAX_HEADER_CHARS: usize = 200;
/// Consecutive preamble bytes needed to lock.
const LOCK_BYTES: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SameHeader {
    pub originator: String,
    pub event_code: String,
    pub locations: Vec<String>,
    pub purge_minutes: u32,
    pub issued_jjjhhmm: String,
    pub sender: String,
}

static HEADER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"ZCZC-([A-Z]{3})-([A-Z]{3})((?:-\d{6})+)\+(\d{4})-(\d{7})-([^/]+)/").unwrap()
});

/// Parse a `ZCZC-ORG-EEE-PSSCCC+TTTT-JJJHHMM-LLLLLLLL/` header.
pub fn parse_header(text: &str) -> Option<SameHeader> {
    let c = HEADER_RE.captures(text)?;
    let purge = &c[4];
    let hh: u32 = purge[0..2].parse().ok()?;
    let mm: u32 = purge[2..4].parse().ok()?;
    Some(SameHeader {
        originator: c[1].to_string(),
        event_code: c[2].to_string(),
        locations: c[3]
            .split('-')
            .filter(|s| !s.is_empty())
            .map(String::from)
            .collect(),
        purge_minutes: hh * 60 + mm,
        issued_jjjhhmm: c[5].to_string(),
        sender: c[6].to_string(),
    })
}

pub fn event_name(code: &str) -> &'static str {
    match code {
        "TOR" => "Tornado Warning",
        "TOA" => "Tornado Watch",
        "SVR" => "Severe Thunderstorm Warning",
        "SVA" => "Severe Thunderstorm Watch",
        "FFW" => "Flash Flood Warning",
        "FFA" => "Flash Flood Watch",
        "FLW" => "Flood Warning",
        "HUW" => "Hurricane Warning",
        "HUA" => "Hurricane Watch",
        "TRW" => "Tropical Storm Warning",
        "BZW" => "Blizzard Warning",
        "WSW" => "Winter Storm Warning",
        "HWW" => "High Wind Warning",
        "EWW" => "Extreme Wind Warning",
        "FRW" => "Fire Warning",
        "SMW" => "Special Marine Warning",
        "SPS" => "Special Weather Statement",
        "SVS" => "Severe Weather Statement",
        "RWT" => "Required Weekly Test",
        "RMT" => "Required Monthly Test",
        "EAN" => "Emergency Action Notification",
        "CEM" => "Civil Emergency Message",
        "CAE" => "Child Abduction Emergency",
        "EVI" => "Evacuation Immediate",
        "SPW" => "Shelter In Place Warning",
        "NUW" => "Nuclear Power Plant Warning",
        "TSW" => "Tsunami Warning",
        "TSA" => "Tsunami Watch",
        "EQW" => "Earthquake Warning",
        "VOW" => "Volcano Warning",
        "DSW" => "Dust Storm Warning",
        "ADR" => "Administrative Message",
        _ => "Unknown Event",
    }
}

pub fn event_code_to_class(code: &str) -> String {
    classify(event_name(code), None, None, Severity::Unknown)
}

pub fn eom_marker() -> &'static str {
    "NNNN"
}

// ---------------------------------------------------------------------------
// Encoder / tone generators
// ---------------------------------------------------------------------------

fn bit_samples(sample_rate: u32) -> f64 {
    sample_rate as f64 / BAUD
}

/// Phase-continuous AFSK for `16 x 0xAB` + `text` (no leading/trailing silence).
pub fn encode_afsk(text: &str, sample_rate: u32) -> Vec<f32> {
    let mut bytes = vec![PREAMBLE_BYTE; 16];
    bytes.extend_from_slice(text.as_bytes());
    let tb = bit_samples(sample_rate);
    let nbits = bytes.len() * 8;
    let total = (nbits as f64 * tb).round() as usize;
    let mut out = Vec::with_capacity(total);
    let mut phase = 0.0f64;
    for i in 0..total {
        let k = ((i as f64 / tb) as usize).min(nbits - 1);
        let bit = (bytes[k / 8] >> (k % 8)) & 1;
        let f = if bit == 1 { MARK_HZ } else { SPACE_HZ };
        out.push((0.5 * phase.sin()) as f32);
        phase = (phase + TAU * f / sample_rate as f64) % TAU;
    }
    out
}

/// The 853 Hz + 960 Hz attention signal.
pub fn attention_tone(sample_rate: u32, seconds: f32, gain: f32) -> Vec<f32> {
    let n = (sample_rate as f32 * seconds.max(0.0)) as usize;
    (0..n)
        .map(|i| {
            let t = i as f64 / sample_rate as f64;
            let s = (TAU * 853.0 * t).sin() + (TAU * 960.0 * t).sin();
            (s * 0.5) as f32 * gain
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodedMessage {
    Header(SameHeader),
    EndOfMessage,
}

enum State {
    /// Looking for `LOCK_BYTES` consecutive preamble bytes.
    Hunt,
    /// Preamble seen ending at `n0`; waiting one bit to pick the best phase.
    Refine { n0: u64 },
    /// Reading bytes. Bit `k` ends at sample `round(c + k * tb)`.
    Read {
        c: f64,
        k: u64,
        cur: u8,
        nbits: u8,
        buf: Vec<u8>,
    },
}

enum Step {
    Continue,
    Abort,
    Msg(DecodedMessage),
}

/// Streaming SAME decoder. Per sample it keeps a sliding one-bit-long
/// correlation against the mark and space tones; the sign of
/// `|mark| - |space|` is the (soft) bit. Preamble matching finds bit/byte
/// alignment, so no external clock recovery is needed.
pub struct SameDecoder {
    fs: f64,
    tb: f64,
    w: usize,
    ring: Vec<[f64; 4]>,
    ring_pos: usize,
    sums: [f64; 4],
    /// `|mark| - |space|` for every sample since `base`.
    hist: Vec<f32>,
    base: u64,
    total: u64,
    state: State,
}

impl SameDecoder {
    pub fn new(sample_rate: u32) -> Self {
        let tb = bit_samples(sample_rate.max(8000));
        let w = tb.round().max(2.0) as usize;
        Self {
            fs: sample_rate.max(8000) as f64,
            tb,
            w,
            ring: vec![[0.0; 4]; w],
            ring_pos: 0,
            sums: [0.0; 4],
            hist: Vec::new(),
            base: 0,
            total: 0,
            state: State::Hunt,
        }
    }

    /// Feed mono samples; returns any messages completed within them.
    pub fn push_samples(&mut self, mono: &[f32]) -> Vec<DecodedMessage> {
        let mut out = Vec::new();
        for &x in mono {
            self.ingest(x as f64);
            if let Some(m) = self.step() {
                out.push(m);
            }
        }
        let keep = (2.0 * self.fs) as usize;
        if self.hist.len() > 2 * keep {
            let drop = self.hist.len() - keep;
            self.hist.drain(..drop);
            self.base += drop as u64;
        }
        out
    }

    fn ingest(&mut self, x: f64) {
        let t = self.total as f64 / self.fs;
        let (am, asp) = (TAU * (MARK_HZ * t).fract(), TAU * (SPACE_HZ * t).fract());
        let terms = [x * am.cos(), x * am.sin(), x * asp.cos(), x * asp.sin()];
        let old = std::mem::replace(&mut self.ring[self.ring_pos], terms);
        self.ring_pos = (self.ring_pos + 1) % self.w;
        for i in 0..4 {
            self.sums[i] += terms[i] - old[i];
        }
        let mark = self.sums[0].hypot(self.sums[1]);
        let space = self.sums[2].hypot(self.sums[3]);
        self.hist.push((mark - space) as f32);
        self.total += 1;
    }

    fn margin_at(&self, idx: i64) -> Option<f32> {
        if idx < self.base as i64 || idx >= self.total as i64 {
            return None;
        }
        self.hist.get((idx as u64 - self.base) as usize).copied()
    }

    /// Does a run of `LOCK_BYTES` preamble bytes end exactly at sample `n`?
    fn preamble_ends_at(&self, n: u64) -> bool {
        let nbits = LOCK_BYTES * 8;
        for j in 0..nbits {
            let i = nbits - 1 - j; // transmitted bit index; j counts back from the end
            let want = (PREAMBLE_BYTE >> (i % 8)) & 1 == 1;
            let idx = (n as f64 - j as f64 * self.tb).round() as i64;
            match self.margin_at(idx) {
                Some(m) if (want && m > 0.0) || (!want && m < 0.0) => {}
                _ => return false,
            }
        }
        true
    }

    fn preamble_score(&self, n: u64) -> f32 {
        let nbits = LOCK_BYTES * 8;
        let mut s = 0.0;
        for j in 0..nbits {
            let i = nbits - 1 - j;
            let want = (PREAMBLE_BYTE >> (i % 8)) & 1 == 1;
            let idx = (n as f64 - j as f64 * self.tb).round() as i64;
            let m = self.margin_at(idx).unwrap_or(0.0);
            s += if want { m } else { -m };
        }
        s
    }

    fn step(&mut self) -> Option<DecodedMessage> {
        let n = self.total - 1;
        let state = std::mem::replace(&mut self.state, State::Hunt);
        match state {
            State::Hunt => {
                if self.preamble_ends_at(n) {
                    self.state = State::Refine { n0: n };
                }
                None
            }
            State::Refine { n0 } => {
                if n < n0 + self.w as u64 {
                    self.state = State::Refine { n0 };
                    return None;
                }
                let mut best = (f32::MIN, n0);
                for cand in n0..=n0 + self.w as u64 {
                    let s = self.preamble_score(cand);
                    if s > best.0 {
                        best = (s, cand);
                    }
                }
                self.state = State::Read {
                    c: best.1 as f64,
                    k: 1,
                    cur: 0,
                    nbits: 0,
                    buf: Vec::new(),
                };
                self.read_bits()
            }
            read @ State::Read { .. } => {
                self.state = read;
                self.read_bits()
            }
        }
    }

    /// Consume every bit whose end sample is available.
    fn read_bits(&mut self) -> Option<DecodedMessage> {
        let State::Read {
            c,
            mut k,
            mut cur,
            mut nbits,
            mut buf,
        } = std::mem::replace(&mut self.state, State::Hunt)
        else {
            return None;
        };
        loop {
            let end = (c + k as f64 * self.tb).round() as i64;
            if end >= self.total as i64 {
                break;
            }
            let bit = self.margin_at(end).map(|m| m > 0.0).unwrap_or(false);
            cur |= (bit as u8) << nbits;
            nbits += 1;
            k += 1;
            if nbits == 8 {
                let byte = cur;
                cur = 0;
                nbits = 0;
                match handle_byte(&mut buf, byte) {
                    Step::Continue => {}
                    Step::Abort => return None, // state stays Hunt
                    Step::Msg(m) => return Some(m),
                }
            }
        }
        self.state = State::Read {
            c,
            k,
            cur,
            nbits,
            buf,
        };
        None
    }
}

fn handle_byte(buf: &mut Vec<u8>, b: u8) -> Step {
    if buf.is_empty() && b == PREAMBLE_BYTE {
        return Step::Continue;
    }
    if !(0x20..0x7f).contains(&b) {
        return Step::Abort;
    }
    buf.push(b);
    if buf.len() <= 4 {
        if !(b"ZCZC".starts_with(buf) || b"NNNN".starts_with(buf)) {
            return Step::Abort;
        }
        if buf.as_slice() == b"NNNN" {
            return Step::Msg(DecodedMessage::EndOfMessage);
        }
        return Step::Continue;
    }
    if buf.len() > MAX_HEADER_CHARS {
        return Step::Abort;
    }
    if b == b'/' {
        return match std::str::from_utf8(buf).ok().and_then(parse_header) {
            Some(h) => Step::Msg(DecodedMessage::Header(h)),
            None => Step::Abort,
        };
    }
    Step::Continue
}

#[cfg(test)]
mod tests {
    use super::*;

    const HDR: &str = "ZCZC-WXR-TOR-037183-037001+0030-0451800-KRAH/NWS-";

    fn silence(n: usize) -> Vec<f32> {
        vec![0.0; n]
    }

    fn decode_all(fs: u32, samples: &[f32], chunk: usize) -> Vec<DecodedMessage> {
        let mut d = SameDecoder::new(fs);
        samples
            .chunks(chunk)
            .flat_map(|c| d.push_samples(c))
            .collect()
    }

    #[test]
    fn header_parse() {
        let h = parse_header(HDR).unwrap();
        assert_eq!(h.originator, "WXR");
        assert_eq!(h.event_code, "TOR");
        assert_eq!(h.locations, ["037183", "037001"]);
        assert_eq!(h.purge_minutes, 30);
        assert_eq!(h.issued_jjjhhmm, "0451800");
        assert_eq!(h.sender, "KRAH");
    }

    #[test]
    fn header_parse_tolerates_garbage_and_purge_variants() {
        let h = parse_header("xx ZCZC-EAS-RWT-012345+0200-1231234-WABC/FM-").unwrap();
        assert_eq!(h.purge_minutes, 120);
        assert_eq!(
            parse_header("ZCZC-WXR-TOR-037183+0100-0451800-K/")
                .unwrap()
                .purge_minutes,
            60
        );
        assert_eq!(
            parse_header("ZCZC-WXR-TOR-037183+0130-0451800-K/")
                .unwrap()
                .purge_minutes,
            90
        );
        assert_eq!(parse_header("garbage"), None);
        assert_eq!(parse_header("ZCZC-WXR-TOR+0030-0451800-K/"), None);
        assert_eq!(parse_header("ZCZC-WXR-TOR-037183+0030-0451800-KRAH"), None);
    }

    #[test]
    fn events() {
        assert_eq!(event_name("TOR"), "Tornado Warning");
        assert_eq!(event_name("EVI"), "Evacuation Immediate");
        assert_eq!(event_name("???"), "Unknown Event");
        assert_eq!(event_code_to_class("TOR"), "alert-tornado-warning");
        assert_eq!(event_code_to_class("EVI"), "alert-evacuation");
        assert_eq!(event_code_to_class("EAN"), "alert-ean");
        assert_eq!(event_code_to_class("CAE"), "alert-amber");
        assert_eq!(event_code_to_class("ZZZ"), "alert-unknown");
        assert_eq!(eom_marker(), "NNNN");
    }

    #[test]
    fn roundtrip_48k_and_44k() {
        for fs in [48_000u32, 44_100, 16_000] {
            let mut s = silence(fs as usize / 4);
            s.extend(encode_afsk(HDR, fs));
            s.extend(silence(fs as usize / 10));
            let out = decode_all(fs, &s, 1024);
            assert_eq!(
                out,
                vec![DecodedMessage::Header(parse_header(HDR).unwrap())],
                "fs={fs}"
            );
        }
    }

    #[test]
    fn roundtrip_all_sub_bit_phases() {
        let fs = 48_000;
        let sig = encode_afsk(HDR, fs);
        for lead in (0..100).step_by(7) {
            let mut s = silence(5000 + lead);
            s.extend(&sig);
            s.extend(silence(4800));
            let out = decode_all(fs, &s, 777);
            assert_eq!(out.len(), 1, "lead={lead}: {out:?}");
        }
    }

    #[test]
    fn eom() {
        let fs = 48_000;
        let mut s = silence(10_000);
        s.extend(encode_afsk("NNNN", fs));
        s.extend(silence(4800));
        assert_eq!(decode_all(fs, &s, 4096), vec![DecodedMessage::EndOfMessage]);
    }

    #[test]
    fn three_headers_then_eom_with_gaps() {
        let fs = 48_000;
        let mut s = silence(8000);
        for _ in 0..3 {
            s.extend(encode_afsk(HDR, fs));
            s.extend(silence(fs as usize));
        }
        s.extend(attention_tone(fs, 0.5, 0.35));
        s.extend(silence(fs as usize / 2));
        for _ in 0..3 {
            s.extend(encode_afsk("NNNN", fs));
            s.extend(silence(fs as usize));
        }
        let out = decode_all(fs, &s, 2048);
        let hdr = DecodedMessage::Header(parse_header(HDR).unwrap());
        let mut expected = vec![hdr; 3];
        expected.extend(vec![DecodedMessage::EndOfMessage; 3]);
        assert_eq!(out, expected);
    }

    #[test]
    fn tolerates_noise_and_low_level() {
        let fs = 48_000;
        let mut seed = 12345u32;
        let mut noise = move || {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 * 2.0 - 1.0
        };
        let mut s = silence(6000);
        s.extend(encode_afsk(HDR, fs).iter().map(|x| x * 0.4));
        s.extend(silence(6000));
        let noisy: Vec<f32> = s.iter().map(|x| x + noise() * 0.08).collect();
        let out = decode_all(fs, &noisy, 1000);
        assert_eq!(
            out,
            vec![DecodedMessage::Header(parse_header(HDR).unwrap())]
        );
    }

    #[test]
    fn chunk_size_independent() {
        let fs = 48_000;
        let mut s = silence(3000);
        s.extend(encode_afsk(HDR, fs));
        s.extend(silence(4800));
        let a = decode_all(fs, &s, 1);
        let b = decode_all(fs, &s, 100_000);
        assert_eq!(a, b);
        assert_eq!(a.len(), 1);
    }

    #[test]
    fn rejects_noise_attention_tone_and_bad_text() {
        let fs = 48_000;
        assert!(decode_all(fs, &silence(fs as usize), 4096).is_empty());
        assert!(decode_all(fs, &attention_tone(fs, 2.0, 0.35), 4096).is_empty());
        let mut s = encode_afsk("ZCZC-garbage/", fs);
        s.extend(silence(4800));
        assert!(decode_all(fs, &s, 4096).is_empty());
        let mut s = encode_afsk("HELLO WORLD", fs);
        s.extend(silence(4800));
        assert!(decode_all(fs, &s, 4096).is_empty());
    }

    #[test]
    fn long_stream_trims_history() {
        let fs = 16_000;
        let mut d = SameDecoder::new(fs);
        let mut msgs = vec![];
        for _ in 0..4 {
            msgs.extend(d.push_samples(&silence(fs as usize * 3)));
            let mut s = encode_afsk(HDR, fs);
            s.extend(silence(fs as usize / 10));
            msgs.extend(d.push_samples(&s));
        }
        assert_eq!(msgs.len(), 4);
        assert!(d.hist.len() <= 4 * fs as usize + 100_000);
    }

    #[test]
    fn attention_tone_shape() {
        let t = attention_tone(8000, 1.0, 0.35);
        assert_eq!(t.len(), 8000);
        assert!(t.iter().all(|x| x.abs() <= 0.35 + 1e-6));
        assert!(t.iter().any(|x| x.abs() > 0.3));
        assert!(attention_tone(8000, 0.0, 0.35).is_empty());
    }
}
