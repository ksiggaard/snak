//! Document text extraction for chat attachments (T39).
//!
//! The frontend sends a base64-encoded file + its original name; we return the
//! plain text so it can be embedded in the message sent to the provider.
//! Extraction runs in Rust (not the webview) because the parsers are native
//! crates and the work is CPU-bound — it runs on a blocking thread so the
//! async runtime stays responsive.
//!
//! Crate choices:
//! - **pdf-extract** — pure-Rust PDF text extraction (no poppler/system deps).
//!   It can panic on exotic PDFs, so the call is wrapped in `catch_unwind`.
//! - **zip + quick-xml** — docx/pptx/odt/odp are all "zip of XML" formats;
//!   we stream the relevant XML part(s) and accumulate text events, which is
//!   far lighter than a full DOM or a per-format document crate.
//! - **calamine** — battle-tested reader for spreadsheet formats; one auto
//!   reader covers both xlsx and ods.
//!
//! Legacy binary `.doc`/`.ppt` (pre-OOXML, OLE compound files) are out of
//! scope: the frontend classifies attachments and never calls this command
//! for them.

use std::io::{Cursor, Read};

use base64::{engine::general_purpose::STANDARD, Engine};
use calamine::Reader as _;
use quick_xml::events::Event;

/// Supported document formats, detected from the file extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocFormat {
    Pdf,
    Docx,
    Pptx,
    Odt,
    Odp,
    Xlsx,
    Ods,
}

impl DocFormat {
    /// The canonical extension (without the dot), used in error messages.
    fn ext(self) -> &'static str {
        match self {
            DocFormat::Pdf => "pdf",
            DocFormat::Docx => "docx",
            DocFormat::Pptx => "pptx",
            DocFormat::Odt => "odt",
            DocFormat::Odp => "odp",
            DocFormat::Xlsx => "xlsx",
            DocFormat::Ods => "ods",
        }
    }
}

/// Map a file name to its document format by extension (case-insensitive).
/// `None` for anything unsupported (including extension-less names).
pub fn detect_format(file_name: &str) -> Option<DocFormat> {
    let ext = file_name.rsplit_once('.')?.1.to_ascii_lowercase();
    match ext.as_str() {
        "pdf" => Some(DocFormat::Pdf),
        "docx" => Some(DocFormat::Docx),
        "pptx" => Some(DocFormat::Pptx),
        "odt" => Some(DocFormat::Odt),
        "odp" => Some(DocFormat::Odp),
        "xlsx" => Some(DocFormat::Xlsx),
        "ods" => Some(DocFormat::Ods),
        _ => None,
    }
}

/// Extract plain text from `bytes` according to `format`. Pure dispatch; the
/// result is whitespace-normalized.
pub fn extract_text(bytes: &[u8], format: DocFormat) -> Result<String, String> {
    let text = match format {
        DocFormat::Pdf => extract_pdf(bytes)?,
        DocFormat::Docx | DocFormat::Pptx | DocFormat::Odt | DocFormat::Odp => {
            extract_zip_xml(bytes, format)?
        }
        DocFormat::Xlsx | DocFormat::Ods => extract_spreadsheet(bytes, format)?,
    };
    Ok(normalize_text(&text))
}

/// PDF text via pdf-extract. The crate can panic (not just error) on exotic
/// PDFs, so the call runs under `catch_unwind` and a panic becomes a normal,
/// user-readable error.
fn extract_pdf(bytes: &[u8]) -> Result<String, String> {
    match std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes)) {
        Ok(Ok(text)) => Ok(text),
        Ok(Err(e)) => Err(format!("couldn't read .pdf content: {e}")),
        Err(_) => Err("couldn't read .pdf content: the PDF parser crashed on this file".into()),
    }
}

