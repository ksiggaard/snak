// User-installable language packs (T32): typed wrappers over the Rust
// languages-folder loader.
//
// Discovery lives in Rust because it reads the app-data filesystem (a backend
// concern, mirroring the T11 themes loader). A pack is a single
// `…/languages/<bcp47>.json` file: `{ name, code, strings }`. The frontend
// merges discovered packs with the bundled ones (see `src/store/i18n.ts`) and
// persists the selected locale in localStorage.

import { invoke } from "@tauri-apps/api/core";
import type { LanguagePack } from "@/lib/i18n";

/** List validated language packs from the app-data languages directory. */
export const listLanguages = (): Promise<LanguagePack[]> =>
  invoke<LanguagePack[]>("list_languages");

/** Absolute path of the languages directory (created on demand). */
export const languagesDirectory = (): Promise<string> =>
  invoke<string>("languages_directory");
