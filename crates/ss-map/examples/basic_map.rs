//! Smoke test: `cargo run -p ss-map --example basic_map`

use egui::Color32;
use ss_core::types::Geometry;
use ss_map::{
    carto_basemap, MapWidget, Marker, MarkerKind, MarkerLayer, PolyItem, PolygonLayer,
    RangeRingLayer, TileCache,
};

const UA: &str = "SilverSkies/2.0 (desktop app; https://github.com/poliberry/silverskies-desktop)";

struct App {
    map: MapWidget,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>, rt: tokio::runtime::Handle) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(UA)
            .build()
            .expect("http client");
        let disk = std::env::temp_dir().join("ss-map-example-tiles");
        let cache = TileCache::new(client, rt, Some(disk), cc.egui_ctx.clone());
        let mut map = MapWidget::new(cache);
        map.show_stats = true;
        map.viewport.set_center(-111.9, 34.0);
        map.viewport.zoom = 6.0;

        map.layers.push(carto_basemap(true));

        let ring = vec![
            [-113.5, 33.0],
            [-110.5, 33.0],
            [-110.5, 35.5],
            [-113.5, 35.5],
            [-113.5, 33.0],
        ];
        let hole = vec![
            [-112.5, 33.8],
            [-111.5, 33.8],
            [-111.5, 34.6],
            [-112.5, 34.6],
            [-112.5, 33.8],
        ];
        let mut polys = PolygonLayer::new("alerts");
        polys.set_items(vec![PolyItem {
            id: "test".into(),
            geometry: Geometry::Polygon(vec![ring, hole]),
            fill: Color32::from_rgba_unmultiplied(255, 80, 60, 50),
            stroke: Color32::from_rgb(255, 80, 60),
            stroke_width: 2.0,
            pulse: true,
            label: Some("TEST".into()),
        }]);
        map.layers.push(polys);

        let mut markers = MarkerLayer::new("markers");
        markers.markers.push(Marker {
            id: "phx".into(),
            lon: -112.074,
            lat: 33.448,
            kind: MarkerKind::Pin,
            color: Color32::from_rgb(90, 170, 255),
            label: Some("Phoenix".into()),
        });
        markers.markers.push(Marker {
            id: "kiwa".into(),
            lon: -111.67,
            lat: 33.29,
            kind: MarkerKind::RadarSite { live: true },
            color: Color32::from_rgb(120, 255, 140),
            label: Some("KIWA".into()),
        });
        map.layers.push(markers);

        map.layers.push(RangeRingLayer::new(
            "range",
            -111.67,
            33.29,
            230_000.0,
            Color32::from_rgb(120, 255, 140),
        ));
        Self { map }
    }
}

impl eframe::App for App {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE)
            .show(ui, |ui| {
                let r = self.map.show(ui);
                if let Some((lon, lat)) = r.clicked {
                    println!("clicked {lat:.4}, {lon:.4}");
                }
                if r.selection_changed {
                    println!("selection {:?}", self.map.selected_bbox);
                }
            });
    }
}

fn main() -> eframe::Result {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    let handle = rt.handle().clone();
    // `rt` stays alive for the whole of main (the event loop blocks here).
    eframe::run_native(
        "ss-map basic_map",
        eframe::NativeOptions::default(),
        Box::new(move |cc| Ok(Box::new(App::new(cc, handle)))),
    )
}
