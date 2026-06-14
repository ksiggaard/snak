//! Built-in, in-process YouTube MCP-style server. Two keyless tools the model
//! can call:
//!
//! - `search_youtube` — scrape YouTube search results and return a ranked list
//!   (title, channel, views, duration, watch URL, snippet) so the model can
//!   recommend a video as part of research. Each result's thumbnail is downloaded
//!   and streamed to the UI inline (out-of-band via [`ImageSink`], reusing the
//!   `image_search` download path) so base64 never enters the model context.
//! - `youtube_transcript` — given a YouTube URL or video id, fetch the
//!   closed-caption track and return it as timestamped lines (`[mm:ss] text`), so
//!   the model can summarize a video and answer "what's at 12:30?" questions.
//!
//! No API key: the search path scrapes the results page's `ytInitialData`; the
//! transcript path asks the public InnerTube `/youtubei/v1/player` endpoint for
//! the caption tracks (falling back to scraping `ytInitialPlayerResponse` from the
//! watch page), then fetches the track's `baseUrl` timedtext XML. Like the other
//! scrapers this is best-effort: every parse failure degrades to a clear "no
//! results" / "no captions" string (the chat loop feeds tool errors back as text,
//! so a bad call never aborts the turn).

use anyhow::{anyhow, Context};
use serde_json::{json, Value};

use super::image_search::download_image;
use super::ImageSink;
use crate::providers::{ToolDef, ToolImage};

/// The id used to namespace this server's tools (`youtube__search_youtube`).
pub const SERVER_ID: &str = "youtube";

/// Default / max number of search results.
const DEFAULT_COUNT: usize = 5;
const MAX_COUNT: usize = 10;
/// Max chars kept per title/snippet so a result list stays token-friendly.
const FIELD_MAX: usize = 300;
/// Max chars of transcript handed to the model, so a long video can't blow the
/// context window. Generous but bounded (matches `web_browse`'s page cap).
const MAX_TRANSCRIPT_LEN: usize = 20_000;

/// A desktop browser UA + consent cookie avoids YouTube's EU consent interstitial
/// when scraping HTML pages.
const DESKTOP_UA: &str =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) \
     Chrome/124.0 Safari/537.36";
/// Public InnerTube API key (embedded in every youtube.com page; not a secret).
const INNERTUBE_KEY: &str = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

/// The tools this built-in server advertises.
pub fn tools() -> Vec<ToolDef> {
    vec![
        ToolDef {
            name: "search_youtube".to_string(),
            description: "Search YouTube for videos matching a query and return a \
                          ranked list (title, channel, view count, duration, watch \
                          URL, and a short description). Each result's thumbnail is \
                          shown to the user inline. Use this to find or RECOMMEND a \
                          video about a topic; cite the watch URL of the one you \
                          recommend."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "What to search YouTube for." },
                    "count": {
                        "type": "integer",
                        "description": "How many results to return (default 5, max 10)."
                    }
                },
                "required": ["query"]
            }),
        },
        ToolDef {
            name: "youtube_transcript".to_string(),
            description: "Fetch the closed-caption transcript of a YouTube video, \
                          returned as timestamped lines like `[mm:ss] text`. Pass the \
                          video URL (or id) the user gave you. Use this to SUMMARIZE a \
                          video or answer questions about what is said at a given time; \
                          cite the `[mm:ss]` timestamps in your answer."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "A YouTube video URL (watch?v=…, youtu.be/…, \
                                        /shorts/…) or a bare 11-character video id."
                    },
                    "lang": {
                        "type": "string",
                        "description": "Optional preferred caption language code \
                                        (e.g. \"en\", \"de\"). Defaults to English, \
                                        then the first available track."
                    }
                },
                "required": ["url"]
            }),
        },
    ]
}

/// Execute one tool call against the built-in YouTube server. `emit_images`
/// streams search-result thumbnails to the UI.
pub async fn call_tool(
    client: &reqwest::Client,
    tool: &str,
    args: &Value,
    emit_images: ImageSink<'_>,
) -> anyhow::Result<String> {
    match tool {
        "search_youtube" => search(client, args, emit_images).await,
        "youtube_transcript" => transcript(client, args).await,
        other => Err(anyhow!("unknown built-in tool: {other}")),
    }
}

// ---------------------------------------------------------------------------
// search_youtube
// ---------------------------------------------------------------------------

