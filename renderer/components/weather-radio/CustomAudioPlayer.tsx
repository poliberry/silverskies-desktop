"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { SameDecoder, type ParsedSameHeader } from "@/lib/weather-radio/same-decoder";

export interface AudioCandidate {
  url: string;
  label: string;
}

export interface CustomAudioPlayerProps {
  /** An ordered fallback chain, tried in order and advancing to the next on
   * a playback error — a volunteer-run relay the directory lists as live
   * can still be offline in practice (confirmed: a listed feed 404ing). A
   * manually-entered URL is just a one-candidate list, with nothing to fall
   * back to. */
  candidates: AudioCandidate[];
}

type Status = "connecting" | "playing" | "paused" | "error";

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * A custom-styled player for the weather radio's live stream — no native
 * browser `<audio controls>` chrome, since a live feed has no meaningful
 * duration/seek bar anyway. Play/pause, an elapsed-time readout, a "LIVE"
 * indicator, volume, and (via an AudioWorklet pipeline) best-effort decoded
 * SAME header metadata — plus a visible error state and automatic fallback
 * through `candidates` when one feed turns out to be dead.
 */
export function CustomAudioPlayer({ candidates }: CustomAudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [status, setStatus] = useState<Status>("connecting");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [lastHeader, setLastHeader] = useState<ParsedSameHeader | null>(null);
  const [decodingActive, setDecodingActive] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // Read from the stable (mount-once) error handler below, well after any
  // render/commit — synced via effect rather than mutated inline during
  // render, since only the handler's *next future invocation* ever reads
  // these, not anything render-visible.
  const candidatesRef = useRef(candidates);
  const candidateIndexRef = useRef(candidateIndex);
  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);
  useEffect(() => {
    candidateIndexRef.current = candidateIndex;
  }, [candidateIndex]);

  const candidatesKey = candidates.map((c) => c.url).join(",");
  const current = candidates[candidateIndex];

  // Reset the whole fallback chain (and any stale decode state) whenever
  // the candidate set itself changes — a new location resolving to a
  // different nearest feed, for instance — not on every render.
  useEffect(() => {
    setCandidateIndex(0);
    setStatus("connecting");
    setLastHeader(null);
    setDecodingActive(false);
    setDecodeError(null);
    setElapsedSec(0);
  }, [candidatesKey]);

  // Sets up the AudioContext/AudioWorklet analysis pipeline exactly once
  // per mounted <audio> element — createMediaElementSource() throws if
  // called a second time on the same element, so this must NOT re-run when
  // the candidate (and therefore el.src) changes; the error/playing
  // listeners read the current candidate index via refs instead of being
  // torn down and rebuilt on every fallback swap.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let workletNode: AudioWorkletNode | null = null;
    const decoder = new SameDecoder();
    decoder.onHeader = (header) => {
      if (!cancelled) setLastHeader(header);
    };

    function handlePlaying() {
      setStatus("playing");
    }
    function handlePause() {
      // Fires for both a user-triggered pause() and any browser-driven one
      // (e.g. a network stall) — but not while a fallback swap is already
      // mid-flight to the next candidate, so it doesn't stomp "connecting".
      setStatus((prev) => (prev === "error" || prev === "connecting" ? prev : "paused"));
    }
    function handleTimeUpdate() {
      setElapsedSec(el!.currentTime);
    }
    function handleError() {
      const idx = candidateIndexRef.current;
      if (idx + 1 < candidatesRef.current.length) {
        setCandidateIndex(idx + 1);
        setStatus("connecting");
      } else {
        setStatus("error");
      }
    }
    el.addEventListener("playing", handlePlaying);
    el.addEventListener("pause", handlePause);
    el.addEventListener("timeupdate", handleTimeUpdate);
    el.addEventListener("error", handleError);

    void (async () => {
      try {
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule("/worklets/same-decoder-worklet.js");
        if (cancelled) return;
        const source = ctx.createMediaElementSource(el);
        workletNode = new AudioWorkletNode(ctx, "same-decoder-worklet");
        workletNode.port.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
          setDecodingActive(true);
          decoder.pushBaudWindow(e.data.samples, e.data.sampleRate);
        };
        // Connected to both the decoder (analysis only) and the real
        // output — the AudioWorkletNode itself produces no audible output.
        source.connect(ctx.destination);
        source.connect(workletNode);
      } catch (err) {
        setDecodeError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      el.removeEventListener("playing", handlePlaying);
      el.removeEventListener("pause", handlePause);
      el.removeEventListener("timeupdate", handleTimeUpdate);
      el.removeEventListener("error", handleError);
      workletNode?.disconnect();
      void ctx?.close();
    };
  }, []);

  // Swaps the actual audio source whenever the active candidate changes
  // (initial load, or a fallback advance) — separate from the pipeline
  // setup above so createMediaElementSource is never called twice.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    setStatus("connecting");
    el.src = current.url;
    el.load();
    void el.play().catch(() => {
      /* autoplay can be blocked until a user gesture — the play button still works */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on the URL value, not `current`'s object identity (a fresh object every render, since `candidates` is rebuilt by the caller each time)
  }, [current?.url]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.volume = muted ? 0 : volume;
  }, [muted, volume]);

  function togglePlayPause() {
    const el = audioRef.current;
    if (!el) return;
    if (status === "error") {
      setCandidateIndex(0);
      setStatus("connecting");
      return;
    }
    if (el.paused) void el.play();
    else el.pause();
  }

  return (
    <div className="flex flex-col gap-2">
      <audio ref={audioRef} crossOrigin="anonymous" style={{ display: "none" }} />
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" onClick={togglePlayPause} title={status === "error" ? "Retry" : undefined}>
          <i
            className={`ph ${status === "error" ? "ph-arrow-clockwise" : status === "paused" ? "ph-play" : "ph-pause"}`}
            aria-hidden="true"
            style={{ fontSize: 16 }}
          />
        </Button>
        <div className="flex flex-1 items-center gap-2 font-mono text-xs" style={{ color: "var(--text2)" }}>
          {status === "playing" && (
            <>
              <span className="live-dot" aria-hidden="true" />
              LIVE {formatElapsed(elapsedSec)}
            </>
          )}
          {status === "connecting" && <span style={{ color: "var(--text3)" }}>Connecting…</span>}
          {status === "paused" && <span style={{ color: "var(--text3)" }}>Paused</span>}
          {status === "error" && <span style={{ color: "var(--danger, #ff5566)" }}>Feed unavailable</span>}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setMuted((m) => !m)}>
          <i className={`ph ${muted || volume === 0 ? "ph-speaker-x" : "ph-speaker-high"}`} aria-hidden="true" style={{ fontSize: 16 }} />
        </Button>
        <div style={{ width: 70 }}>
          <Slider
            value={[Math.round((muted ? 0 : volume) * 100)]}
            min={0}
            max={100}
            onValueChange={(v) => {
              const next = (Array.isArray(v) ? v[0] : v) / 100;
              setVolume(next);
              if (next > 0) setMuted(false);
            }}
          />
        </div>
      </div>

      {status === "error" && (
        <p className="font-mono text-[0.68rem]" style={{ color: "var(--danger, #ff5566)" }}>
          Couldn&apos;t connect to {candidates.length > 1 ? "any nearby public feed" : "this feed"}
          {current ? ` (last tried: ${current.label})` : ""}. Volunteer-run relays do go offline —{" "}
          <button className="alert-nws-link" style={{ display: "inline" }} onClick={togglePlayPause}>
            retry
          </button>
          , or check Settings → Radio.
        </p>
      )}
      {status !== "error" && current && candidates.length > 1 && candidateIndex > 0 && (
        <p className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
          Nearest feed was unavailable — now playing {current.label} instead.
        </p>
      )}

      <div className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
        {decodeError
          ? `SAME decoding unavailable: ${decodeError}`
          : lastHeader
            ? (
              <>
                Decoded SAME header — not filtered to your location or region (see Settings):
                <br />
                Originator {lastHeader.originator} · Event {lastHeader.eventCode} · Station {lastHeader.stationId}
                <br />
                FIPS: {lastHeader.fipsList.join(", ")}
              </>
            )
            : decodingActive
              ? "Listening for a SAME header — could not fully parse one yet."
              : ""}
      </div>
    </div>
  );
}