/// The "zip of XML" formats: docx, pptx, odt, odp. Opens the container,
/// streams the format's content part(s) through `xml_to_text`.
fn extract_zip_xml(bytes: &[u8], format: DocFormat) -> Result<String, String> {
    let ext = format.ext();
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("couldn't read .{ext} content: not a valid {ext} archive ({e})"))?;

    // Read one named part out of the archive into a buffer.
    let read_part =
        |archive: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str| -> Result<Vec<u8>, String> {
            let mut file = archive
                .by_name(name)
                .map_err(|_| format!("couldn't read .{ext} content: missing {name}"))?;
            let mut buf = Vec::new();
            file.read_to_end(&mut buf)
                .map_err(|e| format!("couldn't read .{ext} content: {name}: {e}"))?;
            Ok(buf)
        };

    match format {
        DocFormat::Docx => xml_to_text(&read_part(&mut archive, "word/document.xml")?, format),
        DocFormat::Odt | DocFormat::Odp => {
            xml_to_text(&read_part(&mut archive, "content.xml")?, format)
        }
        DocFormat::Pptx => {
            // Collect ppt/slides/slideN.xml and sort by N numerically — lexical
            // order would put slide10 before slide2.
            let mut slides: Vec<(u32, String)> = archive
                .file_names()
                .filter_map(|name| {
                    let n = name
                        .strip_prefix("ppt/slides/slide")?
                        .strip_suffix(".xml")?
                        .parse()
                        .ok()?;
                    Some((n, name.to_string()))
                })
                .collect();
            if slides.is_empty() {
                return Err(format!(
                    "couldn't read .{ext} content: no slides (ppt/slides/slideN.xml) found"
                ));
            }
            slides.sort_unstable_by_key(|(n, _)| *n);

            let mut out = String::new();
            for (i, (n, name)) in slides.iter().enumerate() {
                if i > 0 {
                    out.push_str(&format!("\n\n--- Slide {n} ---\n"));
                }
                out.push_str(&xml_to_text(&read_part(&mut archive, name)?, format)?);
            }
            Ok(out)
        }
        _ => unreachable!("extract_zip_xml only handles zip-of-XML formats"),
    }
}

/// "couldn't read .{ext} content: invalid XML: {e}" — for any quick-xml error.
fn xml_err(ext: &str, e: impl std::fmt::Display) -> String {
    format!("couldn't read .{ext} content: invalid XML: {e}")
}

/// Is `name` a text-bearing element for `format`? Text events are only
/// captured inside one of these, so markup whitespace (indentation between
/// structural tags) never leaks into the output. OOXML keeps text in dedicated
/// leaf elements; ODF paragraphs/headings hold mixed content directly.
fn is_text_container(name: &[u8], format: DocFormat) -> bool {
    match format {
        DocFormat::Docx => name == b"w:t",
        DocFormat::Pptx => name == b"a:t",
        DocFormat::Odt | DocFormat::Odp => name == b"text:p" || name == b"text:h",
        _ => false,
    }
}

