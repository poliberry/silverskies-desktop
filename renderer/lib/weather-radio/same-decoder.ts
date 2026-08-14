import { goertzelMagnitude } from "./goertzel";

// SAME (Specific Area Message Encoding) AFSK parameters, per the NWS spec —
// mark/space tones at 520.83 baud.
const MARK_FREQ = 2083.3;
const SPACE_FREQ = 1562.5;
export const SAME_BAUD = 520.83;

// Never let a from-noise "lock" or a truly endless non-terminating stream
// grow the text buffer forever — independent of the "/"-triggered parse
// attempt below, which is what actually detects a complete header in the
// normal case.
const MAX_HEADER_CHARS = 200;
// How many consecutive 0xAB preamble bytes to require, at some bit
// alignment, before treating that alignment as a genuine symbol-clock lock
// rather than a coincidental match on noise.
const PREAMBLE_LOCK_BYTES = 4;

export interface ParsedSameHeader {
  originator: string;
  eventCode: string;
  fipsList: string[];
  purgeTime: string;
  stationId: string;
}

/** Parses a raw SAME header string, e.g.
 * "ZCZC-WXR-TOR-019041-019143-019051+0030-1231800-KTLX/NWS-", into its
 * component fields. Returns null on anything that doesn't match the
 * expected grammar — a garbled/partial decode is the *expected* outcome
 * against a lossy real-world stream (see SameDecoder's own doc comment),
 * not a bug to fix here. */
export function parseSameHeader(raw: string): ParsedSameHeader | null {
  const match = raw.match(/ZCZC-([A-Z]{3})-([A-Z]{3})((?:-\d{6})+)\+(\d{4})-(\d{7})-([^/]+)\//);
  if (!match) return null;
  const [, originator, eventCode, fipsBlock, purgeTime, , stationId] = match;
  const fipsList = fipsBlock.split("-").filter(Boolean);
  return { originator, eventCode, fipsList, purgeTime, stationId };
}

/**
 * Real-time AFSK demodulator + byte/header framer for a live SAME-encoded
 * audio stream (weather-radio's "live" mode). Fed one baud period's worth of
 * samples at a time — see public/worklets/same-decoder-worklet.js, which is
 * responsible for slicing the raw audio stream into baud-aligned windows on
 * the audio thread and posting each one back here.
 *
 * The worklet's windows start at whatever arbitrary phase the audio
 * happened to be at when decoding began — not aligned to the transmitter's
 * real symbol clock — so grouping every 8 incoming bits into a byte from
 * bit 0 onward would almost never land on an actual byte boundary. Instead
 * this buffers raw bits and searches for the true alignment by looking for
 * several consecutive 0xAB preamble bytes at each of the 8 possible bit
 * offsets; once one clearly resolves into repeated 0xAB, that's the real
 * byte-clock phase, and framing continues from there until sync is judged
 * lost (see consumeByte).
 *
 * Best-effort by nature regardless: typical internet radio relays are
 * lossy-compressed, which can distort the precise tone timing/frequency
 * content AFSK demodulation depends on. A garbled frame just means
 * parseSameHeader returns null for that attempt — the caller
 * (CustomAudioPlayer) surfaces that as "could not fully parse a header yet"
 * rather than treating it as an error.
 */
export class SameDecoder {
  private bits: number[] = [];
  private synced = false;
  private textBuffer = "";
  onHeader: ((header: ParsedSameHeader) => void) | null = null;

  pushBaudWindow(samples: Float32Array, sampleRate: number): void {
    const markMag = goertzelMagnitude(samples, MARK_FREQ, sampleRate);
    const spaceMag = goertzelMagnitude(samples, SPACE_FREQ, sampleRate);
    this.bits.push(markMag > spaceMag ? 1 : 0);

    if (!this.synced) {
      this.trySync();
      return;
    }
    while (this.bits.length >= 8) {
      this.consumeByte(this.byteFromBits(this.bits.splice(0, 8)));
    }
  }

  private byteFromBits(bits: number[]): number {
    // SAME transmits each byte LSB-first.
    let byte = 0;
    for (let i = 0; i < 8; i++) byte |= bits[i] << i;
    return byte;
  }

  /** Scans every possible bit offset for a run of PREAMBLE_LOCK_BYTES
   * consecutive 0xAB bytes — once found, that offset is the real byte-clock
   * phase. Drops everything before the lock and resumes normal byte framing
   * from there. */
  private trySync(): void {
    const need = 8 * PREAMBLE_LOCK_BYTES;
    for (let offset = 0; offset + need <= this.bits.length; offset++) {
      let consecutive = 0;
      while (offset + (consecutive + 1) * 8 <= this.bits.length) {
        const start = offset + consecutive * 8;
        if (this.byteFromBits(this.bits.slice(start, start + 8)) !== 0xab) break;
        consecutive++;
      }
      if (consecutive >= PREAMBLE_LOCK_BYTES) {
        this.bits.splice(0, offset + consecutive * 8);
        this.synced = true;
        return;
      }
    }
    // No lock yet — cap memory instead of scanning an ever-growing buffer
    // on every incoming bit.
    if (this.bits.length > 2000) this.bits.splice(0, this.bits.length - 1000);
  }

  private consumeByte(byte: number): void {
    // Still inside (or after) the preamble run — nothing textual to append.
    if (byte === 0xab) return;

    this.textBuffer += String.fromCharCode(byte & 0x7f);

    if (this.textBuffer.length > 4 && !this.textBuffer.includes("ZCZC")) {
      // What was locked onto wasn't a genuine preamble (or decoded to
      // garbage right after it) — drop back to bit-level scanning for the
      // next real preamble instead of framing more bytes at a phase that
      // isn't actually the transmitter's symbol clock.
      this.textBuffer = "";
      this.synced = false;
      return;
    }

    // The header's fields are only ever terminated by a "/" — inside the
    // trailing station-id field (e.g. "KTLX/NWS-") — never by a fixed
    // length. A flat length cutoff here previously discarded valid headers
    // that happened to carry more than a couple of FIPS/county codes before
    // ever attempting to parse them. MAX_HEADER_CHARS below is just a
    // memory backstop, not the normal termination signal.
    if (this.textBuffer.includes("/")) {
      const header = parseSameHeader(this.textBuffer);
      if (header) {
        this.onHeader?.(header);
        this.textBuffer = "";
        this.synced = false; // look for the next header fresh
        return;
      }
      // Has a "/" but doesn't fully match yet (e.g. the station-id field is
      // still arriving) — keep buffering.
    }
    if (this.textBuffer.length > MAX_HEADER_CHARS) {
      this.textBuffer = "";
      this.synced = false;
    }
  }

  reset(): void {
    this.bits = [];
    this.synced = false;
    this.textBuffer = "";
  }
}
