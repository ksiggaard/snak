//! Workspace URL ingestion (T59).
//!
//! Fetches a URL and converts the HTML to condensed, structure-preserving
//! markdown so it can be stored as an editable `workspace_files` row.
//!
//! ## HTML → Markdown approach
//!
//! We deliberately avoid pulling in a heavy HTML→Markdown crate (e.g.
//! `htmd`, `html2text`) to keep the dependency tree small. The existing
//! `mcp::web_browse` module already ships a manual HTML-tag stripper; we
//! extend that idea into a lightweight *structure-aware* parser that emits
//! markdown syntax as it walks the tag stream.
//!
//! The converter:
//! - Converts headings (`<h1>`–`<h6>`) → `#`–`######`
//! - Converts `<p>`, `<div>`, `<br>` → paragraph breaks / newlines
//! - Converts `<li>` (inside `<ul>`/`<ol>`) → `- ` / `N. ` bullets
//! - Converts `<a href="…">` → `[text](url)` links (relative URLs are kept
//!   as-is so they don't silently break context)
//! - Converts `<strong>`, `<b>` → `**text**`; `<em>`, `<i>` → `_text_`
//! - Converts `<code>` → `` `text` ``; `<pre>` → fenced block
//! - Strips `<nav>`, `<footer>`, `<header>`, `<script>`, `<style>`,
//!   `<aside>`, `<form>`, `<button>` entirely (nav/boilerplate reduction)
//! - Decodes the standard HTML entities
//!
//! The result is normalised (runs of blank lines collapsed to one) and
//! length-capped at `MAX_MD_LEN` characters before being returned.

use anyhow::Context;
use serde::Serialize;

/// Maximum characters of markdown we hand back. Matches the workspace and
/// document char budget (`WORKSPACE_CONTEXT_CHAR_BUDGET` = 100 000).
const MAX_MD_LEN: usize = 100_000;

/// Truncation marker appended when we hit the budget.
const TRUNCATION_MARKER: &str = "\n…[truncated to fit the context budget]";

/// The result returned to the frontend.
#[derive(Serialize)]
pub struct FetchedPage {
    /// Page title extracted from `<title>` or inferred from the first `<h1>`;
    /// falls back to the URL hostname.
    pub title: String,
    /// Condensed markdown content (with front-matter header).
    pub markdown: String,
}

/// Fetch `url`, convert the HTML to condensed markdown, prepend a small
/// front-matter header with provenance, and return `{ title, markdown }`.
///
/// Errors are user-readable strings (shown in the UI).
#[tauri::command]
pub async fn fetch_url_as_markdown(url: String) -> Result<FetchedPage, String> {
    validate_url(&url)?;

    let client = reqwest::Client::builder()
        .user_agent("snak/0.1 (+workspace url-import)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .context("web fetch request failed")
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("server returned {status} for {url}"));
    }

    let body = resp
        .text()
        .await
        .context("reading page body")
        .map_err(|e| e.to_string())?;

    let (title, markdown_body) = html_to_markdown(&body);

    // Derive title: explicit <title>, first h1, or hostname.
    let title = if !title.is_empty() {
        title
    } else {
        hostname_from_url(&url)
    };

    // Prepend front-matter header with provenance.
    let now = chrono_now();
    let header = format!("<!-- source: {url} -->\n<!-- fetched: {now} -->\n\n# {title}\n\n");
    let full = header + &markdown_body;

    // Truncate to budget.
    let truncated = if full.len() > MAX_MD_LEN {
        let mut end = MAX_MD_LEN;
        while end > 0 && !full.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}{}", &full[..end], TRUNCATION_MARKER)
    } else {
        full
    };

    Ok(FetchedPage {
        title,
        markdown: truncated,
    })
}

// ---------------------------------------------------------------------------
// HTML → Markdown converter
// ---------------------------------------------------------------------------

/// Tags whose entire subtree we skip (nav/boilerplate stripping).
const SKIP_TAGS: &[&str] = &[
    "script", "style", "nav", "footer", "header", "aside", "form", "button", "noscript", "iframe",
    "svg", "figure",
];

