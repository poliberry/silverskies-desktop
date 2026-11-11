//! Background network work. Every method spawns a tokio task that posts
//! `AppEvent`s back to the UI and requests a repaint.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crossbeam_channel::Sender;
use ss_core::alerts::classify::{classify, display_event, eccc_class};
use ss_core::alerts::merge::{dedupe_and_sort, feed_plan};
use ss_core::{Alert, BBox, Config, Geometry, LocationsFile, MetarStation, NwrFeed, SavedLocation};
use ss_net::Net;
use tokio::runtime::Handle;

use crate::events::AppEvent;
use crate::state::{LogLevel, WindObs};

type ZoneCache = Arc<Mutex<HashMap<String, Option<Geometry>>>>;
type NwrCache = Arc<Mutex<Option<Vec<NwrFeed>>>>;
type MetarCache = Arc<Mutex<Option<Vec<MetarStation>>>>;

const ZONE_FILL_LIMIT: usize = 40;

/// Contiguous-US box used for the CONUS-wide SPC mesoscale discussion fetch.
const CONUS_BBOX: BBox = BBox {
    west: -125.0,
    south: 24.0,
    east: -66.0,
    north: 50.0,
};
/// Max METAR stations queried per wind-barb viewport.
const WIND_OBS_STATIONS: usize = 40;

#[derive(Clone)]
pub struct Tasks {
    rt: Handle,
    net: Net,
    tx: Sender<AppEvent>,
    ctx: egui::Context,
    zone_cache: ZoneCache,
    nwr_cache: NwrCache,
    metar_cache: MetarCache,
}

impl Tasks {
    pub fn new(rt: Handle, net: Net, tx: Sender<AppEvent>, ctx: egui::Context) -> Tasks {
        Tasks {
            rt,
            net,
            tx,
            ctx,
            zone_cache: Arc::new(Mutex::new(HashMap::new())),
            nwr_cache: Arc::new(Mutex::new(None)),
            metar_cache: Arc::new(Mutex::new(None)),
        }
    }

    fn post(tx: &Sender<AppEvent>, ctx: &egui::Context, ev: AppEvent) {
        let _ = tx.send(ev);
        ctx.request_repaint();
    }

    /// The LibreWXR host is baked into `Net`; rebuild it when the setting changes.
    pub fn set_libre_host(&mut self, host: &str) {
        match Net::new(host) {
            Ok(n) => self.net = n,
            Err(e) => Self::post(
                &self.tx,
                &self.ctx,
                AppEvent::Log(LogLevel::Error, format!("librewxr host: {e}")),
            ),
        }
    }

    pub fn refresh_location(&self, loc: &SavedLocation, cfg: &Config) {
        let (lat, lon) = (loc.lat, loc.lon);
        let key = cfg
            .willy_weather_api_key
            .clone()
            .filter(|k| !k.trim().is_empty());

        let (net, tx, ctx, id) = (
            self.net.clone(),
            self.tx.clone(),
            self.ctx.clone(),
            loc.id.clone(),
        );
        self.rt.spawn(async move {
            let result = net.forecast(lat, lon).await.map_err(|e| e.to_string());
            Self::post(
                &tx,
                &ctx,
                AppEvent::WeatherLoaded {
                    location_id: id,
                    result,
                },
            );
        });

        let (net, tx, ctx, id, cache) = (
            self.net.clone(),
            self.tx.clone(),
            self.ctx.clone(),
            loc.id.clone(),
            self.zone_cache.clone(),
        );
        self.rt.spawn(async move {
            let (alerts, errors) = fetch_alerts(&net, &cache, lat, lon, key).await;
            Self::post(
                &tx,
                &ctx,
                AppEvent::AlertsLoaded {
                    location_id: id,
                    alerts,
                    errors,
                },
            );
        });

        if let Some(k) = cfg
            .open_weather_map_api_key
            .clone()
            .filter(|k| !k.trim().is_empty())
        {
            self.air_quality(loc.id.clone(), lat, lon, k);
        }
    }

