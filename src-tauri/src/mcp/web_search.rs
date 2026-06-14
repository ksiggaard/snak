//! Web *search* for the built-in `web` server (T52 / IDEA 23). Small models
//! can't guess the URLs to `fetch_url`; this adds a `search_web` tool that
//! returns a ranked list of title + URL + snippet so the model can search, then
//! fetch a result.
//!
//! The backend is **configurable** (carried on the web server's config as
//! `search_provider`):
//! - `duckduckgo` (default) — keyless; scrapes the DuckDuckGo HTML endpoint.
//! - `brave` / `serper` — JSON search APIs; the API key is read in-process from
//!   the OS keychain (account `search.<provider>`) so it never reaches the
//!   webview, mirroring how provider keys are read in `commands/chat.rs`.
//!
//! HTML scraping is inherently brittle; parse failures degrade to a clear
//! "no results" string (the chat loop feeds tool errors back as text, so a bad
//! search never aborts the turn).

use anyhow::{anyhow, Context};
use serde_json::{json, Value};

use super::web_browse::html_to_text;
use crate::commands::keys;
use crate::providers::ToolDef;

/// Default backend when none is configured.
pub const DEFAULT_PROVIDER: &str = "duckduckgo";
/// Default number of results returned, and the hard cap.
const DEFAULT_COUNT: usize = 6;
const MAX_COUNT: usize = 10;
/// Max chars kept per title/snippet so a result list stays token-friendly.
const FIELD_MAX: usize = 300;

/// One search hit.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

/// The `search_web` tool descriptor.
pub fn tool_def() -> ToolDef {
    ToolDef {
        name: "search_web".to_string(),
        description: "Search the web for pages relevant to a query and return a \
                      ranked list of results (title, URL, and a short snippet). \
                      Use this to discover which pages to read when you don't \
                      already have a URL, then call `web__fetch_url` on the most \
                      relevant result to read its full text before answering."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query."
                },
                "count": {
                    "type": "integer",
                    "description": "How many results to return (default 6, max 10)."
                }
            },
            "required": ["query"]
        }),
    }
}

/// Execute a `search_web` call. `provider` is the configured backend
/// (`None` → DuckDuckGo).
pub async fn search(
    client: &reqwest::Client,
    args: &Value,
    provider: Option<&str>,
) -> anyhow::Result<String> {
    let query = args
        .get("query")
        .and_then(|q| q.as_str())
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .ok_or_else(|| anyhow!("search_web requires a non-empty string `query`"))?;
    let count = args
        .get("count")
        .and_then(|c| c.as_u64())
        .map(|c| (c as usize).clamp(1, MAX_COUNT))
        .unwrap_or(DEFAULT_COUNT);

    let provider = provider.unwrap_or(DEFAULT_PROVIDER);
    let results = match provider {
        "brave" => search_brave(client, query, count).await?,
        "serper" => search_serper(client, query, count).await?,
        // Default + explicit "duckduckgo" + any unknown value → keyless DDG.
        _ => search_duckduckgo(client, query, count).await?,
    };
    Ok(format_results(query, &results))
}

/// Render results as a compact, numbered, token-friendly list.
pub fn format_results(query: &str, results: &[SearchResult]) -> String {
    if results.is_empty() {
        return format!("No web results found for \"{query}\".");
    }
    let mut out = format!("Web search results for \"{query}\":\n");
    for (i, r) in results.iter().enumerate() {
        out.push_str(&format!("\n{}. {}\n   {}\n", i + 1, r.title, r.url));
        if !r.snippet.is_empty() {
            out.push_str(&format!("   {}\n", r.snippet));
        }
    }
    out.push_str("\nUse web__fetch_url on a result's URL to read the full page before answering.");
    out
}

// ---------------------------------------------------------------------------
// DuckDuckGo (keyless HTML scrape)
// ---------------------------------------------------------------------------

async fn search_duckduckgo(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let resp = client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", query)])
        .header("user-agent", "snak/0.1 (+mcp web-search)")
        .send()
        .await
        .context("web search request failed")?;
    let status = resp.status();
    if !status.is_success() {
        return Err(anyhow!("web search error {status}"));
    }
    let body = resp.text().await.context("reading search results")?;
    Ok(parse_duckduckgo_html(&body, count))
}

