import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This is a two-package layout (root package.json for Electron, this one
  // for Next) so there are two lockfiles on purpose — pin the workspace
  // root explicitly rather than let Turbopack guess and warn about it.
  turbopack: {
    root: path.join(__dirname),
  },
  // Static export: no Node server at runtime. Electron hosts the emitted
  // `out/` folder over the `app://` protocol in production, and loads
  // `next dev` directly on http://localhost:3000 in development.
  output: "export",
  trailingSlash: true,
  images: {
    // No image optimization server is available once exported/embedded in
    // Electron — serve images as-is.
    unoptimized: true,
  },
};

export default nextConfig;
