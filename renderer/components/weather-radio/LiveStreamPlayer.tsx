"use client";

import { useEffect, useRef, useState } from "react";
import { SameDecoder, type ParsedSameHeader } from "@/lib/weather-radio/same-decoder";

export interface LiveStreamPlayerProps {
  streamUrl: string;
}

/**
 * Plays a user-supplied live audio stream — the "location" signal for live
 * mode, since this app has no FIPS/county database to auto-filter a decoded
 * SAME header against a selected location/region (see the weather-radio
 * feature's documented v1 scope) — while a parallel AudioWorklet-based
 * decoder attempts to extract real SAME header metadata from it, purely for
 * informational display. Audio always plays once connected regardless of
 * whether decoding succeeds.
 */
export function LiveStreamPlayer({ streamUrl }: LiveStreamPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [lastHeader, setLastHeader] = useState<ParsedSameHeader | null>(null);
  const [decodingActive, setDecodingActive] = useState(false);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    let cancelled = false;
    let ctx: AudioContext | null = null;
    let workletNode: AudioWorkletNode | null = null;
    const decoder = new SameDecoder();
    decoder.onHeader = (header) => {
      if (!cancelled) setLastHeader(header);
    };

    void (async () => {
      try {
        ctx = new AudioContext();
        await ctx.audioWorklet.addModule("/worklets/same-decoder-worklet.js");
        if (cancelled) return;
        const source = ctx.createMediaElementSource(audioEl);
        workletNode = new AudioWorkletNode(ctx, "same-decoder-worklet");
        workletNode.port.onmessage = (e: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => {
          setDecodingActive(true);
          decoder.pushBaudWindow(e.data.samples, e.data.sampleRate);
        };
        // Connect to both the decoder (analysis only) and the real output —
        // the AudioWorkletNode itself produces no audible output, so this
        // doesn't double the volume.
        source.connect(ctx.destination);
        source.connect(workletNode);
      } catch (err) {
        setDecodeError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
      workletNode?.disconnect();
      void ctx?.close();
    };
  }, [streamUrl]);

  return (
    <div className="flex flex-col gap-2">
      <audio ref={audioRef} src={streamUrl} autoPlay controls crossOrigin="anonymous" style={{ width: "100%" }} />
      <div className="font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
        {decodeError ? (
          `SAME decoding unavailable: ${decodeError}`
        ) : lastHeader ? (
          <>
            Decoded SAME header — not filtered to your location or region (see Settings):
            <br />
            Originator {lastHeader.originator} · Event {lastHeader.eventCode} · Station {lastHeader.stationId}
            <br />
            FIPS: {lastHeader.fipsList.join(", ")}
          </>
        ) : decodingActive ? (
          "Listening for a SAME header — could not fully parse one yet."
        ) : (
          "Connecting…"
        )}
      </div>
    </div>
  );
}
