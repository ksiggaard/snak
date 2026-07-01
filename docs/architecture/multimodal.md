# Multimodal images

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- Images are attached in `Composer` (file picker / paste / drag-drop), downscaled + re-encoded to JPEG client-side by `src/lib/image.ts` (`prepareImage`, max 1568px), stored **base64 in the `attachments` table** (`kind = "image"`), and sent with the user message.
- `src/lib/messages.ts` defines `MessageView` (a `Message` + its `images`) and `loadThreadMessages` (joins attachments onto user messages); the store's `messages` are `MessageView[]`, and API history carries `images`.
- API shape: `ChatMessage` (Rust) and `ApiMessage` (TS) have an `images: [{ media_type, data }]` field. **Nested command-arg fields are NOT camelCase-converted by Tauri** — only top-level args are — so these are sent snake_case (`media_type`). Per-provider encoding: Anthropic `image` blocks (`source.type=base64`), OpenAI/Mistral `image_url` data URLs, Gemini `inline_data`.
