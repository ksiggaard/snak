//! Built-in, in-process **device & location** server (`device__*`).
//!
//! Three keyless tools that answer "where / when am I" from the machine itself:
//! - `get_datetime` — local date, year, time of day, and the system timezone
//!   (IANA name + UTC offset).
//! - `get_ip_addresses` — the machine's primary LAN IP and its public IP.
//! - `get_geolocation` — approximate (IP-based) coordinates, or, when an OS
//!   location helper is installed, precise ones.
//!
//! The fully-local tools (`get_datetime`, the LAN IP) work offline; the public-IP
//! and geolocation lookups make an outbound HTTP request and return an error
//! string (surfaced to the model as a failed tool result) when offline.
//!
//! ## Privacy
//! These tools read the machine's address/location and hand it to the chat model
//! — i.e. potentially to a cloud provider. They are only ever called when the
//! model decides the request needs them, and the server can be toggled off in the
//! MCP settings. No execution happens here: the precise-location path *reads* from
//! an optional OS helper command (no shell), nothing more.

use std::net::UdpSocket;
use std::time::Duration;

use anyhow::{anyhow, Context};
use serde_json::{json, Value};

use super::ToolDef;

/// The id used to namespace this server's tools (`device__get_datetime`, …).
pub const SERVER_ID: &str = "device";

/// Wall-clock cap on any outbound lookup (public IP / geolocation / OS helper).
const LOOKUP_TIMEOUT: Duration = Duration::from_secs(10);

/// The tools this built-in server advertises.
pub fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "get_datetime".to_string(),
            description: "Get the current local date, year, time of day, weekday, and the system \
                timezone (IANA name + UTC offset). Use this whenever you need the current date or \
                time — never guess it."
                .to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "get_ip_addresses".to_string(),
            description: "Get the computer's network addresses: its internal/LAN IP (the primary \
                outbound interface) and its external/public IP as seen from the internet. The \
                public IP requires an internet connection."
                .to_string(),
            input_schema: json!({ "type": "object", "properties": {} }),
        },
        ToolDef {
            name: "get_geolocation".to_string(),
            description: "Estimate the computer's geographic location (latitude/longitude, city, \
                region, country). `accuracy: \"coarse\"` (default) uses an IP-based lookup \
                (city-level, no permission needed). `accuracy: \"precise\"` additionally tries the \
                OS location service for GPS-level coordinates, falling back to the coarse result \
                when no location helper is available. Requires an internet connection."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "accuracy": {
                        "type": "string",
                        "enum": ["coarse", "precise"],
                        "description": "Location precision. Defaults to \"coarse\"."
                    }
                }
            }),
        },
    ]
}

