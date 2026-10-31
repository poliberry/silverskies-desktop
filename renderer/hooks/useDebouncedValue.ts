import { useEffect, useState } from "react";

/** Settles on `value` only after it stops changing for `delayMs` — used to
 * coalesce rapid radar-scrubber drags into a single tile request instead of
 * one per intermediate frame. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
