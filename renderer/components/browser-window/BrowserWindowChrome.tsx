"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { WindowControlButtons } from "@/components/layout/WindowControlButtons";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ipc } from "@/lib/ipc-client";
import type { BrowserWindowState } from "@/types/windows";

export interface BrowserWindowChromeProps {
  url: string;
  title?: string | null;
}

const TITLE_BAR_HEIGHT = 28;
const NAV_BAR_HEIGHT = 36;
const NAV_ICON_SIZE = 15;

/**
 * The "browser" role's own renderer content: a small drag-region title bar
 * (matching AuditLogWindow/ConditionsWindow's own header style) with a
 * back/forward/reload/address/open-externally nav bar underneath it. The
 * actual page lives in a sandboxed WebContentsView the main process layers
 * directly under both of these (see electron/main.ts's
 * attachBrowserContentView), not in anything React renders here, so the
 * content area below is left empty on purpose.
 */
export function BrowserWindowChrome({ url, title }: BrowserWindowChromeProps) {
  const [state, setState] = useState<BrowserWindowState>({
    url,
    title: title ?? url,
    canGoBack: false,
    canGoForward: false,
    isLoading: true,
  });
  const chromeRef = useRef<HTMLDivElement>(null);
  // An editable address bar, not just a read-only display of the current
  // URL — so this window can be pointed at literally anything, not just
  // wherever it was opened for. Only synced from real navigation state
  // while the user isn't actively editing it, so typing a new address
  // doesn't get clobbered by the page's own navigation events mid-keystroke.
  const [addressDraft, setAddressDraft] = useState(url);
  const editingRef = useRef(false);

  useEffect(() => ipc.browser.onState(setState), []);

  useEffect(() => {
    if (!editingRef.current) setAddressDraft(state.url || url);
  }, [state.url, url]);

  function navigateToDraft() {
    const trimmed = addressDraft.trim();
    if (!trimmed) return;
    // A bare "example.com"-style entry (no scheme) is assumed https, the
    // same way a real browser's address bar treats it.
    const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    void ipc.browser.navigate(target);
  }

  // Measures the *real* rendered height of the title bar + nav bar together
  // and reports it to the main process, instead of the main process (see
  // electron/main.ts's attachBrowserContentView) trusting a hardcoded pixel
  // constant to stay in sync with whatever this component actually renders
  // — those two silently drifted apart once before (the nav bar ended up
  // partially hidden under the embedded page). A ResizeObserver, not just a
  // one-time measurement on mount, since OS font/DPI settings can change
  // the real height after the fact.
  useEffect(() => {
    const el = chromeRef.current;
    if (!el) return;
    const report = () => ipc.browser.reportChromeHeight(el.getBoundingClientRect().height);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useDocumentTitle(`${state.title || title || "Browser"} - Silver Skies`);

  return (
    <div className="flex h-screen flex-col" style={{ background: "var(--bg)" }}>
      <div ref={chromeRef} className="flex flex-shrink-0 flex-col">
        <div
          className="drag-region flex items-center justify-between gap-2 font-mono text-xs"
          style={{ height: TITLE_BAR_HEIGHT, padding: "3px 8px", color: "var(--text2)" }}
        >
          <span className="truncate">{state.title || title || url}</span>
          <WindowControlButtons iconSize={11} />
        </div>
        <div
          className="no-drag flex items-center gap-1"
          style={{ height: NAV_BAR_HEIGHT, padding: "0 6px", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
        >
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!state.canGoBack}
          onClick={() => void ipc.browser.goBack()}
          title="Back"
          aria-label="Back"
        >
          <i className="ph ph-arrow-left" aria-hidden="true" style={{ fontSize: NAV_ICON_SIZE }} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!state.canGoForward}
          onClick={() => void ipc.browser.goForward()}
          title="Forward"
          aria-label="Forward"
        >
          <i className="ph ph-arrow-right" aria-hidden="true" style={{ fontSize: NAV_ICON_SIZE }} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => void ipc.browser.reload()} title="Reload" aria-label="Reload">
          <i className={`ph ph-arrow-clockwise ${state.isLoading ? "icon-spin" : ""}`} aria-hidden="true" style={{ fontSize: NAV_ICON_SIZE }} />
        </Button>
        <input
          className="font-mono text-xs"
          value={addressDraft}
          onChange={(e) => setAddressDraft(e.target.value)}
          onFocus={(e) => {
            editingRef.current = true;
            e.currentTarget.select();
          }}
          onBlur={() => {
            editingRef.current = false;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigateToDraft();
              e.currentTarget.blur();
            } else if (e.key === "Escape") {
              setAddressDraft(state.url || url);
              e.currentTarget.blur();
            }
          }}
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            background: "none",
            border: "none",
            outline: "none",
            color: "var(--text2)",
            opacity: 0.9,
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void ipc.app.openExternal(state.url || url)}
          title="Open in system browser"
          aria-label="Open in system browser"
        >
          <i className="ph ph-arrow-square-out" aria-hidden="true" style={{ fontSize: NAV_ICON_SIZE }} />
        </Button>
      </div>
      </div>
      <div className="min-h-0 flex-1" />
    </div>
  );
}
