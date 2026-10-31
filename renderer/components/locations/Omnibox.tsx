"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader, LocateFixed, Search, TriangleAlert, X } from "lucide-react";
import { Button } from "../ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  PLACE_KIND_META,
  deepSearchPlaces,
  formatCoords,
  loadRecentPlaces,
  parseOmniboxQuery,
  rememberRecentPlace,
  suggestPlaces,
  type PlaceSuggestion,
} from "@/lib/omnibox";
import { cn } from "@/lib/utils";
import type { SavedLocation } from "@/types/settings";
import type { WindowLocation } from "@/types/windows";

export interface OmniboxProps {
  /** Biases suggestions toward what's already on screen. */
  near: { lat: number; lon: number } | null;
  savedLocations: SavedLocation[];
  isLocating: boolean;
  error: string | null;
  onSelectPlace: (place: WindowLocation) => void;
  onSelectSaved: (id: string) => void;
  onGps: () => void;
}

type Row =
  | { key: string; type: "gps"; title: string; subtitle: string }
  | { key: string; type: "coords"; title: string; subtitle: string; lat: number; lon: number }
  | { key: string; type: "saved"; title: string; subtitle: string; id: string }
  | { key: string; type: "place"; title: string; subtitle: string; place: PlaceSuggestion; group: "recent" | "result" }
  | { key: string; type: "deep"; title: string; subtitle: string; query: string };

const ROW_ICON: Record<Row["type"], string> = {
  gps: "navigation-arrow",
  coords: "crosshair",
  saved: "star",
  place: "map-pin",
  deep: "magnifying-glass",
};

/**
 * The main window's search field, grown into a full omnibox: type a city, a
 * landmark ("Golden Gate Bridge"), an address, coordinates, a pasted map
 * link, or plain conversational text ("is it raining at the Eiffel Tower?")
 * and pick from live suggestions — saved locations, recents, and OSM
 * places near what's on screen. ⌘K / Ctrl+K or "/" focuses it from
 * anywhere in the window.
 */