    pub fn refresh_all(&self, locs: &LocationsFile, cfg: &Config) {
        for l in &locs.saved_locations {
            self.refresh_location(l, cfg);
        }
    }

    /// Radar stations + weather-map index. Call at startup and every 30 minutes.
    pub fn load_static(&self) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let (stations, maps) = tokio::join!(net.radar_stations(), net.weather_maps());
            Self::post(
                &tx,
                &ctx,
                AppEvent::RadarStations(stations.map_err(|e| e.to_string())),
            );
            Self::post(
                &tx,
                &ctx,
                AppEvent::WeatherMaps(maps.map_err(|e| e.to_string())),
            );
        });
    }

    /// Weather-map frame index only. Frames refresh upstream every ~10 minutes.
    pub fn weather_maps(&self) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let maps = net.weather_maps().await;
            Self::post(
                &tx,
                &ctx,
                AppEvent::WeatherMaps(maps.map_err(|e| e.to_string())),
            );
        });
    }

    /// SPC Day-1 convective outlook and CONUS-wide mesoscale discussions.
    pub fn spc_products(&self) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let (outlook, md) =
                tokio::join!(net.outlook_day1(), net.mesoscale_discussions(CONUS_BBOX));
            Self::post(
                &tx,
                &ctx,
                AppEvent::SpcOutlook(outlook.map_err(|e| e.to_string())),
            );
            let md = md.map_err(|e| e.to_string()).map(|mut v| {
                for a in &mut v {
                    classify_alert(a, false);
                }
                v
            });
            Self::post(&tx, &ctx, AppEvent::McdAlerts(md));
        });
    }

    /// Latest METAR winds for the stations nearest the center of `bbox`.
    /// The station directory is fetched once and cached.
    pub fn wind_obs(&self, bbox: BBox) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        let cache = self.metar_cache.clone();
        self.rt.spawn(async move {
            let cached = cache.lock().ok().and_then(|g| g.clone());
            let stations = match cached {
                Some(s) => Ok(s),
                None => net.metar_stations().await,
            };
            let stations = match stations {
                Ok(s) => {
                    if let Ok(mut g) = cache.lock() {
                        *g = Some(s.clone());
                    }
                    s
                }
                Err(e) => {
                    Self::post(
                        &tx,
                        &ctx,
                        AppEvent::Log(LogLevel::Warn, format!("metar stations: {e}")),
                    );
                    Self::post(
                        &tx,
                        &ctx,
                        AppEvent::WindObs {
                            bbox,
                            obs: Vec::new(),
                        },
                    );
                    return;
                }
            };
            let picked = stations_in_bbox(&stations, &bbox, WIND_OBS_STATIONS);
            let results =
                futures::future::join_all(picked.iter().map(|s| net.latest_observation(&s.id)))
                    .await;
            let obs = picked
                .into_iter()
                .zip(results)
                .filter_map(|(station, obs)| {
                    let obs = obs?;
                    (obs.wind_direction_deg.is_some() && obs.wind_speed_kt.is_some())
                        .then_some(WindObs { station, obs })
                })
                .collect();
            Self::post(&tx, &ctx, AppEvent::WindObs { bbox, obs });
        });
    }

    pub fn air_quality(&self, location_id: String, lat: f64, lon: f64, key: String) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let result = net
                .air_quality(&key, lat, lon)
                .await
                .map_err(|e| e.to_string());
            Self::post(
                &tx,
                &ctx,
                AppEvent::AirQuality {
                    location_id,
                    result,
                },
            );
        });
    }

    pub fn geocode(&self, query: String) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let results = net.geocode(&query).await;
            Self::post(&tx, &ctx, AppEvent::Geocoded { query, results });
        });
    }

    pub fn reverse_geocode(&self, location_id: String, lat: f64, lon: f64) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            if let Some(label) = net.reverse_geocode(lat, lon).await {
                Self::post(&tx, &ctx, AppEvent::ReverseGeocoded { location_id, label });
            }
        });
    }

    /// Resolve the nearest public weather-radio streams for a point. The parsed
    /// directory is cached so repeated toggles do not refetch it.
    pub fn nwr_candidates(&self, location_id: String, lat: f64, lon: f64) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        let cache = self.nwr_cache.clone();
        self.rt.spawn(async move {
            let cached = cache.lock().ok().and_then(|g| g.clone());
            let directory = match cached {
                Some(d) => Ok(d),
                None => net.nwr_directory().await,
            };
            let feeds = match directory {
                Ok(d) => {
                    if let Ok(mut g) = cache.lock() {
                        *g = Some(d.clone());
                    }
                    ss_net::nwr::nearest_feeds(&d, lat, lon, 5)
                        .into_iter()
                        .cloned()
                        .collect()
                }
                Err(e) => {
                    Self::post(
                        &tx,
                        &ctx,
                        AppEvent::Log(LogLevel::Warn, format!("nwr directory: {e}")),
                    );
                    Vec::new()
                }
            };
            Self::post(&tx, &ctx, AppEvent::RadioCandidates { location_id, feeds });
        });
    }

    pub fn ip_locate(&self) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let loc = net.ip_geolocate().await;
            Self::post(&tx, &ctx, AppEvent::IpLocated(loc));
        });
    }

    /// Alerts inside a map selection (LibreWXR + SPC mesoscale discussions).
    pub fn area_alerts(&self, bbox: BBox) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let out = Self::fetch_bbox_alerts(&net, &tx, &ctx, bbox, "area alerts").await;
            Self::post(&tx, &ctx, AppEvent::AreaAlertsLoaded(out));
        });
    }

    /// Alerts inside the visible radar viewport (auto-refreshed).
    pub fn viewport_alerts(&self, bbox: BBox) {
        let (net, tx, ctx) = (self.net.clone(), self.tx.clone(), self.ctx.clone());
        self.rt.spawn(async move {
            let alerts = Self::fetch_bbox_alerts(&net, &tx, &ctx, bbox, "viewport alerts").await;
            Self::post(&tx, &ctx, AppEvent::ViewportAlertsLoaded { bbox, alerts });
        });
    }

    async fn fetch_bbox_alerts(
        net: &Net,
        tx: &Sender<AppEvent>,
        ctx: &egui::Context,
        bbox: BBox,
        label: &str,
    ) -> Vec<Alert> {
        let (libre, md) = tokio::join!(
            net.librewxr_alerts_bbox(bbox),
            net.mesoscale_discussions(bbox)
        );
        let mut out = Vec::new();
        for (src, r) in [("librewxr", libre), ("spc md", md)] {
            match r {
                Ok(v) => out.extend(v),
                Err(e) => Self::post(
                    tx,
                    ctx,
                    AppEvent::Log(LogLevel::Warn, format!("{label} ({src}): {e}")),
                ),
            }
        }
        for a in &mut out {
            classify_alert(a, false);
        }
        dedupe_and_sort(out)
    }
}

