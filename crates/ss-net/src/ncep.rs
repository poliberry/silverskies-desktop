//! NCEP GeoServer NEXRAD WMS URLs and raw image fetching.

use crate::{Net, Result};
use ss_core::types::RadarProduct;

/// Nominal NEXRAD range ring radius (124 nm) in meters.
pub const RANGE_RING_M: f64 = 229_664.0;

/// `site` is the lowercase ICAO id, e.g. `kfsx`. `bbox_3857` is `(minx, miny, maxx, maxy)`.
pub fn wms_url(
    site: &str,
    product: RadarProduct,
    bbox_3857: (f64, f64, f64, f64),
    w: u32,
    h: u32,
) -> String {
    let (minx, miny, maxx, maxy) = bbox_3857;
    format!(
        "https://opengeo.ncep.noaa.gov/geoserver/{site}/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS={site}:{site}_{}&STYLES=&CRS=EPSG:3857&BBOX={minx},{miny},{maxx},{maxy}&WIDTH={w}&HEIGHT={h}&FORMAT=image/png&TRANSPARENT=true",
        product.id()
    )
}

pub fn legend_url(site: &str, product: RadarProduct) -> String {
    format!(
        "https://opengeo.ncep.noaa.gov/geoserver/{site}/wms?REQUEST=GetLegendGraphic&VERSION=1.0.0&FORMAT=image/png&LAYER={site}:{site}_{}",
        product.id()
    )
}

impl Net {
    /// Raw bytes of an image (WMS frame, legend, or map tile).
    pub async fn fetch_image_bytes(&self, url: &str) -> Result<Vec<u8>> {
        self.get_bytes(url, Some("image/png")).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wms() {
        let u = wms_url(
            "kfsx",
            RadarProduct::SrBref,
            (-1.0, -2.0, 3.0, 4.0),
            800,
            600,
        );
        assert_eq!(
            u,
            "https://opengeo.ncep.noaa.gov/geoserver/kfsx/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=kfsx:kfsx_sr_bref&STYLES=&CRS=EPSG:3857&BBOX=-1,-2,3,4&WIDTH=800&HEIGHT=600&FORMAT=image/png&TRANSPARENT=true"
        );
    }

    #[test]
    fn legend() {
        assert!(legend_url("kfsx", RadarProduct::Boha).ends_with("LAYER=kfsx:kfsx_boha"));
        assert!(legend_url("kfsx", RadarProduct::Boha).contains("REQUEST=GetLegendGraphic"));
    }
}
