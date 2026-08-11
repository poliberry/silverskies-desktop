import { useEffect, useRef } from "react";
import { googleWeatherIconUrl } from "@/lib/icons/google-weather";
import { wmoLabel } from "@/lib/icons/wmo";
import { ipc } from "@/lib/ipc-client";

const BADGE_SIZE = 48;

/**
 * Draws the current condition's Pixel Weather glyph onto a small circular
 * backing plate and sends it to the main process as the taskbar overlay
 * icon (Windows' `BrowserWindow.setOverlayIcon` — a small badge on the
 * corner of the app's taskbar icon, the same mechanism apps use for
 * notification counts).
 *
 * Rasterizing happens here rather than in the main process because
 * `<canvas>` can load and paint an SVG natively — doing this over in Node
 * would mean pulling in a native image library just for this one badge.
 *
 * The backing plate is a fixed dark tile (not theme-aware) since it needs
 * to read clearly against the Windows *taskbar's* color, which is
 * independent of this app's own light/dark setting — always pairing it
 * with the "dark" (light-lined) icon variant keeps that contrast solid.
 */
export function useTaskbarBadge(weatherCode: number | undefined, isDay: boolean | undefined) {
  const lastKeyRef = useRef<string>("");

  useEffect(() => {
    if (weatherCode === undefined || isDay === undefined) return;
    const key = `${weatherCode}:${isDay}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = BADGE_SIZE;
      canvas.height = BADGE_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const r = BADGE_SIZE / 2;
      ctx.fillStyle = "#141418";
      ctx.beginPath();
      ctx.arc(r, r, r - 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const pad = BADGE_SIZE * 0.16;
      ctx.drawImage(img, pad, pad, BADGE_SIZE - pad * 2, BADGE_SIZE - pad * 2);

      try {
        const dataUrl = canvas.toDataURL("image/png");
        void ipc.app.setOverlayIcon(dataUrl, wmoLabel(weatherCode));
      } catch {
        // Tainted canvas (e.g. the icon CDN not sending CORS headers) —
        // skip the badge rather than throw; the base window icon is
        // unaffected either way.
      }
    };
    img.onerror = () => {
      /* icon CDN unreachable — leave whatever badge was already showing */
    };
    img.src = googleWeatherIconUrl(weatherCode, isDay, "dark");

    return () => {
      cancelled = true;
    };
  }, [weatherCode, isDay]);
}
