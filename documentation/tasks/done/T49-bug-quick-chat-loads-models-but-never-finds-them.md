# T49 — Bug: quick-chat loads models but never finds them

- **Status:** done
- **Owner:** Claude (T49)
- **Priority:** P1
- **Layer:** Frontend
- **Depends on:** —

(IDEAS 20.) The quick-input overlay's model picker spun on "loading" forever.

**Notes:**
- 2026-06-13 (Claude): Root cause — `ModelChooser` gates its list on `useKeys.loaded`, and
  `useKeys.load()` (`store/keys.ts`) had no try/catch. In the `quick` window (which loads its own
  stores), a thrown DB/keychain call left `loaded` false forever → permanent spinner. Wrapped the
  body in try/catch and always set `loaded:true` (mirrors `useModels.load()`), so a failed
  presence read degrades to "no keys present" instead of hanging. Verified: full frontend gate.