export function Omnibox({ near, savedLocations, isLocating, error, onSelectPlace, onSelectSaved, onGps }: OmniboxProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [recents, setRecents] = useState<PlaceSuggestion[]>(loadRecentPlaces);

  const intent = useMemo(() => parseOmniboxQuery(query), [query]);
  const placeQuery = intent.kind === "place" ? intent.query : "";
  const debouncedPlaceQuery = useDebouncedValue(placeQuery, 220);

  // Live suggestions. Keyed on the *cleaned* query, so "weather in Paris"
  // and "Paris" share one request.
  const [results, setResults] = useState<{ query: string; places: PlaceSuggestion[] } | null>(null);
  const [fetchError, setFetchError] = useState(false);
  const [deepSearching, setDeepSearching] = useState(false);
  const [deepError, setDeepError] = useState<string | null>(null);
  useEffect(() => {
    if (debouncedPlaceQuery.length < 2) return;
    const controller = new AbortController();
    const q = debouncedPlaceQuery;
    suggestPlaces(q, { signal: controller.signal, near })
      .then((places) => {
        setResults({ query: q, places });
        setFetchError(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.warn("[omnibox] suggestions failed", err);
        setFetchError(true);
      });
    return () => controller.abort();
    // `near` is only a ranking hint — refetching every time the active
    // location changes would just churn the list under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedPlaceQuery]);
  const places = useMemo(
    () => (results && results.query === placeQuery ? results.places : []),
    [results, placeQuery],
  );
  const isFetching = placeQuery.length >= 2 && (!results || results.query !== placeQuery) && !fetchError;

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const needle = (intent.kind === "place" ? intent.query : query).trim().toLowerCase();

    if (intent.kind === "coords") {
      out.push({
        key: "coords",
        type: "coords",
        title: formatCoords(intent.lat, intent.lon),
        subtitle: "Go to these coordinates",
        lat: intent.lat,
        lon: intent.lon,
      });
    }
    if (intent.kind === "gps" || intent.kind === "empty") {
      out.push({ key: "gps", type: "gps", title: "Use my current location", subtitle: "GPS, falling back to your network location" });
    }

    const saved = needle
      ? savedLocations.filter((l) => l.label.toLowerCase().includes(needle))
      : savedLocations;
    for (const l of saved.slice(0, needle ? 3 : 5)) {
      out.push({ key: `saved:${l.id}`, type: "saved", title: l.label, subtitle: "Saved location", id: l.id });
    }

    if (intent.kind === "empty") {
      for (const p of recents) {
        out.push({ key: `recent:${p.id}`, type: "place", title: p.label, subtitle: p.subtitle, place: p, group: "recent" });
      }
    }

    if (intent.kind === "place") {
      for (const p of places) {
        out.push({ key: `place:${p.id}`, type: "place", title: p.label, subtitle: p.subtitle, place: p, group: "result" });
      }
      if (!isFetching && placeQuery.length >= 2) {
        out.push({
          key: "deep",
          type: "deep",
          title: `Search everywhere for “${placeQuery}”`,
          subtitle: places.length ? "Not what you meant? Try a deeper search" : "No quick matches — try a deeper search",
          query: placeQuery,
        });
      }
    }
    return out;
  }, [intent, query, savedLocations, recents, places, isFetching, placeQuery]);

  // Highlight the first *real* answer — a place result beats "use my
  // location" when the user is clearly typing a place.
  const [prevRowsKey, setPrevRowsKey] = useState("");
  const rowsKey = rows.map((r) => r.key).join("|");
  if (rowsKey !== prevRowsKey) {
    setPrevRowsKey(rowsKey);
    setHighlight(0);
  }

  // ⌘K / Ctrl+K, or "/" when not already typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click-away closes the panel.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function finish() {
    setOpen(false);
    setQuery("");
    setDeepError(null);
    inputRef.current?.blur();
  }

  function choosePlace(place: PlaceSuggestion) {
    setRecents(rememberRecentPlace(place));
    onSelectPlace({ lat: place.lat, lon: place.lon, label: place.label });
    finish();
  }

  async function runDeepSearch(q: string) {
    setDeepSearching(true);
    setDeepError(null);
    try {
      const found = await deepSearchPlaces(q);
      if (found.length === 0) {
        setDeepError(`Couldn't find “${q}”. Try adding a city or country.`);
        return;
      }
      if (found.length === 1) {
        choosePlace(found[0]);
        return;
      }
      // Several candidates — show them instead of guessing.
      setResults({ query: q, places: found });
      setFetchError(false);
    } catch {
      setDeepError("Search is unreachable right now — check your connection.");
    } finally {
      setDeepSearching(false);
    }
  }

  function activate(row: Row | undefined) {
    if (!row) {
      if (intent.kind === "place") void runDeepSearch(intent.query);
      return;
    }
    switch (row.type) {
      case "gps":
        onGps();
        finish();
        return;
      case "coords": {
        const label = formatCoords(row.lat, row.lon);
        choosePlace({ id: `coords:${row.lat},${row.lon}`, lat: row.lat, lon: row.lon, label, subtitle: "Coordinates", kind: "place" });
        return;
      }
      case "saved":
        onSelectSaved(row.id);
        finish();
        return;
      case "place":
        choosePlace(row.place);
        return;
      case "deep":
        void runDeepSearch(row.query);
        return;
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(rows[highlight]);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else finish();
    }
  }

  const rewritten = intent.kind === "place" && intent.query.toLowerCase() !== intent.raw.toLowerCase();
  const busy = isFetching || deepSearching;
  const shownError = deepError ?? (fetchError && intent.kind === "place" ? "Live suggestions are unavailable — press Enter to search." : null);

  return (
    <div ref={rootRef} className={cn("omnibox relative w-full transition-[max-width] duration-200", open ? "max-w-xl" : "max-w-md")}>
      <div
        className={cn(
          "flex h-9 items-center gap-1 px-1 shadow-sm transition bg-muted/60",
          open ? "rounded-t-2xl rounded-b-none bg-popover ring-1 ring-foreground/10" : "rounded-full",
        )}
      >
        <Search className="ml-2 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          ref={inputRef}
          className="h-9 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[highlight] ? `${listId}-${highlight}` : undefined}
          placeholder="Search a place, landmark, or ask “is it raining in Denver?”"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDeepError(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {busy && <Loader className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Searching" />}
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-full text-muted-foreground"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
          >
            <X />
          </Button>
        ) : (
          !open && (
            <kbd className="mr-1 hidden rounded border border-foreground/10 px-1.5 font-mono text-[0.65rem] text-muted-foreground sm:inline">
              ⌘K
            </kbd>
          )
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7 shrink-0 rounded-full text-muted-foreground hover:text-foreground", isLocating && "animate-pulse")}
          onClick={() => {
            onGps();
            finish();
          }}
          title="Use my current location"
          aria-label="Use my current location"
        >
          <LocateFixed />
        </Button>
      </div>

      {open && (
        <div className="omnibox-panel absolute top-full right-0 left-0 z-50 overflow-hidden rounded-b-2xl bg-popover shadow-2xl ring-1 ring-foreground/10">
          {rewritten && (
            <div className="border-b border-foreground/5 px-4 py-1.5 font-mono text-[0.68rem] text-muted-foreground">
              Looking up <span style={{ color: "var(--accent2)" }}>{intent.query}</span>
            </div>
          )}
          <ul id={listId} role="listbox" className="thin-scroll max-h-[min(60vh,420px)] overflow-y-auto py-1">
            {rows.map((row, i) => {
              const icon = row.type === "place" ? (row.group === "recent" ? "clock-counter-clockwise" : PLACE_KIND_META[row.place.kind].icon) : ROW_ICON[row.type];
              const tag =
                row.type === "place"
                  ? row.group === "recent"
                    ? "Recent"
                    : PLACE_KIND_META[row.place.kind].label
                  : row.type === "saved"
                    ? "Saved"
                    : null;
              return (
                <li
                  key={row.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  className={cn("omnibox-row", i === highlight && "active")}
                  onMouseEnter={() => setHighlight(i)}
                  // mousedown, not click — fires before the input's blur.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    activate(row);
                  }}
                >
                  <span className="omnibox-row-icon">
                    <i className={`ph ph-${icon}`} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{row.title}</span>
                    {row.subtitle && <span className="block truncate text-xs text-muted-foreground">{row.subtitle}</span>}
                  </span>
                  {tag && <span className="omnibox-row-tag">{tag}</span>}
                  {i === highlight && <span className="omnibox-row-enter">↵</span>}
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted-foreground">
                {isFetching ? "Searching…" : "Type a city, landmark, address, or coordinates."}
              </li>
            )}
          </ul>
          {shownError && (
            <div className="flex items-center gap-2 border-t border-foreground/5 px-4 py-2 text-xs text-destructive">
              <TriangleAlert size={13} /> {shownError}
            </div>
          )}
        </div>
      )}

      {error && !open && (
        <div className="absolute top-full left-0 mt-2 flex items-center gap-2 rounded-full bg-destructive/20 px-3 py-1.5 text-xs text-destructive">
          <TriangleAlert size={13} /> {error}
        </div>
      )}
    </div>
  );
}
