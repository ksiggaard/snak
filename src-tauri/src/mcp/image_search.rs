//! Image *search* and *extraction* for the built-in `web` server. Two tools the
//! model can call when the user asks to see pictures:
//!
//! - `search_images` — query an image search engine (DuckDuckGo by default,
//!   keyless; Brave / Serper when a key is set, mirroring `web_search`) and return
//!   up to a few results.
//! - `fetch_images` — pull the images out of a specific article/page URL
//!   (`og:image` + `<img>`), resolving relative URLs.
//!
//! Unlike the text tools, these also produce **image bytes**: each found image is
//! downloaded, base64-encoded, and streamed to the UI out-of-band via an
//! [`ImageSink`] (a `tool_images` delta). The model only ever receives a short
//! text summary (titles + source URLs) so base64 never enters the context window.
//!
//! Scraping/JSON shapes are inherently brittle; every parse failure degrades to a
//! clear "no images found" string — the chat loop feeds tool errors back as text,
//! so a bad call never aborts the turn.

use anyhow::{anyhow, Context};
use base64::Engine;
use serde_json::{json, Value};

use super::web_search::require_key;
use super::ImageSink;
use crate::providers::{ToolDef, ToolImage};

/// Default backend when none is configured (keyless).
const DEFAULT_PROVIDER: &str = "duckduckgo";
/// How many images we return / display — "up to three" (also the hard cap).
const DEFAULT_COUNT: usize = 3;
const MAX_COUNT: usize = 3;
/// Reject any single image larger than this (thumbnails are far smaller); keeps
/// the DB row and the IPC payload bounded.
const MAX_IMAGE_BYTES: usize = 8 * 1024 * 1024;
/// Max chars kept per title so the summary stays token-friendly.
const TITLE_MAX: usize = 200;

/// One candidate image, before its bytes are downloaded. `thumbnail_url` (when
/// present) is preferred for download to keep payloads small.
#[derive(Debug, Clone, PartialEq)]
pub struct ImageHit {
    pub title: String,
    pub image_url: String,
    pub thumbnail_url: Option<String>,
    /// The page the image was found on (linked from the lightbox).
    pub source_url: String,
}

/// The `search_images` tool descriptor.
pub fn search_tool_def() -> ToolDef {
    ToolDef {
        name: "search_images".to_string(),
        description: "Search the web for IMAGES matching a query and return up to \
                      three pictures (downloaded and shown to the user inline). Use \
                      this whenever the user asks to see, show, or find an image / \
                      picture / photo of something (e.g. \"show me an image of an \
                      elephant\"). The pictures are displayed automatically; in your \
                      reply, briefly describe what you found and cite the source URLs."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "What to find an image of." },
                "count": {
                    "type": "integer",
                    "description": "How many images to return (default 3, max 3)."
                }
            },
            "required": ["query"]
        }),
    }
}

/// The `fetch_images` tool descriptor.
pub fn fetch_tool_def() -> ToolDef {
    ToolDef {
        name: "fetch_images".to_string(),
        description: "Extract the IMAGES embedded in a specific web page / article \
                      and return up to three of them (downloaded and shown to the \
                      user inline). Use this when the user gives a URL and wants to \
                      see the pictures from that page/article. The pictures are \
                      displayed automatically; in your reply, briefly describe them."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The absolute http:// or https:// URL of the page."
                },
                "count": {
                    "type": "integer",
                    "description": "How many images to return (default 3, max 3)."
                }
            },
            "required": ["url"]
        }),
    }
}

fn parse_count(args: &Value) -> usize {
    args.get("count")
        .and_then(|c| c.as_u64())
        .map(|c| (c as usize).clamp(1, MAX_COUNT))
        .unwrap_or(DEFAULT_COUNT)
}

// ---------------------------------------------------------------------------
// search_images
// ---------------------------------------------------------------------------

