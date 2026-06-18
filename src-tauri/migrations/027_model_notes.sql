-- Model notes: a free-text description of what each model is good at,
-- shown in the model picker dropdown as a secondary line.
ALTER TABLE models ADD COLUMN notes TEXT NOT NULL DEFAULT '';

-- Seed sensible notes for the built-in models (migration 006).
UPDATE models SET notes = 'Best for complex reasoning, deep analysis, and long-form writing'
 WHERE provider = 'anthropic' AND model_id = 'claude-opus-4-8';
UPDATE models SET notes = 'Fast, balanced model — ideal for everyday coding and chat'
 WHERE provider = 'anthropic' AND model_id = 'claude-sonnet-4-5';
UPDATE models SET notes = 'Lightweight and fast — use for quick questions and drafts'
 WHERE provider = 'anthropic' AND model_id = 'claude-haiku-4-5';
UPDATE models SET notes = 'Strong general-purpose model for creative and technical tasks'
 WHERE provider = 'openai' AND model_id = 'gpt-4o';
UPDATE models SET notes = 'Excellent for coding, technical docs, and structured output'
 WHERE provider = 'mistral' AND model_id = 'mistral-large';
UPDATE models SET notes = 'Best for research, long context, and multi-step reasoning'
 WHERE provider = 'gemini' AND model_id = 'gemini-2.5-pro';
