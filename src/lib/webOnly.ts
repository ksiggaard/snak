// Web-only mode: true when running in a plain browser (`npm run dev` / `preview`)
// rather than inside the Tauri webview. Tauri v2 injects `window.isTauri`; our
// web shim never sets it, so this stays correct even after the IPC mock is
// installed (the mock does NOT set `isTauri`). In this mode all Rust/Tauri
// commands are stubbed (see lib/webShim.ts) and the SQLite layer is replaced by
// an in-memory fake (see lib/webdb.ts), so the frontend can run + be debugged in
// normal browser devtools with no backend.
export const WEB_ONLY =
  typeof window !== "undefined" &&
  (window as { isTauri?: boolean }).isTauri !== true;
