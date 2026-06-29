// Provider presets surfaced in the Custom Providers settings tab.
//
// The app ships with no cloud providers; presets are ready-to-add templates so a
// user can configure a well-known provider without looking up its base URL or
// model id. Picking one pre-fills the add form and pins the canonical id +
// protocol. Cloud presets deliberately reuse the ids the providers had when they
// were built in (`anthropic`, `openai`, `mistral`, `gemini`) so an existing
// keychain key and prior threads keep resolving after the migration.

import type { ProviderProtocol } from "@/lib/db";

/** A ready-to-add provider template. */
export interface ProviderPreset {
  /** Canonical id reused as the provider id. */
  id: string;
  label: string;
  protocol: ProviderProtocol;
  /** API base URL. OpenAI-compatible → `{baseUrl}/chat/completions`; anthropic →
   * `{baseUrl}/v1/messages`; gemini → `{baseUrl}/{model}:streamGenerateContent`. */
  baseUrl: string;
  defaultModel: string;
  /** Placeholder shown in the key input. */
  keyHint: string;
}

/** Curated presets: the four cloud providers that used to be built in, plus a few
 * popular OpenAI-compatible gateways. Array order is display order. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    protocol: "anthropic",
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-opus-4-8",
    keyHint: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    keyHint: "sk-…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    defaultModel: "gemini-2.0-flash",
    keyHint: "AIza…",
  },
  {
    id: "mistral",
    label: "Mistral",
    protocol: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    keyHint: "…",
  },
  {
    id: "groq",
    label: "Groq",
    protocol: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    keyHint: "gsk_…",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    keyHint: "sk-or-…",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    keyHint: "sk-…",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    protocol: "openai",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2-latest",
    keyHint: "xai-…",
  },
  {
    id: "together",
    label: "Together",
    protocol: "openai",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    keyHint: "…",
  },
];

/** Preset whose canonical id matches `id`, if any. Pure. */
export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** The ids that used to ship as built-in cloud providers — the set the one-time
 * migration recreates from saved keys (see `migrateBuiltinProviders`). */
export const MIGRATABLE_BUILTIN_IDS = [
  "anthropic",
  "openai",
  "mistral",
  "gemini",
] as const;
