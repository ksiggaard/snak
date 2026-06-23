// Build bundled plugins: for each folder under plugins/<id>/, emit a ready-to-
// seed plugin into src-tauri/resources/plugins/<id>/ (copied verbatim into
// app-data at runtime by seed_bundled_plugins).
//
//   - manifest.json is copied as-is.
//   - index.ts  → bundled to main.js via esbuild (deps inlined; no splitting,
//                 so dynamic imports are folded into the single file the
//                 Blob-URL loader needs).
//   - main.js   → copied as-is (hand-written, dependency-free plugins).
//
// The output dir is generated (gitignored). Run before `tauri dev`/`tauri build`.

import { build } from "esbuild";
import {
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "plugins");
const OUT = join(root, "src-tauri", "resources", "plugins");

if (!existsSync(SRC)) {
  console.log("[build-plugins] no plugins/ dir — nothing to build");
  process.exit(0);
}

const ids = readdirSync(SRC).filter((n) =>
  statSync(join(SRC, n)).isDirectory(),
);

for (const id of ids) {
  const srcDir = join(SRC, id);
  const outDir = join(OUT, id);
  mkdirSync(outDir, { recursive: true });

  const manifest = join(srcDir, "manifest.json");
  if (existsSync(manifest)) copyFileSync(manifest, join(outDir, "manifest.json"));

  const ts = join(srcDir, "index.ts");
  const js = join(srcDir, "main.js");
  if (existsSync(ts)) {
    await build({
      entryPoints: [ts],
      bundle: true,
      format: "esm",
      outfile: join(outDir, "main.js"),
      platform: "browser",
      target: "es2022",
      legalComments: "none",
      logLevel: "warning",
      // Let bundled plugins import the app's pure helper modules (e.g. @/lib/geo)
      // and CSS-as-text (e.g. leaflet/dist/leaflet.css → injected at runtime).
      alias: { "@": join(root, "src") },
      loader: { ".css": "text" },
    });
    console.log(`[build-plugins] bundled ${id}`);
  } else if (existsSync(js)) {
    copyFileSync(js, join(outDir, "main.js"));
    console.log(`[build-plugins] copied ${id}`);
  } else {
    console.warn(`[build-plugins] ${id}: no index.ts or main.js — skipped`);
  }
}

console.log(`[build-plugins] done (${ids.length} plugin(s))`);
