---
name: add-i18n-keys
description: How to add or change user-facing UI strings in snak so the locale tests stay green. Use whenever you add a new visible string, a button label, a tooltip, or any text the user sees — every new key must land in all bundled language packs.
---

# Adding i18n keys

All user-facing UI text comes from the i18n catalog — **never hardcode visible strings**
(model prompts and Rust error messages are exempt). A new key added to only the English
catalog **will fail CI** (`src/lib/locales.test.ts` enforces that every bundled pack is complete).

## Where things live

- **Canonical key set:** the `en` catalog in **`src/lib/i18n.ts`** — this defines the keys.
- **Bundled JSON packs:** `src/locales/{en,de,fr,pl,es,da}.json`.
- **Tests:** `src/lib/locales.test.ts` requires `de`, `fr`, `pl`, `es`, `da` to translate **every**
  catalog key (the English-fallback path is for *user* packs, not bundled ones) and forbids orphan
  keys (typos) — except extra CLDR plural categories (e.g. Polish `.few`/`.many`).

## Steps for each new string

1. Add the key to the `en` catalog (`src/lib/i18n.ts`) and to `src/locales/en.json`.
2. Add the **same key, translated, to every other pack**: `de.json`, `fr.json`, `pl.json`,
   `es.json`, `da.json`. Do not skip any — incomplete packs fail the test.
3. Use the key in the component via the translation helper (e.g. `useT()` — match how nearby
   components read strings).
4. For pluralized strings, provide the locale's CLDR plural categories (e.g. Polish needs
   `.one`/`.few`/`.many`/`.other`).

## Verify

```
npx vitest run src/lib/locales.test.ts
```

(or `npm run build` + the full `npx vitest`). Green = all packs complete and consistent.

## Reference

`docs/i18n.md` (authoring guide); T32. This rule is also why the locale test exists — keep it green.
