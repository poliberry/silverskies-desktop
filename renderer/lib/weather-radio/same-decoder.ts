import { goertzelMagnitude } from "./goertzel";

// SAME (Specific Area Message Encoding) AFSK parameters, per the NWS spec —
// mark/space tones at 520.83 baud.
const MARK_FREQ = 2083.3;
const SPACE_FREQ = 1562.5;
export const SAME_BAUD = 520.83;

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
 * Best-effort by nature: typical internet radio relays are lossy-compressed,
 * which can distort the precise tone timing/frequency content AFSK
 * demodulation depends on. A garbled frame just means parseSameHeader
 * returns null for that attempt — the caller (LiveStreamPlayer) surfaces
 * that as "could not fully parse a header yet" rather than treating it as
 * an error.
 */
export class SameDecoder {
  private bitBuffer: number[] = [];
  private textBuffer = "";
  onHeader: ((header: ParsedSameHeader) => void) | null = null;

  pushBaudWindow(samples: Float32Array, sampleRate: number): void {
    const markMag = goertzelMagnitude(samples, MARK_FREQ, sampleRate);
    const spaceMag = goertzelMagnitude(samples, SPACE_FREQ, sampleRate);
    const bit = markMag > spaceMag ? 1 : 0;
    this.bitBuffer.push(bit);
    if (this.bitBuffer.length < 8) return;

    // SAME transmits each byte LSB-first.
    let byte = 0;
    for (let i = 0; i < 8; i++) byte |= this.bitBuffer[i] << i;
    this.bitBuffer = [];
    this.consumeByte(byte);
  }

  private consumeByte(byte: number): void {
    // 0xAB is the AFSK preamble that precedes "ZCZC-..." — nothing useful to
    // append to the text buffer while it's still arriving.
    if (byte === 0xab) return;

    this.textBuffer += String.fromCharCode(byte & 0x7f);
    if (this.textBuffer.length > 4 && !this.textBuffer.includes("ZCZC")) {
      // Not resolving into a recognizable header — drop everything except a
      // short tail (in case "ZCZC" is mid-arrival) rather than growing
      // unbounded on line noise.
      this.textBuffer = this.textBuffer.slice(-4);
      return;
    }
    if (this.textBuffer.length > 80) {
      const header = parseSameHeader(this.textBuffer);
      if (header) this.onHeader?.(header);
      this.textBuffer = "";
    }
  }

  reset(): void {
    this.bitBuffer = [];
    this.textBuffer = "";
  }
}
