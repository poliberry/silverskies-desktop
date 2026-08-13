"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSettings } from "@/hooks/useSettings";
import { BUILTIN_THEMES } from "@/lib/themes/builtinThemes";
import { parseThemeJson } from "@/lib/themes/theme";
import type { ThemeDefinition } from "@/types/settings";

function ThemeSwatch({ colors }: { colors: ThemeDefinition["colors"] }) {
  return (
    <div className="flex h-8 w-full overflow-hidden rounded-sm border" style={{ borderColor: "var(--border)" }}>
      <div className="flex-1" style={{ background: colors.bg ?? "var(--bg)" }} />
      <div className="flex-1" style={{ background: colors.surface ?? "var(--surface)" }} />
      <div className="flex-1" style={{ background: colors.a0 ? `rgb(${colors.a0})` : "var(--accent)" }} />
    </div>
  );
}

export function ThemesPanel() {
  const { config, updateConfig } = useSettings();
  const [pasteDraft, setPasteDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!config) return null;
  const themeId = config.themeId ?? "default";

  // Builtin selection stores the builtin's own id — not the theme object —
  // so a custom theme that happens to share a builtin's display name (e.g.
  // a user's own "Nord Blue") is never mistaken for the real preset.
  function selectBuiltinTheme(id: string) {
    setError(null);
    updateConfig({ themeId: id });
  }

  function applyCustomTheme(theme: ThemeDefinition) {
    setError(null);
    updateConfig({ themeId: "custom", customTheme: theme });
  }

  function handlePasteApply() {
    if (!pasteDraft.trim()) return;
    const result = parseThemeJson(pasteDraft);
    if ("error" in result) {
      setError(result.error.message);
      return;
    }
    applyCustomTheme(result.theme);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const result = parseThemeJson(text);
    if ("error" in result) {
      setError(result.error.message);
      return;
    }
    setPasteDraft(text);
    applyCustomTheme(result.theme);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="settings-bar-section">
        <div className="settings-bar-label">THEME</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            className="glass-card flex flex-col gap-2 p-2.5 text-left"
            style={{ borderColor: themeId === "default" ? "var(--border-active)" : "var(--border)" }}
            onClick={() => {
              setError(null);
              updateConfig({ themeId: "default" });
            }}
          >
            <div className="h-8 w-full rounded-sm" style={{ background: "linear-gradient(90deg, var(--bg), var(--surface), var(--accent))" }} />
            <span className="font-mono text-[0.68rem] uppercase tracking-wider" style={{ color: "var(--text2)" }}>
              Default
            </span>
          </button>
          {BUILTIN_THEMES.map((theme) => (
            <button
              key={theme.id}
              className="glass-card flex flex-col gap-2 p-2.5 text-left"
              style={{ borderColor: themeId === theme.id ? "var(--border-active)" : "var(--border)" }}
              onClick={() => selectBuiltinTheme(theme.id)}
            >
              <ThemeSwatch colors={theme.colors} />
              <span className="font-mono text-[0.68rem] uppercase tracking-wider" style={{ color: "var(--text2)" }}>
                {theme.name}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
          Default follows this app&apos;s normal appearance, including the accent color shifting with current
          conditions. Any other theme replaces the core palette (background, surfaces, text, accent, and
          status colors) everywhere, including pop-out radar/conditions windows.
        </p>
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">LOAD THEME FILE</div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleFileChange} className="hidden" />
        <Button variant="outline" className="w-full justify-start gap-2" onClick={() => fileInputRef.current?.click()}>
          <i className="ph ph-upload-simple" aria-hidden="true" />
          Choose .json file…
        </Button>
      </div>

      <div className="settings-bar-section">
        <div className="settings-bar-label">PASTE THEME JSON</div>
        <textarea
          className="search-input font-mono text-[0.72rem]"
          rows={6}
          spellCheck={false}
          placeholder={'{\n  "name": "My Theme",\n  "colors": { "a0": "255, 90, 90", "bg": "#100808" }\n}'}
          value={pasteDraft}
          onChange={(e) => setPasteDraft(e.target.value)}
        />
        <Button variant="outline" className="mt-2 w-full" onClick={handlePasteApply}>
          Apply Pasted Theme
        </Button>
        <p className="mt-2 font-mono text-[0.68rem]" style={{ color: "var(--text3)" }}>
          Schema: <code>{"{ name, colors: { a0, bg, surface, surface3, border, text, text2, text3, danger, safe } }"}</code>{" "}
          — <code>a0</code> is the accent color as an &quot;r, g, b&quot; triple; every other color is any valid CSS
          color string. Only fields you set are overridden.
        </p>
        {error && (
          <p className="mt-2 font-mono text-[0.68rem]" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
