use ss_core::same::SameHeader;
use ss_core::{
    AirQuality, Alert, BBox, Location, NwrFeed, RadarStation, SpcOutlookFeature, Weather,
    WeatherMaps,
};

use crate::state::{LogLevel, RadioStatus, WindObs};

/// Results posted by background tasks and applied on the UI thread.
pub enum AppEvent {
    WeatherLoaded {
        location_id: String,
        result: Result<Weather, String>,
    },
    AlertsLoaded {
        location_id: String,
        alerts: Vec<Alert>,
        errors: Vec<String>,
    },
    RadarStations(Result<Vec<RadarStation>, String>),
    WeatherMaps(Result<WeatherMaps, String>),
    Geocoded {
        query: String,
        results: Vec<Location>,
    },
    ReverseGeocoded {
        location_id: String,
        label: String,
    },
    IpLocated(Option<Location>),
    AreaAlertsLoaded(Vec<Alert>),
    /// Alerts for the current map viewport (auto-refreshed).
    ViewportAlertsLoaded {
        bbox: BBox,
        alerts: Vec<Alert>,
    },
    Log(LogLevel, String),
    /// Nearest NWR streams for a location (empty when none could be resolved).
    RadioCandidates {
        location_id: String,
        feeds: Vec<NwrFeed>,
    },
    RadioStatus(RadioStatus),
    SameHeader(SameHeader),
    SameEom,
    SpcOutlook(Result<Vec<SpcOutlookFeature>, String>),
    McdAlerts(Result<Vec<Alert>, String>),
    WindObs {
        #[allow(dead_code)] // identifies the requested viewport
        bbox: BBox,
        obs: Vec<WindObs>,
    },
    AirQuality {
        location_id: String,
        result: Result<AirQuality, String>,
    },
}
