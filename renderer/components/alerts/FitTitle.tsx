"use client";

import { useLayoutEffect, useRef } from "react";

export interface FitTitleProps {
  text: string;
  color: string;
  maxFontSizePx?: number;
  minFontSizePx?: number;
}

/**
 * Renders `text` in Google Sans Flex on a single line, sized to fill the
 * available width as fully as possible — matching the big, stretched hero
 * numbers elsewhere in the app, but adapted per-title instead of a fixed
 * `font-variation-settings`.
 *
 * Google Sans Flex's `wdth` axis only goes *wider* than normal (100-150 in
 * the weights loaded — see app/layout.tsx), so "auto-fit" here means: start
 * stretched wide, narrow the `wdth` axis back toward 100 as titles get
 * longer, and only then fall back to shrinking font-size for anything that
 * still doesn't fit at the narrowest width (very long product names like
 * "Severe Thunderstorm Warning (Destructive)").
 */
export function FitTitle({ text, color, maxFontSizePx = 34, minFontSizePx = 15 }: FitTitleProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;
    let cancelled = false;

    function fit() {
      if (cancelled) return;
      const container2 = containerRef.current;
      const el2 = textRef.current;
      if (!container2 || !el2) return;
      let wdth = 150;
      let fontSize = maxFontSizePx;
      el2.style.fontSize = `${fontSize}px`;
      el2.style.fontVariationSettings = `'wdth' ${wdth}`;

      const available = container2.clientWidth;
      if (available <= 0) return; // not laid out yet — the mount-time fit() call below will retry

      while (el2.scrollWidth > available && wdth > 100) {
        wdth -= 2;
        el2.style.fontVariationSettings = `'wdth' ${wdth}`;
      }
      while (el2.scrollWidth > available && fontSize > minFontSizePx) {
        fontSize -= 1;
        el2.style.fontSize = `${fontSize}px`;
      }
    }

    fit();

    // The very first `fit()` call can run before the "Google Sans Flex"
    // webfont has actually finished loading — measuring against the
    // fallback font's (narrower) metrics silently under-shrinks, and the
    // real font swaps in moments later, wider, with nothing left to re-fit
    // it. Re-run once fonts are confirmed settled, and again on any late
    // font load while this title is mounted.
    document.fonts?.ready.then(fit);
    document.fonts?.addEventListener("loadingdone", fit);

    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => {
      cancelled = true;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", fit);
    };
  }, [text, maxFontSizePx, minFontSizePx]);

  return (
    <div ref={containerRef} className="block min-w-0 max-w-full flex-1 overflow-hidden">
      <span
        ref={textRef}
        className="block max-w-full overflow-hidden whitespace-nowrap uppercase"
        style={{
          fontFamily: "'Google Sans Flex', var(--sans)",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color,
          lineHeight: 1.1,
        }}
      >
        {text}
      </span>
    </div>
  );
}
