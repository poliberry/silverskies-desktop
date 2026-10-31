"use client";

import { useLayoutEffect, useRef } from "react";

export interface FitTitleProps {
  text: string;
  color: string;
  fontSizePx?: number;
}

// Google Sans Flex's true wdth axis runs ultra-condensed → extra-expanded
// (confirmed against the font's actual @font-face buckets, not just the
// 100-150 slice used elsewhere for the stretched temp display) — see the
// font link in app/layout.tsx, which loads the full range for this reason.
const MAX_WDTH = 150;
const MIN_WDTH = 25;

/**
 * Renders `text` in Google Sans Flex on a single line, sized to fill the
 * available width as fully as possible — matching the big, stretched hero
 * numbers elsewhere in the app, but adapted per-title instead of a fixed
 * `font-variation-settings`.
 *
 * Fitting is done primarily via the `wdth` variation axis (starting
 * stretched wide, narrowing toward ultra-condensed as titles get longer) —
 * font-size stays fixed. Most product names fit on one line well within the
 * axis range, but some combine a long event name with a long dynamic
 * suffix (e.g. "Flash Flood Warning Issued August 14 at 12:52 PM") that
 * still doesn't fit even fully condensed — those wrap onto additional
 * lines at that same condensed width rather than clipping.
 */
export function FitTitle({ text, color, fontSizePx = 34 }: FitTitleProps) {
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
      let wdth = MAX_WDTH;
      el2.style.fontVariationSettings = `'wdth' ${wdth}`;
      // Reset each pass — a previous fit() (a wider container, shorter text)
      // may have left this wrapped; re-measuring nowrap first is what lets a
      // since-widened container go back to a single line.
      el2.style.whiteSpace = "nowrap";

      const available = container2.clientWidth;
      if (available <= 0) return; // not laid out yet — the mount-time fit() call below will retry

      while (el2.scrollWidth > available && wdth > MIN_WDTH) {
        wdth -= 2;
        el2.style.fontVariationSettings = `'wdth' ${wdth}`;
      }

      // Even fully condensed, some titles (a long event name plus a long
      // dynamic suffix) still don't fit on one line — wrap at that same
      // condensed width instead of clipping the rest of the title.
      if (el2.scrollWidth > available) el2.style.whiteSpace = "normal";
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
  }, [text]);

  return (
    <div ref={containerRef} className="block min-w-0 max-w-full flex-1 overflow-hidden">
      <span
        ref={textRef}
        className="block max-w-full overflow-hidden whitespace-nowrap uppercase"
        style={{
          fontFamily: "'Google Sans Flex', var(--sans)",
          fontWeight: 500,
          fontSize: `${fontSizePx}px`,
          letterSpacing: "-0.01em",
          color,
          lineHeight: 1.1,
          // Only takes effect once fit() switches whiteSpace to "normal" —
          // lets a long single token (rare, but e.g. a run-on location list)
          // break mid-word instead of overflowing its wrapped line.
          overflowWrap: "break-word",
          // Overrides the app-wide `tabular-nums` (body, app/globals.css) —
          // fixed-width digit glyphs read oddly against a title stretched
          // via the wdth axis (e.g. "Mesoscale Discussion 1939"); proportional
          // numerals match the rest of the stretched letterforms.
          fontVariantNumeric: "normal",
        }}
      >
        {text}
      </span>
    </div>
  );
}