/// Stream one XML part and accumulate its text content. Paragraph-end elements
/// become newlines, tabs/line-breaks their literal characters; everything else
/// (formatting, properties) is skipped.
fn xml_to_text(xml: &[u8], format: DocFormat) -> Result<String, String> {
    let ext = format.ext();

    let mut reader = quick_xml::Reader::from_reader(xml);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut depth = 0u32; // nesting depth of text-bearing elements
    loop {
        match reader
            .read_event_into(&mut buf)
            .map_err(|e| xml_err(ext, e))?
        {
            Event::Eof => break,
            Event::Text(t) if depth > 0 => out.push_str(&t.decode().map_err(|e| xml_err(ext, e))?),
            // Entity / character references (`&amp;`, `&#10;`, …) arrive as
            // separate events in quick-xml; resolve the standard ones.
            Event::GeneralRef(r) if depth > 0 => {
                if let Some(ch) = r.resolve_char_ref().map_err(|e| xml_err(ext, e))? {
                    out.push(ch);
                } else if let Some(s) = quick_xml::escape::resolve_predefined_entity(
                    &r.decode().map_err(|e| xml_err(ext, e))?,
                ) {
                    out.push_str(s);
                }
            }
            Event::Start(e) => {
                let name = e.name();
                if is_text_container(name.as_ref(), format) {
                    depth += 1;
                }
                match name.as_ref() {
                    b"w:tab" | b"text:tab" => out.push('\t'),
                    b"w:br" | b"text:line-break" => out.push('\n'),
                    _ => {}
                }
            }
            Event::End(e) => {
                let name = e.name();
                if is_text_container(name.as_ref(), format) {
                    depth = depth.saturating_sub(1);
                }
                // Paragraph (and heading) ends → newline.
                if matches!(name.as_ref(), b"w:p" | b"a:p" | b"text:p" | b"text:h") {
                    out.push('\n');
                }
            }
            // Tabs and explicit line breaks are usually empty elements.
            Event::Empty(e) => match e.name().as_ref() {
                b"w:tab" | b"text:tab" => out.push('\t'),
                b"w:br" | b"text:line-break" => out.push('\n'),
                _ => {}
            },
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

/// Spreadsheets (xlsx, ods) via calamine's auto-detecting reader. Each sheet
/// gets a header line, then its rows as tab-joined cell display strings.
fn extract_spreadsheet(bytes: &[u8], format: DocFormat) -> Result<String, String> {
    let ext = format.ext();
    let mut workbook = calamine::open_workbook_auto_from_rs(Cursor::new(bytes))
        .map_err(|e| format!("couldn't read .{ext} content: {e}"))?;

    let mut out = String::new();
    for name in workbook.sheet_names() {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|e| format!("couldn't read .{ext} content: sheet {name}: {e}"))?;
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("--- Sheet: {name} ---\n"));
        for row in range.rows() {
            let line: Vec<String> = row.iter().map(|cell| cell.to_string()).collect();
            out.push_str(&line.join("\t"));
            out.push('\n');
        }
    }
    Ok(out)
}

/// Collapse runs of 3+ newlines to 2 (one blank line) and trim the ends —
/// extracted documents tend to be riddled with empty paragraphs.
fn normalize_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut newlines = 0usize;
    for ch in s.chars() {
        if ch == '\n' {
            newlines += 1;
            if newlines <= 2 {
                out.push(ch);
            }
        } else {
            newlines = 0;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

/// Extract plain text from a base64-encoded document. The format is detected
/// from `file_name`'s extension; parsing runs on a blocking thread. Errors are
/// user-readable strings (shown in the UI by the frontend).
#[tauri::command]
pub async fn extract_document_text(data_b64: String, file_name: String) -> Result<String, String> {
    let bytes = STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| format!("couldn't decode {file_name}: invalid base64 data ({e})"))?;
    let format = detect_format(&file_name)
        .ok_or_else(|| format!("unsupported document format: {file_name}"))?;
    tokio::task::spawn_blocking(move || extract_text(&bytes, format))
        .await
        .map_err(|e| format!("document extraction failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build an in-memory zip from `(name, content)` parts.
    fn make_zip(parts: &[(&str, &str)]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        for (name, content) in parts {
            writer.start_file(*name, options).unwrap();
            writer.write_all(content.as_bytes()).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn detect_format_by_extension() {
        assert_eq!(detect_format("a.PDF"), Some(DocFormat::Pdf)); // case-insensitive
        assert_eq!(detect_format("report.pdf"), Some(DocFormat::Pdf));
        assert_eq!(detect_format("letter.docx"), Some(DocFormat::Docx));
        assert_eq!(detect_format("deck.pptx"), Some(DocFormat::Pptx));
        assert_eq!(detect_format("notes.odt"), Some(DocFormat::Odt));
        assert_eq!(detect_format("slides.odp"), Some(DocFormat::Odp));
        assert_eq!(detect_format("table.xlsx"), Some(DocFormat::Xlsx));
        assert_eq!(detect_format("table.ods"), Some(DocFormat::Ods));
        assert_eq!(detect_format("x.doc"), None); // legacy binary: out of scope
        assert_eq!(detect_format("noext"), None);
    }

    #[test]
    fn docx_paragraphs() {
        let document = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello</w:t></w:r></w:p>
    <w:p><w:r><w:t>world</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let zip = make_zip(&[("word/document.xml", document)]);
        assert_eq!(extract_text(&zip, DocFormat::Docx).unwrap(), "Hello\nworld");
    }

    #[test]
    fn pptx_slides_in_numeric_order_with_separator() {
        let slide = |text: &str| {
            format!(
                r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>"#
            )
        };
        // slide2 written BEFORE slide1: ordering must come from the parsed
        // number, not the archive (or lexical) order.
        let zip = make_zip(&[
            ("ppt/slides/slide2.xml", &slide("Second")),
            ("ppt/slides/slide1.xml", &slide("First")),
        ]);
        let text = extract_text(&zip, DocFormat::Pptx).unwrap();
        assert!(text.contains("--- Slide 2 ---"));
        let first = text.find("First").unwrap();
        let second = text.find("Second").unwrap();
        assert!(first < second, "slide 1 text must precede slide 2: {text}");
    }

    #[test]
    fn odt_paragraphs() {
        let content = r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
  <office:body><office:text>
    <text:p>Alpha</text:p>
    <text:p>Beta</text:p>
  </office:text></office:body>
</office:document-content>"#;
        let zip = make_zip(&[("content.xml", content)]);
        assert_eq!(extract_text(&zip, DocFormat::Odt).unwrap(), "Alpha\nBeta");
    }

    /// Minimal hand-rolled xlsx (OOXML zip) with inlineStr cells — enough
    /// structure for calamine to parse it without committing a binary fixture.
    fn make_xlsx() -> Vec<u8> {
        let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;
        let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;
        let workbook = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#;
        let workbook_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;
        let sheet = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>a</t></is></c>
      <c r="B1" t="inlineStr"><is><t>b</t></is></c>
    </row>
  </sheetData>
</worksheet>"#;
        make_zip(&[
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", rels),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_rels),
            ("xl/worksheets/sheet1.xml", sheet),
        ])
    }

    #[test]
    fn xlsx_rows_tab_joined_with_sheet_header() {
        let text = extract_text(&make_xlsx(), DocFormat::Xlsx).unwrap();
        assert!(text.contains("--- Sheet: Data ---"), "header line: {text}");
        assert!(text.contains("a\tb"), "tab-joined row: {text}");
    }

    /// Build a minimal but well-formed PDF (catalog → pages → page → content
    /// stream) with a correct xref table, computing object offsets as we go.
    fn make_pdf() -> Vec<u8> {
        let stream = "BT /F1 12 Tf (Hello PDF) Tj ET";
        let objects = [
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n".to_string(),
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n".to_string(),
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] \
             /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
                .to_string(),
            "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n".to_string(),
            format!(
                "5 0 obj\n<< /Length {} >>\nstream\n{stream}\nendstream\nendobj\n",
                stream.len()
            ),
        ];

        let mut pdf = String::from("%PDF-1.4\n");
        let mut offsets = Vec::new();
        for obj in &objects {
            offsets.push(pdf.len());
            pdf.push_str(obj);
        }
        let xref_pos = pdf.len();
        pdf.push_str(&format!("xref\n0 {}\n", objects.len() + 1));
        pdf.push_str("0000000000 65535 f \n");
        for off in offsets {
            pdf.push_str(&format!("{off:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n",
            objects.len() + 1
        ));
        pdf.into_bytes()
    }

    #[test]
    fn pdf_text() {
        let text = extract_text(&make_pdf(), DocFormat::Pdf).unwrap();
        assert!(text.contains("Hello PDF"), "extracted: {text:?}");
    }

    #[test]
    fn garbage_bytes_error_mentions_format() {
        let garbage = b"\x00\x01garbage, definitely not a document\xff\xfe";
        for format in [
            DocFormat::Pdf,
            DocFormat::Docx,
            DocFormat::Pptx,
            DocFormat::Odt,
            DocFormat::Odp,
            DocFormat::Xlsx,
            DocFormat::Ods,
        ] {
            let err = extract_text(garbage, format).unwrap_err();
            assert!(
                err.contains(format.ext()),
                "error for {format:?} should mention .{}: {err}",
                format.ext()
            );
        }
    }

    #[test]
    fn normalize_collapses_newline_runs_and_trims() {
        assert_eq!(normalize_text("\n\na\n\n\n\nb\nc\n"), "a\n\nb\nc");
        assert_eq!(normalize_text("  spaced  "), "spaced");
        assert_eq!(normalize_text(""), "");
    }
}