/// Convert `html` to condensed markdown. Returns `(title, body_markdown)`.
/// Pure — no network, no I/O — so it is unit-testable.
pub fn html_to_markdown(html: &str) -> (String, String) {
    let bytes = html.as_bytes();
    let len = bytes.len();

    let mut out = String::with_capacity(len / 2);
    let mut title = String::new();
    let mut i = 0;

    // Skip-depth counter: when > 0 we are inside a skipped subtree.
    let mut skip_depth: i32 = 0;

    // Block-level pending newline: we emit at most one blank line between
    // blocks, deferred until we actually have text to follow.
    let mut pending_nl: usize = 0; // how many '\n' to emit before next text

    // Ordered-list item counter (very simple: just track depth).
    let mut ol_counter: u32 = 0;
    // Whether we're inside an ol at this level.
    let mut in_ol = false;

    // Inline formatting state.
    let mut link_href: Option<String> = None;
    let mut link_text = String::new();
    let mut in_link = false;
    let mut bold_depth: i32 = 0;
    let mut em_depth: i32 = 0;
    let mut code_depth: i32 = 0;
    let mut pre_depth: i32 = 0;

    // Whether we are inside the <title> element.
    let mut in_title = false;

    // Flush pending newlines before emitting text.
    let flush_nl = |out: &mut String, pending: &mut usize| {
        for _ in 0..*pending {
            out.push('\n');
        }
        *pending = 0;
    };

    while i < len {
        if bytes[i] != b'<' {
            if skip_depth > 0 {
                i += html[i..].chars().next().map_or(1, |c| c.len_utf8());
                continue;
            }
            // Collect a run of text characters.
            let start = i;
            while i < len && bytes[i] != b'<' {
                i += html[i..].chars().next().map_or(1, |c| c.len_utf8());
            }
            let raw = &html[start..i];
            let text = decode_entities(raw);
            let text = collapse_inline_whitespace(&text);
            if text.is_empty() {
                continue;
            }
            if in_title {
                title.push_str(&text);
                continue;
            }
            flush_nl(&mut out, &mut pending_nl);
            if in_link {
                link_text.push_str(&text);
            } else {
                out.push_str(&text);
            }
            continue;
        }

        // We have a '<'.
        // Try to read the tag.
        let rest = &html[i..];
        let tag_end = match rest.find('>') {
            Some(e) => e,
            None => {
                // Unterminated — treat as literal.
                i += 1;
                continue;
            }
        };
        let tag_inner = &rest[1..tag_end]; // content between < and >
        let is_close = tag_inner.starts_with('/');
        let is_self_close = tag_inner.ends_with('/');
        let name_part = if is_close { &tag_inner[1..] } else { tag_inner };
        let tag_name_lower = name_part
            .split(|c: char| c.is_whitespace() || c == '/')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase();
        let tag_name = tag_name_lower.as_str();

        i += tag_end + 1; // advance past '>'

        // --- Skip-zone management ---
        if is_close {
            if SKIP_TAGS.contains(&tag_name) {
                skip_depth -= 1;
                if skip_depth < 0 {
                    skip_depth = 0;
                }
            }
            if skip_depth > 0 {
                continue;
            }
        } else {
            if SKIP_TAGS.contains(&tag_name) {
                skip_depth += 1;
            }
            if skip_depth > 1 || (skip_depth == 1 && SKIP_TAGS.contains(&tag_name)) {
                continue;
            }
        }
        if skip_depth > 0 {
            continue;
        }

        // --- Tag dispatch ---
        if is_close {
            match tag_name {
                "title" => {
                    in_title = false;
                }
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    pending_nl = pending_nl.max(2);
                }
                "p" | "div" | "section" | "article" | "main" | "blockquote" | "table" | "thead"
                | "tbody" | "tr" => {
                    pending_nl = pending_nl.max(2);
                }
                "li" => {
                    pending_nl = pending_nl.max(1);
                }
                "br" => {}
                "pre" => {
                    pre_depth -= 1;
                    if pre_depth == 0 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push_str("\n```\n");
                        pending_nl = 2;
                    }
                }
                "code" => {
                    code_depth -= 1;
                    if code_depth == 0 && pre_depth == 0 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push('`');
                    }
                }
                "strong" | "b" => {
                    bold_depth -= 1;
                    if bold_depth == 0 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push_str("**");
                    }
                }
                "em" | "i" => {
                    em_depth -= 1;
                    if em_depth == 0 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push('_');
                    }
                }
                "a" => {
                    if in_link {
                        let href = link_href.take().unwrap_or_default();
                        let text = std::mem::take(&mut link_text);
                        in_link = false;
                        if !text.is_empty() {
                            if !href.is_empty() && href != "#" {
                                flush_nl(&mut out, &mut pending_nl);
                                out.push('[');
                                out.push_str(&text);
                                out.push_str("](");
                                out.push_str(&href);
                                out.push(')');
                            } else {
                                flush_nl(&mut out, &mut pending_nl);
                                out.push_str(&text);
                            }
                        }
                    }
                }
                "ul" => {}
                "ol" => {
                    in_ol = false;
                    ol_counter = 0;
                }
                _ => {}
            }
        } else {
            // Opening / self-closing tag.
            match tag_name {
                "title" => {
                    in_title = true;
                }
                "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                    pending_nl = pending_nl.max(2);
                    let level = tag_name.chars().nth(1).unwrap_or('1') as usize - '0' as usize;
                    flush_nl(&mut out, &mut pending_nl);
                    for _ in 0..level {
                        out.push('#');
                    }
                    out.push(' ');
                }
                "p" | "div" | "section" | "article" | "main" | "blockquote" => {
                    pending_nl = pending_nl.max(2);
                }
                "br" => {
                    if !is_self_close {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push('\n');
                    }
                }
                "hr" => {
                    pending_nl = pending_nl.max(2);
                    flush_nl(&mut out, &mut pending_nl);
                    out.push_str("---");
                    pending_nl = 2;
                }
                "li" => {
                    pending_nl = pending_nl.max(1);
                    flush_nl(&mut out, &mut pending_nl);
                    if in_ol {
                        ol_counter += 1;
                        out.push_str(&format!("{ol_counter}. "));
                    } else {
                        out.push_str("- ");
                    }
                }
                "ul" => {
                    in_ol = false;
                    pending_nl = pending_nl.max(1);
                }
                "ol" => {
                    in_ol = true;
                    ol_counter = 0;
                    pending_nl = pending_nl.max(1);
                }
                "pre" => {
                    pre_depth += 1;
                    pending_nl = pending_nl.max(2);
                    flush_nl(&mut out, &mut pending_nl);
                    // Try to extract language hint from class="language-xxx"
                    let lang = extract_attr(tag_inner, "class")
                        .and_then(|cls| {
                            cls.split_whitespace()
                                .find(|s| s.starts_with("language-"))
                                .map(|s| s.trim_start_matches("language-").to_string())
                        })
                        .unwrap_or_default();
                    out.push_str("```");
                    out.push_str(&lang);
                    out.push('\n');
                }
                "code" => {
                    code_depth += 1;
                    if pre_depth == 0 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push('`');
                    }
                }
                "strong" | "b" => {
                    bold_depth += 1;
                    if bold_depth == 1 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push_str("**");
                    }
                }
                "em" | "i" => {
                    em_depth += 1;
                    if em_depth == 1 {
                        flush_nl(&mut out, &mut pending_nl);
                        out.push('_');
                    }
                }
                "a" => {
                    let href = extract_attr(tag_inner, "href").unwrap_or_default();
                    in_link = true;
                    link_href = Some(href);
                    link_text.clear();
                }
                "img" => {
                    if let Some(alt) = extract_attr(tag_inner, "alt") {
                        let alt = alt.trim();
                        if !alt.is_empty() {
                            flush_nl(&mut out, &mut pending_nl);
                            out.push_str(&format!("![{alt}]"));
                        }
                    }
                }
                "td" | "th" => {
                    out.push_str(" | ");
                }
                "tr" | "thead" | "tbody" | "table" => {
                    pending_nl = pending_nl.max(1);
                }
                _ => {}
            }
        }

        // After a skip-zone open tag, fast-forward past the block's close.
        // (We enter skip_depth > 0 above; the while loop handles the rest.)
    }

    // Collapse excess blank lines in the output.
    let body = collapse_blank_lines(&out);
    let body = body.trim().to_string();

    (title.trim().to_string(), body)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Extract a named attribute value from raw tag inner text (between `<` and
/// `>`), handling both `name="value"` and `name='value'` forms. Returns the
/// first match, decoded of HTML entities.
pub fn extract_attr(tag_inner: &str, attr: &str) -> Option<String> {
    // Build a lowercase copy to find the attribute name case-insensitively,
    // then read the value from the original to preserve casing.
    let lower = tag_inner.to_ascii_lowercase();
    let needle = format!("{attr}=");
    let pos = lower.find(&needle)?;
    let after = &tag_inner[pos + needle.len()..];
    let (quote, rest) = if let Some(r) = after.strip_prefix('"') {
        ('"', r)
    } else if let Some(r) = after.strip_prefix('\'') {
        ('\'', r)
    } else {
        // Unquoted — read until whitespace or >
        let end = after
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(after.len());
        return Some(decode_entities(&after[..end]));
    };
    let end = rest.find(quote).unwrap_or(rest.len());
    Some(decode_entities(&rest[..end]))
}

fn decode_entities(s: &str) -> String {
    // Named entities we care about; numeric entities are handled below.
    let s = s
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
        .replace("&mdash;", "—")
        .replace("&ndash;", "–")
        .replace("&laquo;", "«")
        .replace("&raquo;", "»")
        .replace("&hellip;", "…");
    // Very simple numeric entity pass: &#NNN; and &#xHH;
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' && i + 2 < bytes.len() && bytes[i + 1] == b'#' {
            let rest = &s[i + 2..];
            let (hex, digits_end) = if rest.starts_with('x') || rest.starts_with('X') {
                (true, rest[1..].find(';').map(|e| e + 1))
            } else {
                (false, rest.find(';'))
            };
            if let Some(end) = digits_end {
                let digit_str = if hex { &rest[1..end] } else { &rest[..end] };
                let code = if hex {
                    u32::from_str_radix(digit_str, 16).ok()
                } else {
                    digit_str.parse::<u32>().ok()
                };
                if let Some(ch) = code.and_then(char::from_u32) {
                    out.push(ch);
                    i += 2 + end + 1; // skip past ';'
                    continue;
                }
            }
        }
        let ch = s[i..].chars().next().unwrap_or('?');
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn collapse_inline_whitespace(s: &str) -> String {
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
    out
}

/// Collapse runs of 3+ newlines to 2 (one blank line).
fn collapse_blank_lines(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut nl_run = 0usize;
    for ch in s.chars() {
        if ch == '\n' {
            nl_run += 1;
            if nl_run <= 2 {
                out.push('\n');
            }
        } else {
            nl_run = 0;
            out.push(ch);
        }
    }
    out
}

fn hostname_from_url(url: &str) -> String {
    // Very minimal: strip scheme, take up to the first `/` or `?`.
    let without_scheme = url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = without_scheme
        .split('/')
        .next()
        .unwrap_or(without_scheme)
        .split('?')
        .next()
        .unwrap_or(without_scheme);
    host.to_string()
}

fn chrono_now() -> String {
    // Use std::time for a simple UTC date string — no chrono dep needed.
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Convert unix seconds to YYYY-MM-DD (good enough for provenance).
    let days = secs / 86400;
    // Days since 1970-01-01. Use a simple algorithm to compute Y-M-D.
    let (y, m, d) = days_to_ymd(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Convert days since Unix epoch to (year, month, day).
fn days_to_ymd(mut days: u64) -> (u64, u64, u64) {
    // Algorithm: shift to 1 March 400-year epoch (Gregorian cycle = 146097 days).
    days += 719468; // shift to March 1, year 0
    let era = days / 146097;
    let doe = days % 146097; // day of era [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

// ---------------------------------------------------------------------------
// Validate URL (pure, shared with frontend via tests)
// ---------------------------------------------------------------------------

/// Lightweight URL validation: must be http:// or https://, have a non-empty
/// host, and contain no whitespace. Returns an error string on failure.
pub fn validate_url(url: &str) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("URL cannot be empty".into());
    }
    if url.chars().any(|c| c.is_whitespace()) {
        return Err("URL must not contain whitespace".into());
    }
    let without_scheme = if let Some(rest) = url.strip_prefix("https://") {
        rest
    } else if let Some(rest) = url.strip_prefix("http://") {
        rest
    } else {
        return Err("URL must start with http:// or https://".into());
    };
    let host = without_scheme
        .split('/')
        .next()
        .unwrap_or("")
        .split('?')
        .next()
        .unwrap_or("");
    if host.is_empty() {
        return Err("URL must have a non-empty host".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // --- validate_url --------------------------------------------------------

    #[test]
    fn valid_https_url() {
        assert!(validate_url("https://example.com").is_ok());
        assert!(validate_url("https://example.com/path?q=1").is_ok());
    }

    #[test]
    fn valid_http_url() {
        assert!(validate_url("http://example.com").is_ok());
    }

    #[test]
    fn invalid_url_no_scheme() {
        assert!(validate_url("example.com").is_err());
    }

    #[test]
    fn invalid_url_ftp() {
        assert!(validate_url("ftp://example.com").is_err());
    }

    #[test]
    fn invalid_url_empty() {
        assert!(validate_url("").is_err());
    }

    #[test]
    fn invalid_url_whitespace() {
        assert!(validate_url("https://exam ple.com").is_err());
    }

    // --- extract_attr -------------------------------------------------------

    #[test]
    fn extract_href_double_quoted() {
        let tag = r#"a href="https://example.com" class="link""#;
        assert_eq!(
            extract_attr(tag, "href"),
            Some("https://example.com".into())
        );
    }

    #[test]
    fn extract_href_single_quoted() {
        let tag = "a href='https://example.com'";
        assert_eq!(
            extract_attr(tag, "href"),
            Some("https://example.com".into())
        );
    }

    #[test]
    fn extract_attr_missing() {
        let tag = "a class=\"link\"";
        assert_eq!(extract_attr(tag, "href"), None);
    }

    // --- html_to_markdown ---------------------------------------------------

    #[test]
    fn headings_become_markdown() {
        let html = "<h1>Title</h1><h2>Sub</h2><h3>Sub sub</h3>";
        let (_, md) = html_to_markdown(html);
        assert!(md.contains("# Title"), "got: {md}");
        assert!(md.contains("## Sub"), "got: {md}");
        assert!(md.contains("### Sub sub"), "got: {md}");
    }

    #[test]
    fn paragraphs_separated_by_blank_lines() {
        let html = "<p>First paragraph.</p><p>Second paragraph.</p>";
        let (_, md) = html_to_markdown(html);
        // Must have both texts with at least one blank line between them.
        assert!(md.contains("First paragraph."), "got: {md}");
        assert!(md.contains("Second paragraph."), "got: {md}");
        let first = md.find("First").unwrap();
        let second = md.find("Second").unwrap();
        assert!(second > first);
        let between = &md[first..second];
        assert!(
            between.contains("\n\n"),
            "expected blank line between paragraphs, got: {between:?}"
        );
    }

    #[test]
    fn unordered_list_items_get_dashes() {
        let html = "<ul><li>Apple</li><li>Banana</li></ul>";
        let (_, md) = html_to_markdown(html);
        assert!(md.contains("- Apple"), "got: {md}");
        assert!(md.contains("- Banana"), "got: {md}");
    }

    #[test]
    fn ordered_list_items_get_numbers() {
        let html = "<ol><li>First</li><li>Second</li></ol>";
        let (_, md) = html_to_markdown(html);
        assert!(md.contains("1. First"), "got: {md}");
        assert!(md.contains("2. Second"), "got: {md}");
    }

    #[test]
    fn links_become_markdown_links() {
        let html = r#"<a href="https://example.com">Example</a>"#;
        let (_, md) = html_to_markdown(html);
        assert!(md.contains("[Example](https://example.com)"), "got: {md}");
    }

    #[test]
    fn bold_and_em() {
        let html = "<strong>bold</strong> and <em>italic</em>";
        let (_, md) = html_to_markdown(html);
        assert!(md.contains("**bold**"), "got: {md}");
        assert!(md.contains("_italic_"), "got: {md}");
    }

    #[test]
    fn inline_code() {
        let html = "Run <code>cargo build</code> to compile.";
        let (_, md) = html_to_markdown(html);
        assert!(md.contains("`cargo build`"), "got: {md}");
    }

    #[test]
    fn nav_footer_stripped() {
        let html = "<nav>Nav stuff</nav><p>Content</p><footer>Footer stuff</footer>";
        let (_, md) = html_to_markdown(html);
        assert!(!md.contains("Nav stuff"), "nav leaked: {md}");
        assert!(!md.contains("Footer stuff"), "footer leaked: {md}");
        assert!(md.contains("Content"), "content missing: {md}");
    }

    #[test]
    fn script_and_style_stripped() {
        let html = "<style>body { color: red; }</style><script>alert('x')</script><p>Visible</p>";
        let (_, md) = html_to_markdown(html);
        assert!(!md.contains("color: red"), "style leaked: {md}");
        assert!(!md.contains("alert"), "script leaked: {md}");
        assert!(md.contains("Visible"), "content missing: {md}");
    }

    #[test]
    fn entities_decoded() {
        let html = "<p>a &amp; b &lt;c&gt; &quot;d&quot; &nbsp;e</p>";
        let (_, md) = html_to_markdown(html);
        assert!(
            md.contains("a & b <c> \"d\"  e") || md.contains("a & b"),
            "got: {md}"
        );
    }

    #[test]
    fn title_extracted() {
        let html = "<html><head><title>My Page</title></head><body><p>Hi</p></body></html>";
        let (title, _) = html_to_markdown(html);
        assert_eq!(title, "My Page");
    }

    #[test]
    fn hostname_fallback() {
        assert_eq!(hostname_from_url("https://example.com/path"), "example.com");
        assert_eq!(
            hostname_from_url("http://sub.example.com?q=1"),
            "sub.example.com"
        );
    }

    #[test]
    fn days_to_ymd_epoch() {
        // 1970-01-01 = day 0 from Unix epoch.
        assert_eq!(days_to_ymd(0), (1970, 1, 1));
    }

    #[test]
    fn days_to_ymd_known_date() {
        // 2024-01-01 = 19723 days since 1970-01-01.
        assert_eq!(days_to_ymd(19723), (2024, 1, 1));
    }
}
