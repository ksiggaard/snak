//! Built-in, in-process web-browsing MCP-style server. Exposes a single
//! `fetch_url` tool that GETs a URL and returns its readable text content. This
//! ships enabled by default so MCP/tool-use works out of the box with no
//! external server to install — it implements the same `Transport`-shaped
//! surface (`list_tools` / `call_tool`) the manager calls, but in-process
//! (no subprocess, no socket).

use anyhow::{anyhow, Context};
use serde_json::json;

use super::ToolDef;

/// The id used to namespace this server's tools (`web__fetch_url`).
pub const SERVER_ID: &str = "web";

/// Max bytes of extracted text we hand back to the model, so a huge page can't
/// blow the context window. Generous but bounded.
const MAX_TEXT_LEN: usize = 20_000;

/// The tools this built-in server advertises. One tool: fetch a URL.
pub fn tools() -> Vec<ToolDef> {
    vec![ToolDef {
        name: "fetch_url".to_string(),
        description: "Fetch a web page over HTTP(S) and return its readable text \
                      content (HTML tags, scripts, and styles stripped). Use this \
                      to look up current information from a specific URL."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The absolute http:// or https:// URL to fetch."
                }
            },
            "required": ["url"]
        }),
    }]
}

/// Execute one tool call against the built-in server. Only `fetch_url` exists.
pub async fn call_tool(
    client: &reqwest::Client,
    tool: &str,
    args: &serde_json::Value,
) -> anyhow::Result<String> {
    if tool != "fetch_url" {
        return Err(anyhow!("unknown built-in tool: {tool}"));
    }
    let url = args
        .get("url")
        .and_then(|u| u.as_str())
        .ok_or_else(|| anyhow!("fetch_url requires a string `url` argument"))?;
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(anyhow!("url must start with http:// or https://"));
    }

    let resp = client
        .get(url)
        .header("user-agent", "kde-llm-app/0.1 (+mcp web-browse)")
        .send()
        .await
        .context("web fetch request failed")?;
    let status = resp.status();
    if !status.is_success() {
        return Err(anyhow!("web fetch error {status} for {url}"));
    }
    let body = resp.text().await.context("reading web page body")?;
    Ok(html_to_text(&body, MAX_TEXT_LEN))
}

/// Strip HTML to readable plain text: drop `<script>`/`<style>` bodies, remove
/// the remaining tags, decode a handful of common entities, and collapse
/// whitespace. Deliberately simple (no full HTML parser dependency) and
/// length-capped. Pure, so it is unit-testable without a network.
pub fn html_to_text(html: &str, max_len: usize) -> String {
    let mut out = String::with_capacity(html.len().min(max_len) + 16);
    let bytes = html.as_bytes();
    let mut i = 0;
    let lower = html.to_ascii_lowercase();

    while i < bytes.len() {
        if bytes[i] == b'<' {
            // Skip the bodies of script/style blocks entirely.
            if let Some(skip_to) =
                skip_block(&lower, i, "script").or_else(|| skip_block(&lower, i, "style"))
            {
                i = skip_to;
                out.push(' ');
                continue;
            }
            // Otherwise drop this single tag.
            if let Some(close) = html[i..].find('>') {
                i += close + 1;
                out.push(' ');
                continue;
            }
            // Unterminated '<' — treat the rest as text.
            break;
        }
        let ch = html[i..].chars().next().unwrap_or('<');
        out.push(ch);
        i += ch.len_utf8();
    }

    let decoded = decode_entities(&out);
    let collapsed = collapse_whitespace(&decoded);
    if collapsed.len() > max_len {
        // Truncate on a char boundary.
        let mut end = max_len;
        while end > 0 && !collapsed.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &collapsed[..end])
    } else {
        collapsed
    }
}

/// If `lower[start..]` opens a `<tag ...>` for `tag`, return the index just past
/// its matching `</tag>` (or end of input if unclosed). Otherwise `None`.
fn skip_block(lower: &str, start: usize, tag: &str) -> Option<usize> {
    let open = format!("<{tag}");
    if !lower[start..].starts_with(&open) {
        return None;
    }
    // The char right after the tag name must be a tag boundary (space, >, /).
    let after = lower[start + open.len()..].chars().next();
    if !matches!(after, Some(c) if c == '>' || c == ' ' || c == '/' || c == '\t' || c == '\n') {
        return None;
    }
    let close = format!("</{tag}>");
    match lower[start..].find(&close) {
        Some(rel) => Some(start + rel + close.len()),
        None => Some(lower.len()),
    }
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

fn collapse_whitespace(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_ws = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !last_ws {
                out.push(' ');
            }
            last_ws = true;
        } else {
            out.push(ch);
            last_ws = false;
        }
    }
    out.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_tags_scripts_and_styles() {
        let html = "<html><head><style>body{color:red}</style>\
            <script>alert('x')</script></head>\
            <body><h1>Hello</h1><p>World &amp; stuff</p></body></html>";
        let text = html_to_text(html, 1000);
        assert!(text.contains("Hello"));
        assert!(text.contains("World & stuff"));
        assert!(!text.contains("color:red"));
        assert!(!text.contains("alert"));
    }

    #[test]
    fn decodes_entities_and_collapses_whitespace() {
        let html = "<p>a&nbsp;&nbsp;b   c\n\n  d</p>";
        let text = html_to_text(html, 1000);
        assert_eq!(text, "a b c d");
    }

    #[test]
    fn truncates_to_max_len_on_char_boundary() {
        let html = "<p>".to_string() + &"x".repeat(100) + "</p>";
        let text = html_to_text(&html, 10);
        assert!(text.ends_with('…'));
        assert!(text.chars().filter(|&c| c == 'x').count() <= 10);
    }

    #[test]
    fn advertises_one_tool() {
        let t = tools();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].name, "fetch_url");
    }
}
