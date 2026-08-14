"use client";

import { useRef } from "react";

const RESET_MS = 1500;

/** Generic "N clicks in a row" counter — resets if the gap between clicks
 * exceeds RESET_MS, so it takes `requiredClicks` clicks in quick succession
 * rather than accumulated at any pace over a whole session. Used for the
 * logo-click asteroid-shooter easter egg. */
export function useLogoClickCounter(onTrigger: () => void, requiredClicks = 10): () => void {
  const countRef = useRef(0);
  const lastClickRef = useRef(0);

  return () => {
    const now = Date.now();
    if (now - lastClickRef.current > RESET_MS) countRef.current = 0;
    lastClickRef.current = now;
    countRef.current += 1;
    if (countRef.current >= requiredClicks) {
      countRef.current = 0;
      onTrigger();
    }
  };
}
