/* eslint-disable @next/next/no-img-element -- static, bundled SVGs; next/image adds nothing here */
import { weatherIconUrl, wmoWeatherIcon, type WeatherIconName } from "@/lib/icons/weather-icons";
import { wmoLabel } from "@/lib/icons/wmo";
import { cn } from "@/lib/utils";

export type WeatherIconProps = {
  className?: string;
  /** Square size in px. Omit to size purely from `className`. */
  size?: number;
  /** Accessible label — defaults to the condition name for WMO icons.
   * Pass "" for purely decorative uses next to visible text. */
  alt?: string;
} & ({ code: number | undefined; isDay?: boolean; name?: never } | { name: WeatherIconName; code?: never; isDay?: never });

/**
 * A Google v3 weather icon. Renders both the dark- and light-background
 * variants and lets CSS show the one matching `<html data-theme>` (see
 * `.weather-icon-*` in globals.css), so no caller — hourly strip, pop-out
 * window, alert row — has to thread the resolved theme through.
 */
export function WeatherIcon({ className, size, alt, ...icon }: WeatherIconProps) {
  const name = icon.name ?? wmoWeatherIcon(icon.code, icon.isDay ?? true);
  const label = alt ?? (icon.code !== undefined ? wmoLabel(icon.code) : name.replace(/_/g, " "));
  const common = {
    width: size,
    height: size,
    draggable: false,
    alt: label,
  };
  return (
    <span className={cn("weather-icon", className)} style={size ? { width: size, height: size } : undefined}>
      <img {...common} className="weather-icon-dark" src={weatherIconUrl(name, "dark")} />
      <img {...common} className="weather-icon-light" src={weatherIconUrl(name, "light")} aria-hidden="true" alt="" />
    </span>
  );
}
