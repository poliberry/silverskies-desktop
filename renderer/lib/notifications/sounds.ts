// Notification sounds. The built-ins are synthesized with Web Audio rather
// than shipped as audio files — no assets to bundle, and they scale cleanly
// with the volume setting. "custom" plays a user-supplied file (see
// custom-sounds.ts). Needs `autoplayPolicy: "no-user-gesture-required"` on
// the window (set for every window in electron/main.ts), since these play
// from background timers and freshly opened pop-ups, not user clicks.

import type { NotificationSoundId } from "@/types/settings";
import { getCustomSound, type SoundTier } from "./custom-sounds";

export const NOTIFICATION_SOUNDS: { id: NotificationSoundId; label: string; description: string }[] = [
  { id: "chime", label: "Chime", description: "Soft two-note chime" },
  { id: "ping", label: "Ping", description: "Short, bright ping" },
  { id: "bell", label: "Bell", description: "Struck bell with a long ring" },
  { id: "attention", label: "Attention signal", description: "NOAA/EAS-style two-tone alert" },
  { id: "siren", label: "Siren", description: "Rising and falling wail" },
  { id: "klaxon", label: "Klaxon", description: "Harsh repeating horn" },
  { id: "custom", label: "Custom file…", description: "Your own audio file" },
  { id: "none", label: "None", description: "Silent" },
];

export interface PlayingSound {
  stop: () => void;
  /** Resolves when the sound finishes (or is stopped). */
  done: Promise<void>;
}

const SILENT: PlayingSound = { stop: () => {}, done: Promise.resolve() };

type Synth = (ctx: AudioContext, out: GainNode, t0: number) => number; // returns duration (s)

/** A single enveloped oscillator note. */
function note(
  ctx: AudioContext,
  out: AudioNode,
  { freq, start, dur, type = "sine", peak = 0.6, attack = 0.01 }: {
    freq: number;
    start: number;
    dur: number;
    type?: OscillatorType;
    peak?: number;
    attack?: number;
  },
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(out);
  osc.start(start);
  osc.stop(start + dur + 0.05);
  return osc;
}

const SYNTHS: Record<Exclude<NotificationSoundId, "none" | "custom">, Synth> = {
  chime(ctx, out, t) {
    note(ctx, out, { freq: 1318.5, start: t, dur: 0.9, peak: 0.45 }); // E6
    note(ctx, out, { freq: 987.8, start: t + 0.16, dur: 1.2, peak: 0.45 }); // B5
    return 1.4;
  },
  ping(ctx, out, t) {
    note(ctx, out, { freq: 1760, start: t, dur: 0.35, type: "triangle", peak: 0.6, attack: 0.004 });
    note(ctx, out, { freq: 3520, start: t, dur: 0.18, peak: 0.12, attack: 0.004 });
    return 0.45;
  },
  bell(ctx, out, t) {
    // Inharmonic partials are what make a bell read as a bell.
    for (const [ratio, peak, dur] of [
      [1, 0.5, 2.4],
      [2.76, 0.22, 1.6],
      [5.4, 0.12, 1.0],
      [8.93, 0.06, 0.6],
    ] as const) {
      note(ctx, out, { freq: 440 * ratio, start: t, dur, peak, attack: 0.003 });
    }
    return 2.5;
  },
  attention(ctx, out, t) {
    // The 853 Hz + 960 Hz dual tone of the NWR/EAS attention signal —
    // shortened from the broadcast's 8 s to three 0.9 s bursts.
    for (let i = 0; i < 3; i++) {
      const s = t + i * 1.15;
      note(ctx, out, { freq: 853, start: s, dur: 0.9, type: "sine", peak: 0.35, attack: 0.02 });
      note(ctx, out, { freq: 960, start: s, dur: 0.9, type: "sine", peak: 0.35, attack: 0.02 });
    }
    return 3.4;
  },
  siren(ctx, out, t) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    osc.type = "sawtooth";
    lp.type = "lowpass";
    lp.frequency.value = 2200;
    const cycles = 2;
    const period = 1.6;
    osc.frequency.setValueAtTime(600, t);
    for (let i = 0; i < cycles; i++) {
      osc.frequency.linearRampToValueAtTime(1350, t + i * period + period / 2);
      osc.frequency.linearRampToValueAtTime(600, t + (i + 1) * period);
    }
    const end = t + cycles * period;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.08);
    g.gain.setValueAtTime(0.28, end - 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(lp).connect(g).connect(out);
    osc.start(t);
    osc.stop(end + 0.05);
    return cycles * period;
  },
  klaxon(ctx, out, t) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    lp.connect(out);
    for (let i = 0; i < 4; i++) {
      const s = t + i * 0.55;
      note(ctx, lp, { freq: 440, start: s, dur: 0.4, type: "square", peak: 0.22, attack: 0.01 });
      note(ctx, lp, { freq: 466, start: s, dur: 0.4, type: "sawtooth", peak: 0.16, attack: 0.01 });
    }
    return 2.2;
  },
};

let sharedCtx: AudioContext | null = null;
function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === "closed") sharedCtx = new AudioContext();
  if (sharedCtx.state === "suspended") void sharedCtx.resume();
  return sharedCtx;
}

function playSynth(id: keyof typeof SYNTHS, volume: number): PlayingSound {
  const ctx = audioContext();
  const master = ctx.createGain();
  master.gain.value = Math.max(0, Math.min(1, volume));
  master.connect(ctx.destination);
  const duration = SYNTHS[id](ctx, master, ctx.currentTime + 0.02);
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const timer = setTimeout(() => {
    master.disconnect();
    resolve();
  }, (duration + 0.1) * 1000);
  return {
    stop: () => {
      clearTimeout(timer);
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => master.disconnect(), 100);
      resolve();
    },
    done,
  };
}

function playFile(src: string, volume: number): PlayingSound {
  const audio = new Audio(src);
  audio.volume = Math.max(0, Math.min(1, volume));
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  audio.addEventListener("ended", () => resolve());
  audio.addEventListener("error", () => resolve());
  audio.play().catch(() => resolve());
  return {
    stop: () => {
      audio.pause();
      resolve();
    },
    done,
  };
}

/** Plays a notification sound. A "custom" sound with no file saved yet
 * falls back to the tier's built-in default rather than staying silent —
 * an alert sound that silently doesn't play is worse than the wrong one. */
export function playNotificationSound(id: NotificationSoundId, tier: SoundTier, volume: number): PlayingSound {
  try {
    if (id === "none") return SILENT;
    if (id === "custom") {
      const custom = getCustomSound(tier);
      if (custom) return playFile(custom.dataUrl, volume);
      return playSynth(tier === "severe" ? "attention" : "chime", volume);
    }
    return playSynth(id, volume);
  } catch (err) {
    console.warn("[notifications] couldn't play sound", err);
    return SILENT;
  }
}
