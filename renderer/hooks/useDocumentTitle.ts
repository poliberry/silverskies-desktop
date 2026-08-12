import { useEffect } from "react";

/** Sets document.title — Electron syncs a BrowserWindow's OS-level title
 * (taskbar/title-bar text) to this automatically, the same
 * "page-title-updated" mechanism any browser tab uses, so this is the only
 * renderer-side change needed to give each pop-out window its own dynamic
 * title (e.g. "Melbourne, Victoria - Radar (Rainviewer Original) - Silver
 * Skies"). No electron/main.ts changes required. */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