/// Stations inside `bbox` (plain range test), nearest the box center first,
/// capped at `n`.
pub fn stations_in_bbox(stations: &[MetarStation], bbox: &BBox, n: usize) -> Vec<MetarStation> {
    let inside: Vec<MetarStation> = stations
        .iter()
        .filter(|s| {
            s.lon >= bbox.west && s.lon <= bbox.east && s.lat >= bbox.south && s.lat <= bbox.north
        })
        .cloned()
        .collect();
    let (clat, clon) = (
        (bbox.south + bbox.north) / 2.0,
        (bbox.west + bbox.east) / 2.0,
    );
    ss_net::nws::nearest_metar_stations(&inside, clat, clon, n)
        .into_iter()
        .cloned()
        .collect()
}

/// Fill in `class` / `display_event` on an alert fresh from `ss-net`.
pub fn classify_alert(a: &mut Alert, eccc: bool) {
    if eccc {
        let raw = std::mem::take(&mut a.class);
        a.class = eccc_class(Some(&raw)).to_string();
    } else {
        a.class = classify(
            &a.event,
            a.headline.as_deref(),
            a.description.as_deref(),
            a.severity,
        );
    }
    a.display_event = display_event(&a.event, &a.class);
}

type FeedResult = Option<Result<Vec<Alert>, ss_net::NetError>>;

