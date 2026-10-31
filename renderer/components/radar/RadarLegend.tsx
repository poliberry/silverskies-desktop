"use client";

import type { LibreWxrColorScheme } from "@/lib/alerts/librewxr";

const SEVERITY_LEGEND: { label: string; color: string }[] = [
  { label: "Extreme", color: "#ff0550" },
  { label: "Severe", color: "#ff7905" },
  { label: "Moderate", color: "#ffd040" },
  { label: "Minor", color: "#80d0ff" },
];

// LibreWXR is an explicit drop-in for the RainViewer tile API and ships the
// same named color-table set (Black and White, Rainviewer Original,
// Universal Blue, TITAN, TWC, Meteored, NEXRAD III, Rainbow, Dark Sky,
// Datameteo Valerio, Viper HD, MRMS CREF). Each of those has a well-known,
// specific dBZ→color progression from actual radar software — mapped here
// by exact name so the legend always matches the scheme currently painting
// the tiles, rather than a single generic gradient.
const GRADIENT_BY_SCHEME_NAME: Record<string, string> = {
  "black and white": "linear-gradient(to right, #e5e5e5, #999999, #4d4d4d, #000000)",
  "rainviewer original": "linear-gradient(to right, #3a5a99, #38a5d1, #3ecf6b, #e8e04a, #e8622e, #c62828)",
  "universal blue": "linear-gradient(to right, #a8d8ff, #4fa8e0, #1c5fb0, #0b2f6b, #ffdd55, #ff6b35, #c1272d)",
  titan: "linear-gradient(to right, #1b3a8c, #1f9e6e, #6fcf5a, #ffe066, #ff9a3d, #e63946, #ffffff)",
  twc: "linear-gradient(to right, #2e7d32, #66bb6a, #dce775, #ffa726, #e53935, #ad1457)",
  "the weather channel": "linear-gradient(to right, #2e7d32, #66bb6a, #dce775, #ffa726, #e53935, #ad1457)",
  meteored: "linear-gradient(to right, #00acc1, #43a047, #c0ca33, #fb8c00, #e53935, #6a1b9a)",
  "nexrad iii": "linear-gradient(to right, #04e9e7, #019ff4, #02fd02, #01c501, #fdf802, #fd0000, #bc0000, #f800fd, #ffffff)",
  "nexrad level iii": "linear-gradient(to right, #04e9e7, #019ff4, #02fd02, #01c501, #fdf802, #fd0000, #bc0000, #f800fd, #ffffff)",
  rainbow: "linear-gradient(to right, #6a0dad, #3949ab, #1e88e5, #26a69a, #66bb6a, #d4e157, #ffb300, #fb8c00, #e53935)",
  "dark sky": "linear-gradient(to right, #1a237e, #4527a0, #7b1fa2, #ad1457, #d81b60, #f06292)",
  "datameteo valerio": "linear-gradient(to right, #2196f3, #4caf50, #cddc39, #ffc107, #ff5722, #b71c1c)",
  "viper hd": "linear-gradient(to right, #0d47a1, #00897b, #7cb342, #fdd835, #fb8c00, #d32f2f, #ffffff)",
  "mrms cref": "linear-gradient(to right, #646464, #04e9e7, #019ff4, #02fd02, #01c501, #fdf802, #fd0000, #bc0000, #f800fd)",
};

const FALLBACK_GRADIENT = "linear-gradient(to right, #6ec6ff, #35c46b, #ffe066, #ff9a3d, #ff4d4d, #b30000)";

function gradientForScheme(name: string | undefined): string {
  if (!name) return FALLBACK_GRADIENT;
  return GRADIENT_BY_SCHEME_NAME[name.trim().toLowerCase()] ?? FALLBACK_GRADIENT;
}

export interface RadarLegendProps {
  colorScheme: number;
  colorSchemes: LibreWxrColorScheme[];
}

export function RadarLegend({ colorScheme, colorSchemes }: RadarLegendProps) {
  const activeScheme = colorSchemes.find((s) => s.id === colorScheme);

  return (
    <div className="glass-card flex flex-col gap-2 p-2.5">
      <div className="flex flex-col gap-1">
        <div className="stat-label" style={{ marginBottom: 0 }}>
          Reflectivity {activeScheme ? `· ${activeScheme.name}` : ""}
        </div>
        <div className="h-2 w-full rounded-sm" style={{ background: gradientForScheme(activeScheme?.name) }} />
        <div className="flex justify-between font-mono text-[0.6rem]" style={{ color: "var(--text3)" }}>
          <span>Light</span>
          <span>Extreme</span>
        </div>
      </div>
      <div className="h-px w-full" style={{ background: "var(--border)" }} />
      <div className="flex flex-col gap-1.5">
        <div className="stat-label" style={{ marginBottom: 0 }}>
          Alert Severity
        </div>
        {SEVERITY_LEGEND.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs" style={{ color: "var(--text2)" }}>
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: item.color, boxShadow: `0 0 6px ${item.color}` }}
            />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