/// One search hit parsed from `ytInitialData`.
#[derive(Debug, Clone, PartialEq)]
pub struct VideoHit {
    pub video_id: String,
    pub title: String,
    pub channel: String,
    pub length: String,
    pub views: String,
    pub snippet: String,
}

impl VideoHit {
    fn watch_url(&self) -> String {
        format!("https://www.youtube.com/watch?v={}", self.video_id)
    }
    fn thumbnail_url(&self) -> String {
        format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", self.video_id)
    }
}

async fn search(
    client: &reqwest::Client,
    args: &Value,
    emit_images: ImageSink<'_>,
) -> anyhow::Result<String> {
    let query = args
        .get("query")
        .and_then(|q| q.as_str())
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or_else(|| anyhow!("search_youtube requires a non-empty string `query`"))?;
    let count = args
        .get("count")
        .and_then(|c| c.as_u64())
        .map(|c| (c as usize).clamp(1, MAX_COUNT))
        .unwrap_or(DEFAULT_COUNT);

    let resp = client
        .get("https://www.youtube.com/results")
        .query(&[("search_query", query)])
        .header("user-agent", DESKTOP_UA)
        .header("cookie", "CONSENT=YES+1")
        .header("accept-language", "en-US,en;q=0.9")
        .send()
        .await
        .context("YouTube search request failed")?;
    let status = resp.status();
    if !status.is_success() {
        return Err(anyhow!("YouTube search error {status}"));
    }
    let body = resp.text().await.context("reading YouTube search page")?;

    let data = extract_json_after(&body, "ytInitialData")
        .ok_or_else(|| anyhow!("could not parse YouTube search results"))?;
    let hits = parse_search_results(&data, count);

    // Download thumbnails and stream them inline (best-effort; skip failures).
    let mut images = Vec::new();
    for h in &hits {
        if let Some((media_type, data)) = download_image(client, &h.thumbnail_url()).await {
            images.push(ToolImage {
                media_type,
                data,
                source_url: Some(h.watch_url()),
                title: Some(h.title.clone()).filter(|t| !t.is_empty()),
            });
        }
    }
    emit_images(images);

    Ok(format_results(query, &hits))
}

/// Walk `ytInitialData` collecting `videoRenderer` entries (the search-result
/// shape) into `VideoHit`s, capped at `count`. Recursive so it is robust to
/// YouTube reshuffling the wrapper layout. Pure / unit-tested.
pub fn parse_search_results(data: &Value, count: usize) -> Vec<VideoHit> {
    let mut renderers = Vec::new();
    collect_renderers(data, "videoRenderer", &mut renderers);
    let mut out = Vec::new();
    for vr in renderers {
        if out.len() >= count {
            break;
        }
        let Some(video_id) = vr.get("videoId").and_then(|v| v.as_str()) else {
            continue;
        };
        if video_id.is_empty() {
            continue;
        }
        out.push(VideoHit {
            video_id: video_id.to_string(),
            title: clip(&runs_text(vr.get("title")), FIELD_MAX),
            channel: runs_text(
                vr.get("ownerText").or_else(|| vr.get("longBylineText")),
            ),
            length: text_field(vr.get("lengthText")),
            views: text_field(vr.get("viewCountText")),
            snippet: clip(&snippet_text(vr), FIELD_MAX),
        });
    }
    out
}

/// Render results as a compact, numbered, token-friendly list.
pub fn format_results(query: &str, hits: &[VideoHit]) -> String {
    if hits.is_empty() {
        return format!("No YouTube videos found for \"{query}\".");
    }
    let mut out = format!(
        "YouTube results for \"{query}\" (thumbnails shown to the user inline):\n"
    );
    for (i, h) in hits.iter().enumerate() {
        out.push_str(&format!("\n{}. {}\n", i + 1, h.title));
        let mut meta = Vec::new();
        if !h.channel.is_empty() {
            meta.push(h.channel.clone());
        }
        if !h.views.is_empty() {
            meta.push(h.views.clone());
        }
        if !h.length.is_empty() {
            meta.push(h.length.clone());
        }
        if !meta.is_empty() {
            out.push_str(&format!("   {}\n", meta.join(" · ")));
        }
        out.push_str(&format!("   {}\n", h.watch_url()));
        if !h.snippet.is_empty() {
            out.push_str(&format!("   {}\n", h.snippet));
        }
    }
    out.push_str(
        "\nUse youtube_transcript on a video's URL to read its captions before summarizing.",
    );
    out
}

