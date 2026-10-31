"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { SpcOutlookFeature } from "@/lib/alerts/spc-outlook";
import { fmtTime } from "@/lib/units";
import { ipc } from "@/lib/ipc-client";
import { FitTitle } from "./FitTitle";

const SOURCE_URL = "https://www.spc.noaa.gov/products/outlook/day1otlk.html";

/**
 * SPC Day 1 Categorical Outlook banner — only rendered when the active
 * location falls inside a risk polygon (see findOutlookAtPoint). Reuses the
 * same `.alert-line` row/modal chrome as AlertRow for a consistent feel, but
 * deliberately shows just the risk name behind a fixed lightning icon, not
 * the full alert metadata (area/duration text etc.) real alerts carry —
 * this isn't a NormalizedAlert, just today's outlook category. The accent
 * color comes straight from SPC's own per-category hex (spc-outlook.ts)
 * rather than one of the `.alert-*` CSS classes, so it's set via the --ac
 * custom property inline instead of a cssClass.
 */
export function SpcOutlookBanner({ outlook }: { outlook: SpcOutlookFeature }) {
  const accent = { "--ac": outlook.stroke } as React.CSSProperties;
  const duration = `${fmtTime(outlook.valid)} – ${fmtTime(outlook.expire)}`;

  return (
    <Dialog>
      <DialogTrigger
        render={
          <button type="button" className="alert-line" style={accent}>
            <span className="alert-line-icon">
              <i className="ph ph-lightning alert-mc-icon" aria-hidden="true" />
            </span>
            <span className="alert-line-title">{outlook.name}</span>
            <span className="alert-line-meta">SPC Day 1 Outlook · {duration}</span>
            <span className="alert-line-arrow">▸</span>
          </button>
        }
      />
      <DialogContent
        className="max-h-[80vh] w-full overflow-x-hidden overflow-y-auto alert-modal-scroll rounded-none p-6 sm:max-w-lg"
        style={{
          ...accent,
          border: `2px solid var(--ac, #888)`,
          boxShadow: `0 0 32px color-mix(in srgb, var(--ac, #888) 35%, transparent)`,
        }}
        initialFocus={false}
      >
        <div className="min-w-0">
          <DialogHeader className="min-w-0 gap-2">
            <div className="flex items-center gap-3">
              <i
                className="ph ph-lightning"
                aria-hidden="true"
                style={{ fontSize: "2rem", color: "var(--ac, #888)", flexShrink: 0 }}
              />
              <DialogTitle className="min-w-0 flex-1 p-0 text-base font-normal normal-case">
                <FitTitle text={`SPC ${outlook.name}`} color="var(--ac, #888)" />
              </DialogTitle>
            </div>
            <div className="font-mono text-xs leading-relaxed" style={{ color: "var(--text3)" }}>
              Day 1 Convective Outlook · Valid {duration}
            </div>
          </DialogHeader>
          <div className="my-3 h-px w-full" style={{ background: "var(--border)" }} />
          <div className="alert-text min-w-0" style={{ padding: 0, borderTop: "none", overflowWrap: "anywhere" }}>
            Your active location currently falls within the Storm Prediction Center&apos;s{" "}
            <strong>{outlook.name}</strong> category of today&apos;s Day 1 Convective Outlook, covering
            severe thunderstorm potential through {fmtTime(outlook.expire)}.
            <a
              className="alert-nws-link"
              href={SOURCE_URL}
              onClick={(e) => {
                e.preventDefault();
                void ipc.windows.openBrowser({ url: SOURCE_URL, title: "SPC Day 1 Outlook" });
              }}
            >
              SOURCE ↗
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
