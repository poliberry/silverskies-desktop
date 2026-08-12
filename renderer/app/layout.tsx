import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Silver Skies",
  description: "Silver Skies — radar, forecasts, and severe weather alerts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        {/* Live weather-condition favicon (Google's "Pixel Weather" icon set,
            same one used for the current-location marker) — kept in sync
            with current conditions by hooks/useFavicon.ts. This default is
            just the initial paint before weather data has loaded. */}
        <link rel="icon" id="favicon" type="image/svg+xml" href="https://cdn.jsdelivr.net/gh/mrdarrengriffin/google-weather-icons@main/sets/set-6/dark/sunny.svg" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        {/* Google Sans Flex — large temp display (stretched, wdth 125) and the
            alert modal title (FitTitle narrows wdth instead of shrinking
            font-size to fit long alert names on one line, so the full
            condensed-to-expanded range is loaded, not just 100-150). */}
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:wdth,wght@25..150,100..700&display=swap"
          rel="stylesheet"
        />
        {/* Google Sans — general UI text. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans:opsz,wght@17,400..700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Google+Sans+Code&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          type="text/css"
          href="https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css"
        />
      </head>
      <body className="h-full">
        {/* #top-glow used to live here unconditionally, which meant every
            pop-out window (radar/conditions/alert) inherited the main
            window's animated gradient sweep too. It's now rendered from
            Shell.tsx itself, so only the main window shows it. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