/// Execute a `search_images` call. `provider` is the configured backend
/// (`None` → DuckDuckGo). Downloads each hit's bytes, emits them to the UI, and
/// returns a text summary for the model.
pub async fn search(
    client: &reqwest::Client,
    args: &Value,
    provider: Option<&str>,
    emit_images: ImageSink<'_>,
) -> anyhow::Result<String> {
    let query = args
        .get("query")
        .and_then(|q| q.as_str())
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or_else(|| anyhow!("search_images requires a non-empty string `query`"))?;
    let count = parse_count(args);

    let provider = provider.unwrap_or(DEFAULT_PROVIDER);
    let hits = match provider {
        "brave" => search_brave(client, query, count).await?,
        "serper" => search_serper(client, query, count).await?,
        _ => search_duckduckgo(client, query, count).await?,
    };

    let (images, downloaded) = download_hits(client, &hits, count).await;
    emit_images(images);
    Ok(format_summary(
        &format!("image search results for \"{query}\""),
        &downloaded,
    ))
}

// ---------------------------------------------------------------------------
// fetch_images
// ---------------------------------------------------------------------------

/// Execute a `fetch_images` call: download the page, extract image URLs, fetch
/// up to `count` of them, emit, and summarize.
pub async fn fetch(
    client: &reqwest::Client,
    args: &Value,
    emit_images: ImageSink<'_>,
) -> anyhow::Result<String> {
    let url = args
        .get("url")
        .and_then(|u| u.as_str())
        .map(str::trim)
        .filter(|u| !u.is_empty())
        .ok_or_else(|| anyhow!("fetch_images requires a string `url` argument"))?;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(anyhow!("url must start with http:// or https://"));
    }
    let count = parse_count(args);

    let resp = client
        .get(url)
        .header("user-agent", "snak/0.1 (+mcp image-fetch)")
        .send()
        .await
        .context("page fetch request failed")?;
    let status = resp.status();
    if !status.is_success() {
        return Err(anyhow!("page fetch error {status} for {url}"));
    }
    let body = resp.text().await.context("reading page body")?;

    let urls = extract_image_urls(&body, url);
    let hits: Vec<ImageHit> = urls
        .into_iter()
        .map(|image_url| ImageHit {
            title: String::new(),
            image_url,
            thumbnail_url: None,
            source_url: url.to_string(),
        })
        .collect();

    let (images, downloaded) = download_hits(client, &hits, count).await;
    emit_images(images);
    Ok(format_summary(&format!("images from {url}"), &downloaded))
}

// ---------------------------------------------------------------------------
// Downloading + summary
// ---------------------------------------------------------------------------

/// Download up to `count` hits' bytes (preferring the thumbnail), returning the
/// emit-ready `ToolImage`s and the parallel list of hits that succeeded (for the
/// text summary). Hits that fail to download are skipped.
async fn download_hits(
    client: &reqwest::Client,
    hits: &[ImageHit],
    count: usize,
) -> (Vec<ToolImage>, Vec<ImageHit>) {
    let mut images = Vec::new();
    let mut ok_hits = Vec::new();
    for hit in hits {
        if images.len() >= count {
            break;
        }
        let candidate = hit
            .thumbnail_url
            .as_deref()
            .filter(|u| !u.is_empty())
            .unwrap_or(&hit.image_url);
        match download_image(client, candidate).await {
            Some((media_type, data)) => {
                images.push(ToolImage {
                    media_type,
                    data,
                    source_url: Some(hit.source_url.clone()).filter(|s| !s.is_empty()),
                    title: Some(hit.title.clone()).filter(|t| !t.is_empty()),
                });
                ok_hits.push(hit.clone());
            }
            None => continue,
        }
    }
    (images, ok_hits)
}

/// Fetch one image and base64-encode it. Returns `None` on any failure (non-image
/// content type we can't classify, over the size cap, network error). Shared with
/// `youtube` (video thumbnails).
pub(crate) async fn download_image(
    client: &reqwest::Client,
    url: &str,
) -> Option<(String, String)> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return None;
    }
    let resp = client
        .get(url)
        .header("user-agent", "snak/0.1 (+mcp image-fetch)")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let header_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            s.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        });
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_IMAGE_BYTES {
            return None;
        }
    }
    let media_type = resolve_media_type(header_type.as_deref(), url)?;
    let bytes = resp.bytes().await.ok()?;
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return None;
    }
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Some((media_type, data))
}

