"use client";

import { useEffect, useRef, useState } from "react";
import { TileLayer } from "react-leaflet";

export interface RadarTileCrossfadeProps {
  url: string | null;
  targetOpacity: number;
  zIndex?: number;
}

type BufferIndex = 0 | 1;

/**
 * Fades between radar frames instead of flashing blank.
 *
 * Leaflet's `TileLayer.setUrl()` clears every currently-visible tile and
 * reloads from scratch — fine for panning (tiles just fill back in), but
 * scrubbing/playing through radar frames on a single TileLayer means every
 * frame change is a brief blank flash while the new tiles arrive.
 *
 * This keeps two TileLayer instances alive and always points frame updates
 * at whichever one is currently *hidden* (opacity 0) — so its clear+reload
 * happens off-screen. Only once that hidden layer's `load` event confirms
 * its tiles are actually painted do we flip visibility, i.e. the visible
 * layer's own url is never touched while it's on screen.
 */
export function RadarTileCrossfade({ url, targetOpacity, zIndex = 5 }: RadarTileCrossfadeProps) {
  const [urls, setUrls] = useState<[string | null, string | null]>([null, null]);
  const [visible, setVisible] = useState<BufferIndex>(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const latestRequestedUrl = useRef<string | null>(null);

  useEffect(() => {
    latestRequestedUrl.current = url;
    if (!url) return;
    setUrls((prev) => {
      if (prev[visibleRef.current] === url) return prev; // already showing this frame
      if (prev[0] === null && prev[1] === null) {
        // Very first frame — nothing on screen to protect, show it directly.
        const next: [string | null, string | null] = [null, null];
        next[visibleRef.current] = url;
        return next;
      }
      const hidden: BufferIndex = visibleRef.current === 0 ? 1 : 0;
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[hidden] = url;
      return next;
    });
  }, [url]);

  function handleLoad(bufferIndex: BufferIndex, loadedUrl: string | null) {
    // Ignore loads for a frame that's since been superseded by a newer
    // request (fast scrubbing can leave a stale in-flight load).
    if (!loadedUrl || loadedUrl !== latestRequestedUrl.current) return;
    if (bufferIndex !== visibleRef.current) setVisible(bufferIndex);
  }

  return (
    <>
      {urls[0] && (
        <TileLayer
          key="radar-buffer-0"
          url={urls[0]}
          opacity={visible === 0 ? targetOpacity : 0}
          zIndex={zIndex}
          eventHandlers={{ load: () => handleLoad(0, urls[0]) }}
        />
      )}
      {urls[1] && (
        <TileLayer
          key="radar-buffer-1"
          url={urls[1]}
          opacity={visible === 1 ? targetOpacity : 0}
          zIndex={zIndex}
          eventHandlers={{ load: () => handleLoad(1, urls[1]) }}
        />
      )}
    </>
  );
}