// ---------------------------------------------------------------------------
// youtube_transcript
// ---------------------------------------------------------------------------

async fn transcript(client: &reqwest::Client, args: &Value) -> anyhow::Result<String> {
    let raw = args
        .get("url")
        .and_then(|u| u.as_str())
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .ok_or_else(|| anyhow!("youtube_transcript requires a string `url` argument"))?;
    let lang = args.get("lang").and_then(|l| l.as_str()).map(str::trim);
    let video_id = parse_video_id(raw)
        .ok_or_else(|| anyhow!("could not find a YouTube video id in `{raw}`"))?;

    // Prefer InnerTube (no consent wall); fall back to scraping the watch page.
    let player = match fetch_player_response(client, &video_id).await {
        Some(p) if has_caption_tracks(&p) => p,
        _ => fetch_watch_player_response(client, &video_id)
            .await
            .ok_or_else(|| anyhow!("could not load video data for {video_id}"))?,
    };

    let tracks = caption_tracks(&player);
    let track = select_track(&tracks, lang).ok_or_else(|| {
        anyhow!("this video has no closed captions available to extract")
    })?;
    // Strip `&fmt=srv3` so the endpoint returns the default `<text start dur>` XML
    // that `parse_timedtext` understands; `&amp;` decode covers the watch-page
    // fallback (its baseUrl is HTML-escaped).
    let base_url = track
        .get("baseUrl")
        .and_then(|u| u.as_str())
        .ok_or_else(|| anyhow!("caption track has no URL"))?
        .replace("&amp;", "&")
        .replace("&fmt=srv3", "");

    let xml = client
        .get(&base_url)
        .header("user-agent", DESKTOP_UA)
        .send()
        .await
        .context("caption track request failed")?
        .text()
        .await
        .context("reading caption track")?;

    let entries = parse_timedtext(&xml);
    if entries.is_empty() {
        return Err(anyhow!(
            "the caption track for {video_id} was empty or could not be parsed"
        ));
    }

    let title = player
        .pointer("/videoDetails/title")
        .and_then(|t| t.as_str())
        .unwrap_or("");
    Ok(format_transcript(title, &video_id, &entries))
}

/// Build the InnerTube player request and return its parsed JSON, or `None`.
async fn fetch_player_response(client: &reqwest::Client, video_id: &str) -> Option<Value> {
    let url = format!("https://www.youtube.com/youtubei/v1/player?key={INNERTUBE_KEY}");
    // The ANDROID client returns caption `baseUrl`s that work without a
    // proof-of-origin (`pot`) token — the WEB client's no longer do (it returns
    // UNPLAYABLE / empty timedtext). Keep the context *minimal*: adding
    // `androidSdkVersion` or a custom UA trips a `FAILED_PRECONDITION` 400.
    let body = json!({
        "context": {
            "client": {
                "clientName": "ANDROID",
                "clientVersion": "20.10.38"
            }
        },
        "videoId": video_id
    });
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .header("accept-language", "en-US")
        .header("user-agent", DESKTOP_UA)
        .json(&body)
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Value>().await.ok()
}

/// Fallback: scrape `ytInitialPlayerResponse` from the watch page.
async fn fetch_watch_player_response(
    client: &reqwest::Client,
    video_id: &str,
) -> Option<Value> {
    let resp = client
        .get(format!("https://www.youtube.com/watch?v={video_id}"))
        .header("user-agent", DESKTOP_UA)
        .header("cookie", "CONSENT=YES+1")
        .header("accept-language", "en-US,en;q=0.9")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.text().await.ok()?;
    extract_json_after(&body, "ytInitialPlayerResponse")
}

fn caption_tracks(player: &Value) -> Vec<Value> {
    player
        .pointer("/captions/playerCaptionsTracklistRenderer/captionTracks")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default()
}

fn has_caption_tracks(player: &Value) -> bool {
    !caption_tracks(player).is_empty()
}

/// Choose a caption track: honor `lang` if it matches, else prefer a manual
/// (non-`asr`) English track, then any English, then the first track. Pure /
/// unit-tested.
pub fn select_track<'a>(tracks: &'a [Value], lang: Option<&str>) -> Option<&'a Value> {
    if tracks.is_empty() {
        return None;
    }
    let code = |t: &Value| str_field(t, "languageCode").to_string();
    let kind = |t: &Value| str_field(t, "kind").to_string();
    if let Some(lang) = lang.filter(|l| !l.is_empty()) {
        if let Some(t) = tracks.iter().find(|t| code(t).starts_with(lang)) {
            return Some(t);
        }
    }
    tracks
        .iter()
        .find(|t| code(t).starts_with("en") && kind(t) != "asr")
        .or_else(|| tracks.iter().find(|t| code(t).starts_with("en")))
        .or_else(|| tracks.first())
}

