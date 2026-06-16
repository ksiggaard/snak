//! Forward geocoding for the maps renderer plugin (com.snak.maps).
//!
//! Resolves a place name / street address to coordinates via the free, no-key
//! Nominatim service (OpenStreetMap), so the model can name real places by
//! address instead of guessing latitude/longitude — guessed coordinates land a
//! marker at a roughly-right but wrong spot ("somewhere in the city"). Runs in
//! Rust to send the `User-Agent` Nominatim's usage policy requires and to avoid
//! CORS. Returns `None` when nothing matches; the frontend serializes calls to
//! respect Nominatim's fair-use rate limit.

use std::time::Duration;

const NOMINATIM_URL: &str = "https://nominatim.openstreetmap.org/search";
const TIMEOUT: Duration = Duration::from_secs(12);

#[derive(serde::Deserialize)]
struct Place {
    lat: String,
    lon: String,
}

/// Geocode `query` to a `[lng, lat]` position (GeoJSON order), or `None` if
/// nothing matches. Any transport/HTTP failure is returned as `Err` so the
/// caller can keep the model's original geometry.
#[tauri::command]
pub async fn geocode(query: String) -> Result<Option<[f64; 2]>, String> {
    if query.trim().is_empty() {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("snak/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(NOMINATIM_URL)
        .query(&[("q", query.as_str()), ("format", "jsonv2"), ("limit", "1")])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("geocoder returned {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    Ok(parse_geocode_response(&body))
}

/// Parse the first result's `[lng, lat]` from a Nominatim search JSON array
/// (Nominatim returns `lat`/`lon` as strings). `None` for empty/invalid input.
fn parse_geocode_response(body: &str) -> Option<[f64; 2]> {
    let places: Vec<Place> = serde_json::from_str(body).ok()?;
    let first = places.into_iter().next()?;
    let lat = first.lat.parse::<f64>().ok()?;
    let lon = first.lon.parse::<f64>().ok()?;
    Some([lon, lat])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_first_result_as_lng_lat() {
        let body = r#"[{"lat":"55.6760968","lon":"12.5683371","display_name":"Copenhagen"}]"#;
        let pt = parse_geocode_response(body).expect("a result");
        assert!((pt[0] - 12.5683371).abs() < 1e-9, "lng");
        assert!((pt[1] - 55.6760968).abs() < 1e-9, "lat");
    }

    #[test]
    fn returns_none_for_empty_or_invalid() {
        assert!(parse_geocode_response("[]").is_none());
        assert!(parse_geocode_response("not json").is_none());
    }
}
