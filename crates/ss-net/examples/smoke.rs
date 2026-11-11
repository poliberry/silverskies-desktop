//! Live smoke test of every feed: `cargo run -p ss-net --example smoke`.
use ss_core::BBox;
use ss_net::Net;

#[tokio::main]
async fn main() {
    let net = Net::new("https://api.librewxr.net").unwrap();
    let (lat, lon) = (32.834, -109.7076); // Safford, AZ
    let (okc_lat, okc_lon) = (35.4676, -97.5164);
    let (tor_lat, tor_lon) = (43.65, -79.38); // Toronto

    macro_rules! check {
        ($name:expr, $fut:expr, $fmt:expr) => {
            match $fut.await {
                Ok(v) => println!("OK   {:<22} {}", $name, $fmt(&v)),
                Err(e) => println!("FAIL {:<22} {e}", $name),
            }
        };
    }

    check!(
        "open-meteo forecast",
        net.forecast(lat, lon),
        |w: &ss_core::Weather| format!(
            "{:.1}C code={} hourly={} daily={} tz={}",
            w.current.temperature_c,
            w.current.weather_code,
            w.hourly.len(),
            w.daily.len(),
            w.timezone
        )
    );
    println!(
        "OK   {:<22} {:?}",
        "geocode",
        net.geocode("Tucson, AZ")
            .await
            .first()
            .map(|l| (&l.label, l.lat, l.lon))
    );
    println!(
        "OK   {:<22} {:?}",
        "reverse",
        net.reverse_geocode(lat, lon).await
    );
    println!(
        "OK   {:<22} {:?}",
        "ip geolocate",
        net.ip_geolocate().await.map(|l| l.label)
    );
    check!(
        "nws alerts (OKC)",
        net.alerts_for_point(okc_lat, okc_lon),
        |a: &Vec<ss_core::Alert>| format!(
            "{} alerts; first={:?} geom={}",
            a.len(),
            a.first().map(|x| &x.event),
            a.first().map(|x| x.geometry.is_some()).unwrap_or(false)
        )
    );
    check!("nws radar stations", net.radar_stations(), |s: &Vec<
        ss_core::RadarStation,
    >| format!(
        "{} stations; {:?}",
        s.len(),
        s.iter()
            .find(|x| x.id == "KFSX")
            .map(|x| (x.vcp, x.last_received_time.clone()))
    ));
    check!(
        "eccc alerts (Toronto)",
        net.eccc_alerts_for_point(tor_lat, tor_lon),
        |a: &Vec<ss_core::Alert>| format!(
            "{} alerts; first={:?}",
            a.len(),
            a.first().map(|x| (&x.event, &x.class))
        )
    );
    check!(
        "librewxr maps",
        net.weather_maps(),
        |m: &ss_core::WeatherMaps| format!(
            "host={} past={} nowcast={} sat={} schemes={}",
            m.host,
            m.radar_past.len(),
            m.radar_nowcast.len(),
            m.satellite_infrared.len(),
            m.color_schemes.len()
        )
    );
    check!(
        "librewxr alerts (EU)",
        net.librewxr_alerts_bbox(BBox::new(5.0, 45.0, 15.0, 55.0)),
        |a: &Vec<ss_core::Alert>| format!(
            "{} alerts; first={:?}",
            a.len(),
            a.first().map(|x| (&x.event, x.severity))
        )
    );
    check!("spc outlook day1", net.outlook_day1(), |f: &Vec<
        ss_core::SpcOutlookFeature,
    >| format!(
        "{} features; {:?}",
        f.len(),
        f.first().map(|x| (&x.code, &x.name, &x.valid))
    ));
    check!(
        "spc mesoscale disc.",
        net.mesoscale_discussions(BBox::new(-125.0, 24.0, -66.0, 50.0)),
        |a: &Vec<ss_core::Alert>| format!(
            "{} MDs; first={:?}",
            a.len(),
            a.first().map(|x| (&x.display_event, x.expires.clone()))
        )
    );
    check!("nwr directory", net.nwr_directory(), |f: &Vec<
        ss_core::NwrFeed,
    >| format!(
        "{} feeds; nearest={:?}",
        f.len(),
        ss_net::nwr::nearest_feeds(f, lat, lon, 1).first().map(|x| (
            &x.callsign,
            &x.city,
            &x.stream_url
        ))
    ));
    match net.metar_stations().await {
        Ok(s) => {
            let near = ss_net::nws::nearest_metar_stations(&s, lat, lon, 1);
            let obs = match near.first() {
                Some(st) => net.latest_observation(&st.id).await,
                None => None,
            };
            println!(
                "OK   {:<22} {} stations; nearest={:?} obs={:?}",
                "metar",
                s.len(),
                near.first().map(|x| &x.id),
                obs
            );
        }
        Err(e) => println!("FAIL {:<22} {e}", "metar"),
    }
    let img = net
        .fetch_image_bytes(&ss_net::ncep::wms_url(
            "kfsx",
            ss_core::RadarProduct::SrBref,
            (-12500000.0, 4000000.0, -12000000.0, 4500000.0),
            256,
            256,
        ))
        .await;
    println!(
        "{}",
        match img {
            Ok(b) => format!("OK   {:<22} {} bytes", "ncep wms", b.len()),
            Err(e) => format!("FAIL ncep wms {e}"),
        }
    );
    let tile = net
        .fetch_image_bytes("https://a.basemaps.cartocdn.com/dark_all/5/6/12.png")
        .await;
    println!(
        "{}",
        match tile {
            Ok(b) => format!("OK   {:<22} {} bytes", "carto tile", b.len()),
            Err(e) => format!("FAIL carto tile {e}"),
        }
    );
}