fn collect(
    label: &str,
    r: FeedResult,
    eccc: bool,
    alerts: &mut Vec<Alert>,
    errors: &mut Vec<String>,
) {
    match r {
        None => {}
        Some(Ok(mut v)) => {
            for a in &mut v {
                classify_alert(a, eccc);
            }
            alerts.extend(v);
        }
        Some(Err(e)) => errors.push(format!("{label}: {e}")),
    }
}

async fn fetch_alerts(
    net: &Net,
    cache: &ZoneCache,
    lat: f64,
    lon: f64,
    willy_key: Option<String>,
) -> (Vec<Alert>, Vec<String>) {
    let plan = feed_plan(lat, lon, willy_key.is_some());
    let nws = async {
        if !plan.nws {
            return None;
        }
        Some(match net.alerts_for_point(lat, lon).await {
            Ok(mut v) => {
                for a in v
                    .iter_mut()
                    .filter(|a| a.geometry.is_none() && !a.affected_zones.is_empty())
                    .take(ZONE_FILL_LIMIT)
                {
                    a.geometry = net.zone_geometries_cached(cache, &a.affected_zones).await;
                }
                Ok(v)
            }
            Err(e) => Err(e),
        })
    };
    let eccc = async {
        if plan.eccc {
            Some(net.eccc_alerts_for_point(lat, lon).await)
        } else {
            None
        }
    };
    let libre = async {
        if plan.librewxr {
            Some(net.librewxr_alerts_bbox(BBox::around(lat, lon, 1.0)).await)
        } else {
            None
        }
    };
    let willy = async {
        match (&willy_key, plan.bom) {
            (Some(k), true) => Some(net.willy_alerts_for_point(k, lat, lon).await),
            _ => None,
        }
    };
    let spc = async {
        if plan.spc_md {
            Some(net.mesoscale_discussions(BBox::around(lat, lon, 4.0)).await)
        } else {
            None
        }
    };
    let (nws, eccc, libre, willy, spc) = tokio::join!(nws, eccc, libre, willy, spc);

    let mut alerts = Vec::new();
    let mut errors = Vec::new();
    collect("nws", nws, false, &mut alerts, &mut errors);
    collect("eccc", eccc, true, &mut alerts, &mut errors);
    collect("librewxr", libre, false, &mut alerts, &mut errors);
    collect("willyweather", willy, false, &mut alerts, &mut errors);
    collect("spc md", spc, false, &mut alerts, &mut errors);
    (dedupe_and_sort(alerts), errors)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn st(id: &str, lat: f64, lon: f64) -> MetarStation {
        MetarStation {
            id: id.into(),
            name: id.into(),
            lat,
            lon,
        }
    }

    #[test]
    fn stations_filtered_and_sorted_by_center_distance() {
        let bbox = BBox::new(-110.0, 30.0, -100.0, 40.0);
        let stations = [
            st("FAR", 39.0, -101.0),
            st("MID", 35.0, -105.0),
            st("OUT", 50.0, -105.0),
            st("NEAR", 35.5, -104.5),
        ];
        let got = stations_in_bbox(&stations, &bbox, 10);
        let ids: Vec<_> = got.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["MID", "NEAR", "FAR"]);
        let capped = stations_in_bbox(&stations, &bbox, 2);
        assert_eq!(capped.len(), 2);
        assert_eq!(capped[0].id, "MID");
    }
}