/// Decide the media type: trust an `image/*` Content-Type, else infer from the
/// URL's file extension. `None` if neither says it's an image.
fn resolve_media_type(content_type: Option<&str>, url: &str) -> Option<String> {
    if let Some(ct) = content_type {
        if ct.starts_with("image/") {
            return Some(ct.to_string());
        }
    }
    let path = url.split(['?', '#']).next().unwrap_or(url);
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    let by_ext = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    };
    Some(by_ext.to_string())
}

/// Render a token-friendly numbered list of what was found, for the model. Empty
/// list → a clear "no images" line so the model can say so rather than guessing.
fn format_summary(label: &str, hits: &[ImageHit]) -> String {
    if hits.is_empty() {
        return format!("No images found for {label}. Tell the user none were found.");
    }
    let mut out = format!(
        "Found {} image(s) ({label}); they are already shown to the user inline. \
         Briefly describe them and cite the sources:\n",
        hits.len()
    );
    for (i, h) in hits.iter().enumerate() {
        let title = if h.title.is_empty() {
            "(untitled)"
        } else {
            &h.title
        };
        out.push_str(&format!("\n{}. {}\n", i + 1, clip(title, TITLE_MAX)));
        if !h.source_url.is_empty() {
            out.push_str(&format!("   source: {}\n", h.source_url));
        }
    }
    out
}

// ---------------------------------------------------------------------------
// DuckDuckGo (keyless): scrape a `vqd` token, then hit the i.js JSON endpoint.
// ---------------------------------------------------------------------------

