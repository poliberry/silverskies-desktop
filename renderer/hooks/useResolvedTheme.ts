import { useEffect, useState } from "react";
import { useSettings } from "./useSettings";

/** Resolves the 'system'|'light'|'dark' preference to an actual light/dark
 * value and reflects it onto <html data-theme> (which app/globals.css keys
 * its light-mode overrides off of). */
export function useResolvedTheme(): "light" | "dark" {
  const { config } = useSettings();
  const themePref = config?.theme ?? "system";
  const [systemPrefersDark, setSystemPrefersDark] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemPrefersDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolved: "light" | "dark" =
    themePref === "system" ? (systemPrefersDark ? "dark" : "light") : themePref;

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved);
  }, [resolved]);

  return resolved;
}
