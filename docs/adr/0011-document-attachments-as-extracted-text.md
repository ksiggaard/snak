# ADR-0011: Document attachments inject extracted text everywhere

* Status: accepted
* Deciders: snak core team
* Date: 2026-06-30

## Context and Problem Statement

Beyond images, snak accepts document attachments — pdf, docx, pptx, odt, odp, xlsx, ods, plus clear-text/code files. Providers vary wildly in native document support: Anthropic can take a PDF natively, most OpenAI-compatible endpoints cannot, and Gemini differs again. We had to decide how a document reaches the model: as a provider-native document part (per-provider), or as plain text extracted once and injected uniformly.

## Decision Drivers

* Works identically across every provider (the active provider is user-chosen, [ADR-0010](./0010-cloud-providers-are-user-added-custom-providers.md))
* Keep provider modules untouched — no per-provider document encoding to maintain
* Bounded context cost — a large document must not blow the window
* Implementation cost for a v1

## Considered Options

* **Option 1:** Extract every document to plain text once and inject it as labeled fenced blocks in the message `content`, uniformly for all providers
* **Option 2:** Per-provider native document parts (Anthropic PDF blocks, etc.), falling back to text where unsupported

## Decision Outcome

Chosen option: **Option 1 — extracted-text-everywhere**, because it works on every provider through a single seam and leaves the provider modules ([ADR-0002](./0002-provider-calls-in-rust-over-http.md)) entirely unaware of documents. Clear-text/code files are read directly (`file.text()`); binary formats are parsed to plain text by the Rust command `extract_document_text` (`src-tauri/src/commands/documents.rs`; crates `pdf-extract`, `zip`+`quick-xml`, `calamine`). Legacy `.doc`/`.ppt`/`.xls` are rejected with a "save as .docx/…" message; classification is extension-based (`classifyFile`, `src/lib/documents.ts`) because `File.type` is empty for code files. Extracted text is stored as an `attachments` row (`kind = "document"`, text in `data`, name in `filename`; migration `012`), budget-capped (20 MB pre-extraction, 100k chars per document after, `DOCUMENT_CHAR_BUDGET`). Injection happens in **one** place: `compactHistory`'s MessageView→ApiMessage mapping appends labeled fenced blocks via `appendDocumentsToContent`, so the text rides in message `content` and providers are untouched. Anthropic's native PDF input is deliberately deferred.

### Consequences

* **Positive:** Documents work on every provider with no per-provider code; the entire feature lives behind one mapping seam plus one extraction command. Cost is bounded by explicit budgets. Attachment text is intentionally left out of the FTS index (it's reference material, not searchable history).
* **Negative:** Extraction is lossy — layout, tables, and images in a PDF degrade to plain text, and we forgo richer provider-native document understanding (notably Anthropic's PDF input). Extraction quality is only as good as the crates, and very large documents are truncated at the char budget (with a marker). Revisiting native PDF for Anthropic is future work.

## Pros and Cons of the Options

### Option 1 — Extracted text everywhere

* **Good:** Identical behavior on every provider; provider modules stay document-unaware.
* **Good:** One injection seam + one extraction command; explicit, bounded context cost.
* **Bad:** Lossy (no layout/tables/images); no provider-native document understanding.

### Option 2 — Per-provider native document parts

* **Good:** Best fidelity where supported (e.g. Anthropic PDF).
* **Bad:** Per-provider encoding to build and maintain, with a text fallback anyway for the providers that can't — more code for a partial win; deferred.