/// Parse a timedtext XML body (`<text start="1.2" dur="3.4">…</text>`) into
/// `(start_secs, text)` pairs, entity-decoded and non-empty. Pure / unit-tested.
pub fn parse_timedtext(xml: &str) -> Vec<(f64, String)> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(rel) = xml[from..].find("<text") {
        let tag_start = from + rel;
        let Some(gt) = xml[tag_start..].find('>') else {
            break;
        };
        let attrs_end = tag_start + gt;
        let attrs = &xml[tag_start..attrs_end];
        let start = attr_value(attrs, "start")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let inner_start = attrs_end + 1;
        let Some(crel) = xml[inner_start..].find("</text>") else {
            break;
        };
        let inner_end = inner_start + crel;
        // Caption text is often double-escaped (`&amp;#39;`), so decode twice.
        let text = decode_entities(&decode_entities(&xml[inner_start..inner_end]))
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        from = inner_end + "</text>".len();
        if !text.is_empty() {
            out.push((start, text));
        }
    }
    out
}

/// Render the timestamped transcript, capped to `MAX_TRANSCRIPT_LEN`.
pub fn format_transcript(title: &str, video_id: &str, entries: &[(f64, String)]) -> String {
    let mut out = if title.is_empty() {
        format!("Transcript for video {video_id}:\n\n")
    } else {
        format!("Transcript for \"{title}\" ({video_id}):\n\n")
    };
    let mut truncated = false;
    for (start, text) in entries {
        let line = format!("{} {}\n", fmt_timestamp(*start), text);
        if out.len() + line.len() > MAX_TRANSCRIPT_LEN {
            truncated = true;
            break;
        }
        out.push_str(&line);
    }
    if truncated {
        out.push_str("\n[transcript truncated — too long to include in full]");
    }
    out
}

/// Format seconds as `[mm:ss]` (or `[h:mm:ss]` past an hour).
fn fmt_timestamp(secs: f64) -> String {
    let total = secs.max(0.0) as u64;
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    if h > 0 {
        format!("[{h}:{m:02}:{s:02}]")
    } else {
        format!("[{m:02}:{s:02}]")
    }
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/// Extract a YouTube video id from a URL or a bare id. Handles `watch?v=`,
/// `youtu.be/<id>`, `/shorts/<id>`, `/embed/<id>`, and a raw 11-char id. Pure /
/// unit-tested.
pub fn parse_video_id(input: &str) -> Option<String> {
    let input = input.trim();
    let is_id = |s: &str| s.len() == 11 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

    if is_id(input) {
        return Some(input.to_string());
    }
    // `v=` query parameter (watch URLs).
    if let Some(idx) = input.find("v=") {
        let rest = &input[idx + 2..];
        let id: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if is_id(&id) {
            return Some(id);
        }
    }
    // Path-style ids: youtu.be/<id>, /shorts/<id>, /embed/<id>.
    for marker in ["youtu.be/", "/shorts/", "/embed/"] {
        if let Some(idx) = input.find(marker) {
            let rest = &input[idx + marker.len()..];
            let id: String = rest
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if is_id(&id) {
                return Some(id);
            }
        }
    }
    None
}

/// Find `marker` in `html`, then parse the next balanced `{…}` JSON object after
/// it (quote/escape-aware). Used for `ytInitialData` / `ytInitialPlayerResponse`.
/// Pure / unit-tested.
pub fn extract_json_after(html: &str, marker: &str) -> Option<Value> {
    let start = html.find(marker)?;
    let after = &html[start + marker.len()..];
    let brace = after.find('{')?;
    let bytes = after.as_bytes();
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escape = false;
    let mut end = None;
    for (i, &b) in bytes.iter().enumerate().skip(brace) {
        if in_str {
            match b {
                _ if escape => escape = false,
                b'\\' => escape = true,
                b'"' => in_str = false,
                _ => {}
            }
        } else {
            match b {
                b'"' => in_str = true,
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        end = Some(i + 1);
                        break;
                    }
                }
                _ => {}
            }
        }
    }
    serde_json::from_str(&after[brace..end?]).ok()
}

