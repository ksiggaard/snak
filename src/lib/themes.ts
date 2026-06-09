// Installable themes (T11): typed wrappers over the Rust theme-folder loader.
//
// Discovery lives in Rust because it reads the app-data filesystem (a backend
// concern). A theme is a folder `…/themes/<id>/` with a `theme.json` manifest
// (name/author?/version) and a `theme.css` overriding the documented CSS
// variables. The frontend lists themes, injects the chosen CSS into a `<style>`
// element (see `applyInstalledThemeCss` in `@/lib/theme`), and persists the
// selected id in localStorage alongside the light/dark preference.

import { invoke } from "@tauri-apps/api/core";

/** A discovered theme. Mirrors `InstalledTheme` in commands/themes.rs. */
export interface InstalledTheme {
  /** Folder name under `…/themes/`; the stable selection key. */
  id: string;
  name: string;
  author: string | null;
  version: string;
  /** Full CSS text from `theme.css`, ready to inject into a `<style>`. */
  css: string;
}

/** List installed themes from the app-data themes directory. */
export const listThemes = (): Promise<InstalledTheme[]> =>
  invoke<InstalledTheme[]>("list_themes");

/** Absolute path of the themes directory (created on demand). */
export const themesDirectory = (): Promise<string> =>
  invoke<string>("themes_directory");
