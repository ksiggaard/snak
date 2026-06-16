//! Road routing for the maps renderer plugin (com.snak.maps).
//!
//! Calls the FOSSGIS-hosted Valhalla demo server (free, no API key) to snap a
//! sequence of waypoints to real roads, returning the route geometry as
//! [lng, lat] positions ready to drop into a GeoJSON LineString. Routing runs
//! here (not the webview) to avoid CORS, send a fair-use `User-Agent`, and keep
//! outbound calls in Rust per the project architecture. The frontend falls back
//! to the straight-line waypoints on any error, so a route always renders.

use std::time::Duration;

const VALHALLA_URL: &str = "https://valhalla1.openstreetmap.de/route";
const TIMEOUT: Duration = Duration::from_secs(12);

#[derive(serde::Serialize)]
struct Location {
    lat: f64,
    lon: f64,
}

#[derive(serde::Serialize)]
struct RouteRequest {
    locations: Vec<Location>,
    costing: String,
    directions_type: &'static str,
}

#[derive(serde::Deserialize)]
struct RouteResponse {
    trip: Option<Trip>,
}

#[derive(serde::Deserialize)]
struct Trip {
    legs: Vec<Leg>,
}

#[derive(serde::Deserialize)]
struct Leg {
    shape: String,
}

/// Snap `waypoints` ([lng, lat]) to roads using Valhalla `profile`
/// (auto/pedestrian/bicycle; anything else falls back to auto). Returns the
/// route geometry as [lng, lat] positions. Any error (network, no route, bad
/// input) is returned as `Err` — the caller draws the raw waypoints instead.
#[tauri::command]
pub async fn route_directions(
    waypoints: Vec<[f64; 2]>,
    profile: String,
) -> Result<Vec<[f64; 2]>, String> {
    if waypoints.len() < 2 {
        return Err("need at least two waypoints".into());
    }
    let costing = match profile.as_str() {
        "auto" | "pedestrian" | "bicycle" => profile,
        _ => "auto".to_string(),
    };
    let body = RouteRequest {
        locations: waypoints
            .iter()
            .map(|p| Location {
                lat: p[1],
                lon: p[0],
            })
            .collect(),
        costing,
        directions_type: "none",
    };
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("snak/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(VALHALLA_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("routing server returned {}", resp.status()));
    }
    let parsed: RouteResponse = resp.json().await.map_err(|e| e.to_string())?;
    let trip = parsed.trip.ok_or("no route returned")?;
    let mut coords: Vec<[f64; 2]> = Vec::new();
    for (i, leg) in trip.legs.iter().enumerate() {
        let decoded = decode_polyline6(&leg.shape);
        // The first point of each leg after the first duplicates the previous
        // leg's last point, so skip it.
        let start = if i == 0 { 0 } else { 1 };
        if start < decoded.len() {
            coords.extend_from_slice(&decoded[start..]);
        }
    }
    if coords.len() < 2 {
        return Err("route geometry empty".into());
    }
    Ok(coords)
}

/// Decode a Google-encoded polyline at precision 6 (Valhalla's leg `shape`) into
/// [lng, lat] positions (GeoJSON coordinate order).
fn decode_polyline6(encoded: &str) -> Vec<[f64; 2]> {
    let bytes = encoded.as_bytes();
    let mut coords = Vec::new();
    let mut i = 0usize;
    let mut lat: i64 = 0;
    let mut lng: i64 = 0;
    let read = |i: &mut usize| -> i64 {
        let mut shift = 0;
        let mut result: i64 = 0;
        loop {
            if *i >= bytes.len() {
                break;
            }
            let b = (bytes[*i] as i64) - 63;
            *i += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        if result & 1 != 0 {
            !(result >> 1)
        } else {
            result >> 1
        }
    };
    while i < bytes.len() {
        lat += read(&mut i);
        lng += read(&mut i);
        coords.push([lng as f64 / 1e6, lat as f64 / 1e6]);
    }
    coords
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "{a} != {b}");
    }

    #[test]
    fn decodes_positive_deltas() {
        // "AA" encodes a single (+1,+1) delta at precision 6; "AAAA" → two points.
        let pts = decode_polyline6("AAAA");
        assert_eq!(pts.len(), 2);
        approx(pts[0][0], 0.000001);
        approx(pts[0][1], 0.000001);
        approx(pts[1][0], 0.000002);
        approx(pts[1][1], 0.000002);
    }

    #[test]
    fn decodes_negative_deltas() {
        let pts = decode_polyline6("@@");
        assert_eq!(pts.len(), 1);
        approx(pts[0][0], -0.000001);
        approx(pts[0][1], -0.000001);
    }
}