/// Recursively collect the values under `key` (e.g. `videoRenderer`) anywhere in
/// `v`.
fn collect_renderers<'a>(v: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match v {
        Value::Object(map) => {
            if let Some(found) = map.get(key) {
                out.push(found);
            }
            for val in map.values() {
                collect_renderers(val, key, out);
            }
        }
        Value::Array(arr) => {
            for val in arr {
                collect_renderers(val, key, out);
            }
        }
        _ => {}
    }
}

/// Join a `{ runs: [{ text }] }` node into a single string (or read `simpleText`).
fn runs_text(node: Option<&Value>) -> String {
    let Some(node) = node else {
        return String::new();
    };
    if let Some(s) = node.get("simpleText").and_then(|s| s.as_str()) {
        return s.to_string();
    }
    if let Some(runs) = node.get("runs").and_then(|r| r.as_array()) {
        return runs
            .iter()
            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
            .collect::<String>();
    }
    String::new()
}

/// Read `simpleText` or join `runs` from a `{simpleText}|{runs}` text node.
fn text_field(node: Option<&Value>) -> String {
    runs_text(node)
}

/// Join the `detailedMetadataSnippets[0].snippetText.runs` description.
fn snippet_text(vr: &Value) -> String {
    vr.pointer("/detailedMetadataSnippets/0/snippetText")
        .map(|n| runs_text(Some(n)))
        .unwrap_or_default()
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// Extract `name="value"` from an attribute string (double-quoted only).
fn attr_value(attrs: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let start = attrs.find(&needle)? + needle.len();
    let end = attrs[start..].find('"')? + start;
    Some(attrs[start..end].to_string())
}

fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}

