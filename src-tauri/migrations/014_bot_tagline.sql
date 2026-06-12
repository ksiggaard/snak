-- T38 follow-up: a short subtitle/tagline displayed next to the bot's name
-- in the bot lists (e.g. "Bjarne — The IT architect") and folded into the
-- persona system text.
ALTER TABLE bots ADD COLUMN tagline TEXT NOT NULL DEFAULT '';