/// Parse the DuckDuckGo HTML endpoint into results. Pure / unit-tested.
///
/// Result anchors carry `class="result__a"` and a redirect href
/// (`//duckduckgo.com/l/?uddg=<percent-encoded real url>`); snippets carry
/// `class="result__snippet"`. We pair them by order. Best-effort: anything we
/// can't parse is skipped rather than erroring.
pub fn parse_duckduckgo_html(html: &str, count: usize) -> Vec<SearchResult> {
    let titles = extract_anchors(html, "result__a");
    let snippets = extract_anchors(html, "result__snippet");
    let mut out = Vec::new();
    for (i, (href, text)) in titles.into_iter().enumerate() {
        if out.len() >= count {
            break;
        }
        let url = decode_ddg_href(&href);
        if url.is_empty() {
            continue;
        }
        let snippet = snippets
            .get(i)
            .map(|(_, t)| clip(t, FIELD_MAX))
            .unwrap_or_default();
        out.push(SearchResult {
            title: clip(&text, FIELD_MAX),
            url,
            snippet,
        });
    }
    out
}

/// Find `<a …>` tags whose attributes contain `class_marker`, returning each
/// tag's `href` value and cleaned inner text.
fn extract_anchors(html: &str, class_marker: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let lower = html.to_ascii_lowercase();
    let mut search_from = 0;
    while let Some(rel) = lower[search_from..].find("<a ") {
        let tag_start = search_from + rel;
        let Some(gt) = html[tag_start..].find('>') else {
            break;
        };
        let tag_end = tag_start + gt; // index of '>'
        let attrs = &html[tag_start..tag_end];
        search_from = tag_end + 1;
        if !attrs.contains(class_marker) {
            continue;
        }
        let Some(href) = attr_value(attrs, "href") else {
            continue;
        };
        // Inner text up to the closing </a>.
        let inner_lower = &lower[search_from..];
        let inner_end = inner_lower
            .find("</a>")
            .map(|e| search_from + e)
            .unwrap_or(html.len());
        let inner = &html[search_from..inner_end];
        let text = html_to_text(inner, FIELD_MAX * 2);
        out.push((href, text));
        search_from = inner_end;
    }
    out
}

/// Extract `name="value"` from a tag's attribute string (double-quoted only).
fn attr_value(attrs: &str, name: &str) -> Option<String> {
    let needle = format!("{name}=\"");
    let start = attrs.find(&needle)? + needle.len();
    let end = attrs[start..].find('"')? + start;
    Some(attrs[start..end].to_string())
}

/// Turn a DuckDuckGo redirect href into the real target URL. The href looks like
/// `//duckduckgo.com/l/?uddg=<percent-encoded url>&rut=…`; we pull out `uddg`
/// and percent-decode it. A non-redirect href is returned (entity-decoded) as-is.
pub fn decode_ddg_href(href: &str) -> String {
    let cleaned = href.replace("&amp;", "&");
    if let Some(idx) = cleaned.find("uddg=") {
        let rest = &cleaned[idx + "uddg=".len()..];
        let enc = rest.split('&').next().unwrap_or(rest);
        return percent_decode(enc);
    }
    if cleaned.starts_with("//") {
        return format!("https:{cleaned}");
    }
    cleaned
}

/// Minimal `application/x-www-form-urlencoded` decode (`%XX` + `+`). Avoids a new
/// dependency; sufficient for DDG redirect targets.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(b);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
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

// ---------------------------------------------------------------------------
// Keyed JSON APIs (Brave, Serper)
// ---------------------------------------------------------------------------

/// Read the search API key from the keychain (account `search.<provider>`), with
/// an actionable error when it's missing.
fn require_key(provider: &str) -> anyhow::Result<String> {
    let account = format!("search.{provider}");
    match keys::get_api_key(&account).map_err(|e| anyhow!(e))? {
        Some(k) if !k.is_empty() => Ok(k),
        _ => Err(anyhow!(
            "no API key set for the {provider} search provider — add one in \
             Settings → MCP Servers, or switch the search provider to DuckDuckGo."
        )),
    }
}