/// Execute one `device__*` tool. Errors return `Err`; the chat loop surfaces them
/// to the model as a failed `tool_result` (a bad call never aborts the turn).
pub async fn call_tool(
    client: &reqwest::Client,
    tool: &str,
    args: &Value,
) -> anyhow::Result<String> {
    match tool {
        "get_datetime" => Ok(datetime_report()),
        "get_ip_addresses" => ip_report(client).await,
        "get_geolocation" => {
            let precise = args.get("accuracy").and_then(|v| v.as_str()) == Some("precise");
            geolocation_report(client, precise).await
        }
        other => Err(anyhow!("unknown device tool: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Date / time
// ---------------------------------------------------------------------------

fn datetime_report() -> String {
    use chrono::Local;
    let now = Local::now();
    // `iana_time_zone` gives the IANA name (e.g. "Europe/Copenhagen"); chrono's
    // `%:z` gives the clean UTC offset (e.g. "+02:00").
    let tz_name = iana_time_zone::get_timezone().unwrap_or_else(|_| "unknown".to_string());
    format!(
        "Date: {date}\n\
         Year: {year}\n\
         Time: {time}\n\
         Weekday: {weekday}\n\
         Timezone: {tz} (UTC{offset})\n\
         ISO 8601: {iso}",
        date = now.format("%Y-%m-%d"),
        year = now.format("%Y"),
        time = now.format("%H:%M:%S"),
        weekday = now.format("%A"),
        tz = tz_name,
        offset = now.format("%:z"),
        iso = now.to_rfc3339(),
    )
}

// ---------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------

async fn ip_report(client: &reqwest::Client) -> anyhow::Result<String> {
    let internal = local_ip().unwrap_or_else(|| "unavailable".to_string());
    let external = match public_ip(client).await {
        Ok(ip) => ip,
        Err(e) => format!("unavailable ({e})"),
    };
    Ok(format!(
        "Internal (LAN) IP: {internal}\nExternal (public) IP: {external}"
    ))
}

/// Discover the primary outbound LAN IP without enumerating interfaces: open a UDP
/// socket "connected" to a public address (no packets are sent — `connect` on a
/// datagram socket just fixes the route) and read back the local address the OS
/// picked for that route.
// ponytail: UDP-connect trick gives the single primary-interface IP with zero
// deps. Upgrade to interface enumeration (e.g. an `if-addrs` crate) only if
// reporting every NIC is ever needed.
fn local_ip() -> Option<String> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    Some(socket.local_addr().ok()?.ip().to_string())
}

async fn public_ip(client: &reqwest::Client) -> anyhow::Result<String> {
    let v: Value = client
        .get("https://api.ipify.org?format=json")
        .timeout(LOOKUP_TIMEOUT)
        .send()
        .await
        .context("requesting public IP")?
        .json()
        .await
        .context("parsing public IP response")?;
    v.get("ip")
        .and_then(|s| s.as_str())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("public IP service returned no `ip` field"))
}

// ---------------------------------------------------------------------------
// Geolocation
// ---------------------------------------------------------------------------

async fn geolocation_report(client: &reqwest::Client, precise: bool) -> anyhow::Result<String> {
    if precise {
        if let Some((lat, lon)) = os_precise_location().await {
            return Ok(format!(
                "Source: OS location service (precise)\nLatitude: {lat}\nLongitude: {lon}"
            ));
        }
    }
    let mut report = ip_geolocation(client).await?;
    if precise {
        report.push_str(
            "\n\nNote: precise OS geolocation was unavailable (no location-services helper \
             installed), so this is the approximate IP-based location.",
        );
    }
    Ok(report)
}

async fn ip_geolocation(client: &reqwest::Client) -> anyhow::Result<String> {
    // ipwho.is: keyless, HTTPS, returns lat/lon + city/region/country + timezone.
    let v: Value = client
        .get("https://ipwho.is/")
        .timeout(LOOKUP_TIMEOUT)
        .send()
        .await
        .context("requesting IP geolocation")?
        .json()
        .await
        .context("parsing IP geolocation response")?;
    if v.get("success").and_then(Value::as_bool) == Some(false) {
        let msg = v
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("lookup failed");
        return Err(anyhow!("IP geolocation failed: {msg}"));
    }
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("?").to_string();
    let n = |k: &str| {
        v.get(k)
            .filter(|x| !x.is_null())
            .map(ToString::to_string)
            .unwrap_or_else(|| "?".to_string())
    };
    let tz = v
        .get("timezone")
        .and_then(|t| t.get("id"))
        .and_then(Value::as_str)
        .unwrap_or("?");
    Ok(format!(
        "Source: IP-based lookup (approximate, ~city-level)\n\
         Latitude: {lat}\nLongitude: {lon}\nCity: {city}\nRegion: {region}\n\
         Country: {country}\nPostal: {postal}\nTimezone: {tz}",
        lat = n("latitude"),
        lon = n("longitude"),
        city = s("city"),
        region = s("region"),
        country = s("country"),
        postal = s("postal"),
    ))
}

/// Best-effort precise location via an OS location helper, if one is installed.
/// macOS: `CoreLocationCLI`; Linux: geoclue's `where-am-i` demo. Returns `None`
/// when no helper is present (the common case) so the caller falls back to the IP
/// lookup.
// ponytail: shells out to an *optional* helper rather than binding CoreLocation /
// GeoClue D-Bus directly — those need an entitlement + delegate run-loop (macOS)
// or a D-Bus client (Linux), which is a lot of code for a degrade-gracefully path.
// Upgrade path: native CLLocationManager / org.freedesktop.GeoClue2 for a
// permission-prompted GPS fix with no external CLI dependency.
#[allow(unused_variables)]
async fn os_precise_location() -> Option<(f64, f64)> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use tokio::process::Command;
        use tokio::time::timeout;

        #[cfg(target_os = "macos")]
        let mut cmd = {
            let mut c = Command::new("CoreLocationCLI");
            c.args(["-once", "yes", "-format", "%latitude %longitude"]);
            c
        };
        #[cfg(target_os = "linux")]
        let mut cmd = Command::new("where-am-i");

        let out = timeout(Duration::from_secs(20), cmd.output())
            .await
            .ok()?
            .ok()?;
        if !out.status.success() {
            return None;
        }
        parse_lat_lon(&String::from_utf8_lossy(&out.stdout))
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        None
    }
}

