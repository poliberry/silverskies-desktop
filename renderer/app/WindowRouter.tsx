"use client";

import { useEffect, useState } from "react";
import { Shell } from "@/components/layout/Shell";
import { RadarWindow } from "@/components/radar-window/RadarWindow";
import { ConditionsWindow } from "@/components/conditions-window/ConditionsWindow";
import { AlertWindow } from "@/components/alert-window/AlertWindow";
import type { WindowLocation } from "@/types/windows";

type ParsedRole = "main" | "radar" | "conditions" | "alert";

interface ParsedWindowParams {
  role: ParsedRole;
  instanceId: string | null;
  pairedInstanceId: string | null;
  location: WindowLocation | null;
  token: string | null;
}

function parseWindowParams(): ParsedWindowParams {
  const params = new URLSearchParams(window.location.search);
  const rawRole = params.get("window");
  const role: ParsedRole =
    rawRole === "radar" || rawRole === "conditions" || rawRole === "alert" ? rawRole : "main";
  const lat = params.get("lat");
  const lon = params.get("lon");
  const label = params.get("label");
  const location = lat && lon && label ? { lat: Number(lat), lon: Number(lon), label } : null;
  return {
    role,
    instanceId: params.get("instanceId"),
    pairedInstanceId: params.get("pairedInstanceId"),
    location,
    token: params.get("token"),
  };
}

/**
 * Every window this app opens (main, plus however many radar/conditions/
 * alert pop-outs) loads the exact same static export — there's only one
 * Next.js route. Which component actually renders is decided here, purely
 * client-side, from the `?window=...` query string that electron/main.ts's
 * createAppWindow() appends to each window's own launch URL. Reading
 * `window.location` has to happen after mount (it isn't available during
 * the static export build), mirroring the ssr:false pattern already used
 * for the Leaflet-based RadarMap.
 */
export function WindowRouter() {
  const [params, setParams] = useState<ParsedWindowParams | null>(null);

  useEffect(() => {
    setParams(parseWindowParams());
  }, []);

  if (!params) return null;

  switch (params.role) {
    case "radar":
      return <RadarWindow instanceId={params.instanceId ?? ""} initialLocation={params.location} />;
    case "conditions":
      return (
        <ConditionsWindow instanceId={params.pairedInstanceId ?? ""} initialLocation={params.location} />
      );
    case "alert":
      return <AlertWindow token={params.token ?? ""} />;
    default:
      return <Shell />;
  }
}