async fn search_duckduckgo(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> anyhow::Result<Vec<ImageHit>> {
    let html = client
        .get("https://duckduckgo.com/")
        .query(&[("q", query), ("iax", "images"), ("ia", "images")])
        .header("user-agent", "Mozilla/5.0 (snak/0.1 +mcp image-search)")
        .send()
        .await
        .context("DuckDuckGo token request failed")?
        .text()
        .await
        .context("reading DuckDuckGo token page")?;
    let Some(vqd) = extract_vqd(&html) else {
        return Ok(Vec::new());
    };

    let resp = client
        .get("https://duckduckgo.com/i.js")
        .query(&[
            ("l", "us-en"),
            ("o", "json"),
            ("q", query),
            ("vqd", &vqd),
            ("f", ",,,"),
            ("p", "1"),
        ])
        .header("user-agent", "Mozilla/5.0 (snak/0.1 +mcp image-search)")
        .header("referer", "https://duckduckgo.com/")
        .send()
        .await
        .context("DuckDuckGo image request failed")?;
    if !resp.status().is_success() {
        return Ok(Vec::new());
    }
    let body = resp.text().await.context("reading DuckDuckGo images")?;
    let v: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    Ok(parse_duckduckgo_json(&v, count))
}

/// Pull the `vqd` token DuckDuckGo embeds in the search page. It appears as
/// `vqd="4-123…"` (modern) or `vqd='…'` / `vqd=…&` (older JS). Pure / tested.
pub fn extract_vqd(html: &str) -> Option<String> {
    for needle in ["vqd=\"", "vqd='"] {
        if let Some(start) = html.find(needle) {
            let rest = &html[start + needle.len()..];
            let quote = needle.chars().last().unwrap();
            if let Some(end) = rest.find(quote) {
                let token = &rest[..end];
                if !token.is_empty() {
                    return Some(token.to_string());
                }
            }
        }
    }
    // Bare `vqd=token&` form.
    if let Some(start) = html.find("vqd=") {
        let rest = &html[start + "vqd=".len()..];
        let token: String = rest
            .chars()
            .take_while(|c| !matches!(c, '&' | '"' | '\'' | ' ' | '>'))
            .collect();
        if !token.is_empty() {
            return Some(token);
        }
    }
    None
}

/// Parse DuckDuckGo's `i.js` JSON (`{results:[{title,image,thumbnail,url}]}`).
/// Pure / tested.
pub fn parse_duckduckgo_json(v: &Value, count: usize) -> Vec<ImageHit> {
    let mut out = Vec::new();
    if let Some(arr) = v.get("results").and_then(|r| r.as_array()) {
        for r in arr {
            if out.len() >= count {
                break;
            }
            let image_url = str_field(r, "image");
            if image_url.is_empty() {
                continue;
            }
            out.push(ImageHit {
                title: str_field(r, "title").to_string(),
                image_url: image_url.to_string(),
                thumbnail_url: Some(str_field(r, "thumbnail").to_string())
                    .filter(|s| !s.is_empty()),
                source_url: str_field(r, "url").to_string(),
            });
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Brave / Serper (keyed JSON APIs)
// ---------------------------------------------------------------------------

async fn search_brave(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> anyhow::Result<Vec<ImageHit>> {
    let key = require_key("brave")?;
    let resp = client
        .get("https://api.search.brave.com/res/v1/images/search")
        .query(&[("q", query), ("count", &count.to_string())])
        .header("Accept", "application/json")
        .header("X-Subscription-Token", key)
        .send()
        .await
        .context("Brave image search request failed")?;
    let status = resp.status();
    let body = resp.text().await.context("reading Brave response")?;
    if !status.is_success() {
        return Err(anyhow!("Brave image search error {status}: {body}"));
    }
    let v: Value = serde_json::from_str(&body).context("parsing Brave response")?;
    Ok(parse_brave_json(&v, count))
}

/// Parse Brave's images response (`{results:[{title,url,thumbnail:{src},
/// properties:{url}}]}`). Pure / tested.
pub fn parse_brave_json(v: &Value, count: usize) -> Vec<ImageHit> {
    let mut out = Vec::new();
    if let Some(arr) = v.get("results").and_then(|r| r.as_array()) {
        for r in arr {
            if out.len() >= count {
                break;
            }
            let image_url = r
                .pointer("/properties/url")
                .and_then(|x| x.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    r.pointer("/thumbnail/src")
                        .and_then(|x| x.as_str())
                        .unwrap_or("")
                });
            if image_url.is_empty() {
                continue;
            }
            out.push(ImageHit {
                title: str_field(r, "title").to_string(),
                image_url: image_url.to_string(),
                thumbnail_url: r
                    .pointer("/thumbnail/src")
                    .and_then(|x| x.as_str())
                    .map(String::from)
                    .filter(|s| !s.is_empty()),
                source_url: str_field(r, "url").to_string(),
            });
        }
    }
    out
}

async fn search_serper(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> anyhow::Result<Vec<ImageHit>> {
    let key = require_key("serper")?;
    let resp = client
        .post("https://google.serper.dev/images")
        .header("X-API-KEY", key)
        .json(&json!({ "q": query, "num": count }))
        .send()
        .await
        .context("Serper image search request failed")?;
    let status = resp.status();
    let body = resp.text().await.context("reading Serper response")?;
    if !status.is_success() {
        return Err(anyhow!("Serper image search error {status}: {body}"));
    }
    let v: Value = serde_json::from_str(&body).context("parsing Serper response")?;
    Ok(parse_serper_json(&v, count))
}

/// Parse Serper's images response (`{images:[{title,imageUrl,thumbnailUrl,
/// link}]}`). Pure / tested.
pub fn parse_serper_json(v: &Value, count: usize) -> Vec<ImageHit> {
    let mut out = Vec::new();
    if let Some(arr) = v.get("images").and_then(|i| i.as_array()) {
        for r in arr {
            if out.len() >= count {
                break;
            }
            let image_url = str_field(r, "imageUrl");
            if image_url.is_empty() {
                continue;
            }
            out.push(ImageHit {
                title: str_field(r, "title").to_string(),
                image_url: image_url.to_string(),
                thumbnail_url: Some(str_field(r, "thumbnailUrl").to_string())
                    .filter(|s| !s.is_empty()),
                source_url: str_field(r, "link").to_string(),
            });
        }
    }
    out
}

// ---------------------------------------------------------------------------
// HTML image extraction (for fetch_images)
// ---------------------------------------------------------------------------

/// Extract image URLs from a page: `og:image` / `twitter:image` meta tags first
/// (usually the best representative image), then `<img src>` / `srcset`. URLs are
/// resolved to absolute against `base_url` and de-duplicated in document order.
/// Pure / tested.
pub fn extract_image_urls(html: &str, base_url: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut push = |raw: &str| {
        let cleaned = raw.replace("&amp;", "&");
        if let Some(abs) = resolve_url(base_url, cleaned.trim()) {
            if !out.contains(&abs) {
                out.push(abs);
            }
        }
    };

    let lower = html.to_ascii_lowercase();

    // <meta property="og:image" content="…"> / name="twitter:image"
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<meta") {
        let tag_start = from + rel;
        let Some(gt) = html[tag_start..].find('>') else {
            break;
        };
        let tag_end = tag_start + gt;
        let attrs = &html[tag_start..tag_end];
        from = tag_end + 1;
        let attrs_lower = attrs.to_ascii_lowercase();
        if attrs_lower.contains("og:image") || attrs_lower.contains("twitter:image") {
            if let Some(content) = attr_value(attrs, "content") {
                push(&content);
            }
        }
    }

    // <img src="…"> (+ first srcset candidate)
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<img") {
        let tag_start = from + rel;
        let Some(gt) = html[tag_start..].find('>') else {
            break;
        };
        let tag_end = tag_start + gt;
        let attrs = &html[tag_start..tag_end];
        from = tag_end + 1;
        if let Some(src) = attr_value(attrs, "src") {
            push(&src);
        } else if let Some(srcset) = attr_value(attrs, "srcset") {
            if let Some(first) = srcset.split(',').next() {
                if let Some(u) = first.split_whitespace().next() {
                    push(u);
                }
            }
        }
    }
    out
}

/// Resolve a possibly-relative URL against a base. Handles absolute URLs,
/// scheme-relative (`//host/…`), root-relative (`/path`), and document-relative
/// references. Skips data:/javascript:/anchor/empty refs (returns `None`).
/// Pure / tested.
pub fn resolve_url(base: &str, href: &str) -> Option<String> {
    let href = href.trim();
    if href.is_empty()
        || href.starts_with('#')
        || href.starts_with("data:")
        || href.starts_with("javascript:")
    {
        return None;
    }
    if href.starts_with("http://") || href.starts_with("https://") {
        return Some(href.to_string());
    }
    let (scheme, origin, dir) = split_base(base)?;
    if let Some(rest) = href.strip_prefix("//") {
        return Some(format!("{scheme}://{rest}"));
    }
    if let Some(rest) = href.strip_prefix('/') {
        return Some(format!("{origin}/{rest}"));
    }
    Some(format!("{dir}{href}"))
}

/// Break a base URL into `(scheme, origin, dir)` where `origin` is
/// `scheme://host` and `dir` is the origin plus the path up to the last `/`.
fn split_base(base: &str) -> Option<(String, String, String)> {
    let scheme_end = base.find("://")?;
    let scheme = base[..scheme_end].to_string();
    let after = &base[scheme_end + 3..];
    let host_end = after.find('/').unwrap_or(after.len());
    let host = &after[..host_end];
    if host.is_empty() {
        return None;
    }
    let origin = format!("{scheme}://{host}");
    let path = &after[host_end..]; // begins with '/' or empty
    let dir = match path.rfind('/') {
        Some(idx) => format!("{origin}{}", &path[..=idx]),
        None => format!("{origin}/"),
    };
    Some((scheme, origin, dir))
}

// ---------------------------------------------------------------------------
// small shared helpers
// ---------------------------------------------------------------------------

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// Extract `name="value"` from a tag's attribute string (double-quoted only,
/// matching the existing `web_search` parser).
fn attr_value(attrs: &str, name: &str) -> Option<String> {
    let lower = attrs.to_ascii_lowercase();
    let needle = format!("{name}=\"");
    let rel = lower.find(&needle)?;
    let start = rel + needle.len();
    let end = attrs[start..].find('"')? + start;
    Some(attrs[start..end].to_string())
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

    /// Live network check (ignored by default): run the real DuckDuckGo image
    /// search + download path end to end for a query and assert every emitted
    /// image is valid, decodable image bytes — i.e. nothing the UI would render
    /// as a broken image. Run with:
    ///   cargo test --lib image_search::tests::live -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "hits the live network"]
    async fn live_kia_search_returns_loadable_images() {
        use std::sync::Mutex;

        let client = reqwest::Client::new();
        let captured: Mutex<Vec<ToolImage>> = Mutex::new(Vec::new());
        let emit = |imgs: Vec<ToolImage>| captured.lock().unwrap().extend(imgs);

        let summary = search(
            &client,
            &json!({ "query": "kia cars" }),
            Some("duckduckgo"),
            &emit,
        )
        .await
        .expect("search should not error");

        let images = captured.into_inner().unwrap();
        eprintln!(
            "\n--- model-facing summary ---\n{summary}\n--- {} image(s) emitted ---",
            images.len()
        );

        assert!(
            !images.is_empty(),
            "expected at least one image for 'kia cars'"
        );
        assert!(images.len() <= 3, "should cap at three images");

        for (i, img) in images.iter().enumerate() {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(img.data.as_bytes())
                .expect("emitted data must be valid base64");
            let kind = sniff_image(&bytes);
            eprintln!(
                "  [{}] {} bytes, media_type={}, magic={}, source={}",
                i + 1,
                bytes.len(),
                img.media_type,
                kind.unwrap_or("UNKNOWN"),
                img.source_url.as_deref().unwrap_or("-"),
            );
            assert!(!bytes.is_empty(), "image {i} must have bytes");
            assert!(
                kind.is_some(),
                "image {i} ({}) must be a real image, not an error page",
                img.media_type
            );
        }
    }

    /// Identify an image by its magic bytes — proof the payload is a real image
    /// the webview can render, not an HTML error page that returned 200.
    fn sniff_image(b: &[u8]) -> Option<&'static str> {
        if b.starts_with(&[0xFF, 0xD8, 0xFF]) {
            Some("JPEG")
        } else if b.starts_with(&[0x89, b'P', b'N', b'G']) {
            Some("PNG")
        } else if b.starts_with(b"GIF8") {
            Some("GIF")
        } else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" {
            Some("WEBP")
        } else if b.starts_with(b"<svg") || b.starts_with(b"<?xml") {
            Some("SVG")
        } else {
            None
        }
    }

    #[test]
    fn tool_defs_have_expected_names() {
        assert_eq!(search_tool_def().name, "search_images");
        assert_eq!(fetch_tool_def().name, "fetch_images");
    }

    #[test]
    fn count_clamps_to_three() {
        assert_eq!(parse_count(&json!({})), 3);
        assert_eq!(parse_count(&json!({ "count": 1 })), 1);
        assert_eq!(parse_count(&json!({ "count": 99 })), 3);
    }

    #[test]
    fn extract_vqd_quoted_and_bare() {
        assert_eq!(
            extract_vqd(r#"x vqd="4-12345" y"#).as_deref(),
            Some("4-12345")
        );
        assert_eq!(extract_vqd("a vqd='9-abc' b").as_deref(), Some("9-abc"));
        assert_eq!(extract_vqd("u=1&vqd=3-zzz&p=1").as_deref(), Some("3-zzz"));
        assert_eq!(extract_vqd("no token here"), None);
    }

    #[test]
    fn parse_ddg_json_takes_image_and_thumbnail() {
        let v = json!({
            "results": [
                { "title": "Elephant", "image": "https://e.com/full.jpg",
                  "thumbnail": "https://e.com/thumb.jpg", "url": "https://e.com/page" },
                { "title": "No image", "image": "" }
            ]
        });
        let hits = parse_duckduckgo_json(&v, 3);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].image_url, "https://e.com/full.jpg");
        assert_eq!(
            hits[0].thumbnail_url.as_deref(),
            Some("https://e.com/thumb.jpg")
        );
        assert_eq!(hits[0].source_url, "https://e.com/page");
    }

    #[test]
    fn parse_brave_prefers_properties_url() {
        let v = json!({
            "results": [{
                "title": "Pyramids", "url": "https://src.com/article",
                "thumbnail": { "src": "https://src.com/t.jpg" },
                "properties": { "url": "https://src.com/big.jpg" }
            }]
        });
        let hits = parse_brave_json(&v, 3);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].image_url, "https://src.com/big.jpg");
        assert_eq!(
            hits[0].thumbnail_url.as_deref(),
            Some("https://src.com/t.jpg")
        );
        assert_eq!(hits[0].source_url, "https://src.com/article");
    }

    #[test]
    fn parse_serper_images() {
        let v = json!({
            "images": [{
                "title": "Steam Deck", "imageUrl": "https://g.com/sd.jpg",
                "thumbnailUrl": "https://g.com/sd_t.jpg", "link": "https://g.com/page"
            }]
        });
        let hits = parse_serper_json(&v, 3);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].image_url, "https://g.com/sd.jpg");
        assert_eq!(hits[0].source_url, "https://g.com/page");
    }

    #[test]
    fn count_cap_respected_across_providers() {
        let v = json!({ "images": [
            { "imageUrl": "https://a/1.jpg" }, { "imageUrl": "https://a/2.jpg" },
            { "imageUrl": "https://a/3.jpg" }, { "imageUrl": "https://a/4.jpg" }
        ] });
        assert_eq!(parse_serper_json(&v, 2).len(), 2);
    }

    #[test]
    fn resolve_url_variants() {
        let base = "https://ex.com/a/b/page.html";
        assert_eq!(
            resolve_url(base, "https://o.com/x.jpg").as_deref(),
            Some("https://o.com/x.jpg")
        );
        assert_eq!(
            resolve_url(base, "//cdn.com/x.jpg").as_deref(),
            Some("https://cdn.com/x.jpg")
        );
        assert_eq!(
            resolve_url(base, "/img/x.jpg").as_deref(),
            Some("https://ex.com/img/x.jpg")
        );
        assert_eq!(
            resolve_url(base, "x.jpg").as_deref(),
            Some("https://ex.com/a/b/x.jpg")
        );
        assert_eq!(resolve_url(base, "#top"), None);
        assert_eq!(resolve_url(base, "data:image/png;base64,AAAA"), None);
        assert_eq!(resolve_url(base, ""), None);
    }

    #[test]
    fn extract_image_urls_meta_and_img() {
        let html = r#"
            <html><head>
              <meta property="og:image" content="https://ex.com/og.jpg">
              <meta name="twitter:image" content="/t.jpg">
            </head><body>
              <img src="/a/pic1.png" alt="x">
              <img src="pic2.jpg">
              <img srcset="https://ex.com/s1.jpg 1x, https://ex.com/s2.jpg 2x">
              <img src="https://ex.com/og.jpg">
            </body></html>
        "#;
        let urls = extract_image_urls(html, "https://ex.com/blog/post.html");
        // og:image first, twitter:image resolved, then imgs; duplicate og.jpg deduped.
        assert_eq!(urls[0], "https://ex.com/og.jpg");
        assert!(urls.contains(&"https://ex.com/t.jpg".to_string()));
        assert!(urls.contains(&"https://ex.com/a/pic1.png".to_string()));
        assert!(urls.contains(&"https://ex.com/blog/pic2.jpg".to_string()));
        assert!(urls.contains(&"https://ex.com/s1.jpg".to_string()));
        assert_eq!(
            urls.iter()
                .filter(|u| *u == "https://ex.com/og.jpg")
                .count(),
            1
        );
    }

    #[test]
    fn resolve_media_type_from_header_or_ext() {
        assert_eq!(
            resolve_media_type(Some("image/png"), "https://x/y").as_deref(),
            Some("image/png")
        );
        assert_eq!(
            resolve_media_type(Some("application/octet-stream"), "https://x/y.jpg?a=1").as_deref(),
            Some("image/jpeg")
        );
        assert_eq!(resolve_media_type(None, "https://x/page.html"), None);
    }

    #[test]
    fn format_summary_empty_and_listed() {
        assert!(format_summary("q", &[]).contains("No images found"));
        let hits = vec![ImageHit {
            title: "Elephant".into(),
            image_url: "https://e/i.jpg".into(),
            thumbnail_url: None,
            source_url: "https://e/page".into(),
        }];
        let out = format_summary("image search results for \"elephant\"", &hits);
        assert!(out.contains("1. Elephant"));
        assert!(out.contains("https://e/page"));
    }
}