/// Parse a `(lat, lon)` pair from a location helper's stdout. Handles both the
/// plain `"55.6761 12.5683"` form (CoreLocationCLI) and labeled
/// `"Latitude: 55.6761°"` lines (geoclue). Pure / unit-tested.
fn parse_lat_lon(text: &str) -> Option<(f64, f64)> {
    let parse_num = |s: &str| s.trim().trim_end_matches('°').parse::<f64>().ok();

    // Labeled form (geoclue).
    let mut lat = None;
    let mut lon = None;
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if let Some((_, val)) = line.split_once(':') {
            if lower.contains("latitude") {
                lat = parse_num(val);
            } else if lower.contains("longitude") {
                lon = parse_num(val);
            }
        }
    }
    if let (Some(a), Some(b)) = (lat, lon) {
        return Some((a, b));
    }

    // Plain "lat lon" form.
    let nums: Vec<f64> = text.split_whitespace().filter_map(parse_num).collect();
    if nums.len() >= 2 {
        Some((nums[0], nums[1]))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_expected_tools() {
        let names: Vec<_> = tools().into_iter().map(|t| t.name).collect();
        for want in ["get_datetime", "get_ip_addresses", "get_geolocation"] {
            assert!(names.contains(&want.to_string()), "missing {want}");
        }
    }

    #[test]
    fn datetime_report_has_all_fields() {
        let r = datetime_report();
        for field in [
            "Date:",
            "Year:",
            "Time:",
            "Weekday:",
            "Timezone:",
            "ISO 8601:",
        ] {
            assert!(r.contains(field), "missing {field} in:\n{r}");
        }
    }

    #[test]
    fn local_ip_is_a_routable_v4_or_none() {
        // In a sandbox without a route this may be None; when present it must parse.
        if let Some(ip) = local_ip() {
            assert!(ip.parse::<std::net::IpAddr>().is_ok(), "not an IP: {ip}");
        }
    }

    #[test]
    fn parses_plain_lat_lon() {
        assert_eq!(parse_lat_lon("55.6761 12.5683\n"), Some((55.6761, 12.5683)));
    }

    #[test]
    fn parses_labeled_lat_lon() {
        let out = "Latitude: 55.676100°\nLongitude: 12.568300°\nAccuracy: 25.0 meters\n";
        assert_eq!(parse_lat_lon(out), Some((55.6761, 12.5683)));
    }

    #[test]
    fn rejects_garbage() {
        assert_eq!(parse_lat_lon("no coordinates here"), None);
        // A single number isn't enough for a pair.
        assert_eq!(parse_lat_lon("only-one 42.0"), None);
    }
}
