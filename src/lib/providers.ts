import type { Provider } from "@/types/db";

export interface ProviderMeta {
  id: Provider;
  label: string;
  /** Default model used for new threads (refined in Stage 3). */
  defaultModel: string;
  /** Placeholder hint shown in the key input. */
  keyHint: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-opus-4-8",
    keyHint: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    keyHint: "sk-…",
  },
  {
    id: "mistral",
    label: "Mistral",
    defaultModel: "mistral-large-latest",
    keyHint: "…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    defaultModel: "gemini-2.0-flash",
    keyHint: "AIza…",
  },
];
