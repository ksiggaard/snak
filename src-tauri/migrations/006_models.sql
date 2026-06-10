-- Configurable per-provider model list. Each row is one selectable model:
-- `model_id` is sent to the provider API; `label` is the friendly display name
-- shown in the combined "Provider - Label" dropdown. User-editable in Settings.
CREATE TABLE IF NOT EXISTS models (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    provider   TEXT NOT NULL,
    model_id   TEXT NOT NULL,
    label      TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (provider, model_id)
);

-- Seed sensible defaults (runs once by migration version; user edits/deletes
-- are never re-seeded). Model ids follow the claude-api guidance.
INSERT INTO models (provider, model_id, label, sort_order) VALUES
    ('anthropic', 'claude-opus-4-8',       'Opus 4.8',         0),
    ('anthropic', 'claude-sonnet-4-6',     'Sonnet 4.6',       1),
    ('anthropic', 'claude-haiku-4-5',      'Haiku 4.5',        2),
    ('openai',    'gpt-4o',                'GPT-4o',           0),
    ('mistral',   'mistral-large-latest',  'Mistral Large',    0),
    ('gemini',    'gemini-2.0-flash',      'Gemini 2.0 Flash', 0);