fn clip(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_defs_have_expected_names() {
        let t = tools();
        assert_eq!(t.len(), 2);
        assert!(t.iter().any(|d| d.name == "search_youtube"));
        assert!(t.iter().any(|d| d.name == "youtube_transcript"));
    }

    #[test]
    fn parses_video_ids() {
        assert_eq!(
            parse_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            parse_video_id("https://youtu.be/dQw4w9WgXcQ?t=42").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            parse_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(
            parse_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ").as_deref(),
            Some("dQw4w9WgXcQ")
        );
        assert_eq!(parse_video_id("dQw4w9WgXcQ").as_deref(), Some("dQw4w9WgXcQ"));
        assert_eq!(parse_video_id("not a video"), None);
        assert_eq!(parse_video_id("https://example.com/page"), None);
    }

    #[test]
    fn extracts_balanced_json_object() {
        let html = r#"<script>var ytInitialData = {"a":1,"b":{"c":"}}not end"}};</script>"#;
        let v = extract_json_after(html, "ytInitialData").unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"]["c"], "}}not end");
    }

    #[test]
    fn extract_json_returns_none_without_marker() {
        assert!(extract_json_after("no json here", "ytInitialData").is_none());
    }

    #[test]
    fn parses_search_results_from_nested_renderers() {
        let data = json!({
            "contents": { "wrap": { "contents": [
                { "videoRenderer": {
                    "videoId": "abc12345678",
                    "title": { "runs": [{ "text": "Rust " }, { "text": "Ownership" }] },
                    "ownerText": { "runs": [{ "text": "Some Channel" }] },
                    "lengthText": { "simpleText": "12:34" },
                    "viewCountText": { "simpleText": "1.2M views" },
                    "detailedMetadataSnippets": [
                        { "snippetText": { "runs": [{ "text": "A great " }, { "text": "intro." }] } }
                    ]
                }},
                { "videoRenderer": { "videoId": "" } },
                { "videoRenderer": {
                    "videoId": "def98765432",
                    "title": { "simpleText": "Second" }
                }}
            ]}}
        });
        let hits = parse_search_results(&data, 10);
        assert_eq!(hits.len(), 2); // empty id skipped
        assert_eq!(hits[0].video_id, "abc12345678");
        assert_eq!(hits[0].title, "Rust Ownership");
        assert_eq!(hits[0].channel, "Some Channel");
        assert_eq!(hits[0].length, "12:34");
        assert_eq!(hits[0].views, "1.2M views");
        assert_eq!(hits[0].snippet, "A great intro.");
        assert_eq!(hits[0].watch_url(), "https://www.youtube.com/watch?v=abc12345678");
        assert_eq!(hits[1].title, "Second");
    }

    #[test]
    fn search_results_respect_count() {
        let mk = |id: &str| json!({ "videoRenderer": { "videoId": id, "title": { "simpleText": "x" } } });
        let data = json!({ "c": [mk("aaaaaaaaaaa"), mk("bbbbbbbbbbb"), mk("ccccccccccc")] });
        assert_eq!(parse_search_results(&data, 2).len(), 2);
    }

    #[test]
    fn format_results_handles_empty_and_listed() {
        assert!(format_results("cats", &[]).contains("No YouTube videos"));
        let hits = vec![VideoHit {
            video_id: "abc12345678".into(),
            title: "T".into(),
            channel: "Chan".into(),
            length: "1:00".into(),
            views: "5 views".into(),
            snippet: "S".into(),
        }];
        let out = format_results("q", &hits);
        assert!(out.contains("1. T"));
        assert!(out.contains("Chan · 5 views · 1:00"));
        assert!(out.contains("watch?v=abc12345678"));
        assert!(out.contains("youtube_transcript"));
    }

    #[test]
    fn selects_caption_track() {
        let tracks = vec![
            json!({ "languageCode": "en", "kind": "asr", "baseUrl": "auto" }),
            json!({ "languageCode": "en", "baseUrl": "manual" }),
            json!({ "languageCode": "de", "baseUrl": "german" }),
        ];
        // Prefers manual English over the asr track.
        assert_eq!(select_track(&tracks, None).unwrap()["baseUrl"], "manual");
        // Honors an explicit language.
        assert_eq!(select_track(&tracks, Some("de")).unwrap()["baseUrl"], "german");
        // Empty → none.
        assert!(select_track(&[], None).is_none());
    }

    #[test]
    fn selects_first_when_no_english() {
        let tracks = vec![
            json!({ "languageCode": "fr", "baseUrl": "french" }),
            json!({ "languageCode": "de", "baseUrl": "german" }),
        ];
        assert_eq!(select_track(&tracks, None).unwrap()["baseUrl"], "french");
    }

    #[test]
    fn parses_timedtext_xml() {
        let xml = r#"<?xml version="1.0"?><transcript>
            <text start="0" dur="3.5">Hello &amp;amp;#39;world&amp;amp;#39;</text>
            <text start="12.84" dur="2">  the   next   line  </text>
            <text start="15"></text>
        </transcript>"#;
        let entries = parse_timedtext(xml);
        assert_eq!(entries.len(), 2); // empty entry dropped
        assert_eq!(entries[0].0, 0.0);
        assert_eq!(entries[0].1, "Hello 'world'");
        assert_eq!(entries[1].0, 12.84);
        assert_eq!(entries[1].1, "the next line"); // whitespace collapsed
    }

    #[test]
    fn formats_timestamps() {
        assert_eq!(fmt_timestamp(0.0), "[00:00]");
        assert_eq!(fmt_timestamp(75.0), "[01:15]");
        assert_eq!(fmt_timestamp(3661.0), "[1:01:01]");
    }

    #[test]
    fn format_transcript_includes_title_and_timestamps() {
        let entries = vec![(0.0, "intro".to_string()), (65.0, "middle".to_string())];
        let out = format_transcript("My Video", "abc12345678", &entries);
        assert!(out.contains("\"My Video\""));
        assert!(out.contains("[00:00] intro"));
        assert!(out.contains("[01:05] middle"));
    }

    /// Live network check (ignored by default): real search + transcript for a
    /// known video. Run with:
    ///   cargo test --lib mcp::youtube::tests::live -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "hits the live network"]
    async fn live_search_and_transcript() {
        use std::sync::Mutex;
        let client = reqwest::Client::new();

        let captured: Mutex<Vec<ToolImage>> = Mutex::new(Vec::new());
        let emit = |imgs: Vec<ToolImage>| captured.lock().unwrap().extend(imgs);
        let summary = search(&client, &json!({ "query": "rust ownership explained" }), &emit)
            .await
            .expect("search should not error");
        eprintln!("\n--- search ---\n{summary}");
        assert!(captured.into_inner().unwrap().len() <= MAX_COUNT);

        let t = transcript(
            &client,
            &json!({ "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
        )
        .await
        .expect("transcript should not error");
        let head: String = t.chars().take(500).collect();
        eprintln!("\n--- transcript (head) ---\n{head}");
        assert!(t.contains('['));
    }
}