async fn search_brave(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let key = require_key("brave")?;
    let resp = client
        .get("https://api.search.brave.com/res/v1/web/search")
        .query(&[("q", query), ("count", &count.to_string())])
        .header("Accept", "application/json")
        .header("X-Subscription-Token", key)
        .send()
        .await
        .context("Brave search request failed")?;
    let status = resp.status();
    let body = resp.text().await.context("reading Brave response")?;
    if !status.is_success() {
        return Err(anyhow!("Brave search error {status}: {body}"));
    }
    let v: Value = serde_json::from_str(&body).context("parsing Brave response")?;
    let mut out = Vec::new();
    if let Some(arr) = v.pointer("/web/results").and_then(|r| r.as_array()) {
        for r in arr.iter().take(count) {
            out.push(SearchResult {
                title: clip(str_field(r, "title"), FIELD_MAX),
                url: str_field(r, "url").to_string(),
                snippet: clip(str_field(r, "description"), FIELD_MAX),
            });
        }
    }
    Ok(out)
}

async fn search_serper(
    client: &reqwest::Client,
    query: &str,
    count: usize,
) -> anyhow::Result<Vec<SearchResult>> {
    let key = require_key("serper")?;
    let resp = client
        .post("https://google.serper.dev/search")
        .header("X-API-KEY", key)
        .json(&json!({ "q": query, "num": count }))
        .send()
        .await
        .context("Serper search request failed")?;
    let status = resp.status();
    let body = resp.text().await.context("reading Serper response")?;
    if !status.is_success() {
        return Err(anyhow!("Serper search error {status}: {body}"));
    }
    let v: Value = serde_json::from_str(&body).context("parsing Serper response")?;
    let mut out = Vec::new();
    if let Some(arr) = v.get("organic").and_then(|o| o.as_array()) {
        for r in arr.iter().take(count) {
            out.push(SearchResult {
                title: clip(str_field(r, "title"), FIELD_MAX),
                url: str_field(r, "link").to_string(),
                snippet: clip(str_field(r, "snippet"), FIELD_MAX),
            });
        }
    }
    Ok(out)
}

fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_ddg_redirect_href() {
        let href = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%20b&amp;rut=xyz";
        assert_eq!(decode_ddg_href(href), "https://example.com/a b");
    }

    #[test]
    fn decode_ddg_href_passes_through_plain_url() {
        assert_eq!(
            decode_ddg_href("//example.com/page"),
            "https://example.com/page"
        );
    }

    #[test]
    fn parses_duckduckgo_results() {
        let html = r#"
            <div class="result">
              <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frust-lang.org%2F&amp;rut=1">The Rust Language</a>
              <a class="result__snippet" href="//x">A systems &amp; programming language.</a>
            </div>
            <div class="result">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.rs%2F">docs.rs</a>
              <a class="result__snippet" href="//y">Crate documentation.</a>
            </div>
        "#;
        let results = parse_duckduckgo_html(html, 10);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "The Rust Language");
        assert_eq!(results[0].url, "https://rust-lang.org/");
        assert_eq!(results[0].snippet, "A systems & programming language.");
        assert_eq!(results[1].url, "https://docs.rs/");
    }

    #[test]
    fn respects_count_cap() {
        let one =
            r#"<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com">A</a>"#;
        let html = one.repeat(5);
        assert_eq!(parse_duckduckgo_html(&html, 2).len(), 2);
    }

    #[test]
    fn format_results_handles_empty() {
        assert!(format_results("cats", &[]).contains("No web results"));
    }

    #[test]
    fn format_results_numbers_entries() {
        let r = vec![SearchResult {
            title: "T".into(),
            url: "https://e.com".into(),
            snippet: "S".into(),
        }];
        let out = format_results("q", &r);
        assert!(out.contains("1. T"));
        assert!(out.contains("https://e.com"));
        assert!(out.contains("web__fetch_url"));
    }

    #[test]
    fn tool_def_is_search_web() {
        assert_eq!(tool_def().name, "search_web");
    }
}
