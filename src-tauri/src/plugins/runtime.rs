//! Runtime-loaded plugins: import from a `.zip`, read a plugin's entry source
//! for the frontend Blob-URL loader, and seed bundled plugins into app-data.
//!
//! ## Security
//! The host **executes** a runtime plugin's `entry` JS in the webview with full
//! app authority — the declared `permissions` are advisory ergonomics, not a
//! sandbox (see the plugin docs). What is enforced *here* is filesystem hygiene:
//! zip extraction is zip-slip-safe (via `enclosed_name`) and size-capped, and
//! entry reads are confined to the plugin's own folder (no `..`/absolute/symlink
//! traversal).

use std::io::Read;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use super::{parse_manifest, plugins_dir, PluginManifest};

/// Per-file and total extraction caps for an imported plugin zip.
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024; // 20 MB
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024; // 64 MB

/// True if a path is a safe relative path to join under a root: non-empty and
/// built only from normal/“.” components (no `..`, no absolute/root/prefix).
fn is_safe_relative(path: &str) -> bool {
    !path.trim().is_empty()
        && Path::new(path)
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

/// Find the app-data folder of an installed plugin by manifest id. The folder is
/// named by id for our seeded/imported plugins; we still scan + match the
/// manifest id to be robust to a hand-renamed folder.
fn find_plugin_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let root = plugins_dir(app)?;
    let direct = root.join(id);
    if direct.join("manifest.json").is_file() {
        return Ok(direct);
    }
    let entries = std::fs::read_dir(&root).map_err(|_| format!("no installed plugin `{id}`"))?;
    for entry in entries.flatten() {
        let dir = entry.path();
        if let Ok(text) = std::fs::read_to_string(dir.join("manifest.json")) {
            if let Ok(m) = parse_manifest(&text) {
                if m.id == id {
                    return Ok(dir);
                }
            }
        }
    }
    Err(format!("no installed plugin `{id}`"))
}

/// Return the JS source of an installed runtime plugin's entry file. The
/// frontend loader wraps this in a Blob URL and dynamic-`import()`s it.
#[tauri::command]
pub fn read_plugin_entry(app: AppHandle, id: String) -> Result<String, String> {
    let dir = find_plugin_dir(&app, &id)?;
    let manifest: PluginManifest = parse_manifest(
        &std::fs::read_to_string(dir.join("manifest.json")).map_err(|e| e.to_string())?,
    )?;
    let entry = manifest
        .entry
        .filter(|e| !e.trim().is_empty())
        .ok_or_else(|| format!("plugin `{id}` declares no entry file"))?;
    if !is_safe_relative(&entry) {
        return Err(format!("unsafe plugin entry path: {entry}"));
    }
    // Confine to the plugin dir (defence-in-depth against symlink/`..`).
    let canon_dir = std::fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    let canon = std::fs::canonicalize(dir.join(&entry))
        .map_err(|e| format!("reading entry `{entry}`: {e}"))?;
    if !canon.starts_with(&canon_dir) {
        return Err("plugin entry escapes its folder".into());
    }
    std::fs::read_to_string(&canon).map_err(|e| format!("reading entry `{entry}`: {e}"))
}

/// Import a plugin from a `.zip`: validate its manifest, refuse to clobber an
/// installed id, and zip-slip-safely extract into `…/plugins/<id>/`. Returns the
/// parsed manifest so the frontend can check dependencies + prompt a restart.
#[tauri::command]
pub fn import_plugin(app: AppHandle, zip_path: String) -> Result<PluginManifest, String> {
    let file = std::fs::File::open(&zip_path).map_err(|e| format!("opening zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("reading zip: {e}"))?;

    // Locate manifest.json at the shallowest depth; its parent is the plugin
    // root inside the zip (handles both root-level and folder-wrapped zips).
    let prefix = manifest_prefix(&mut archive)?;
    let manifest = parse_manifest(&read_zip_text(&mut archive, &format!("{prefix}manifest.json"))?)?;

    let dest = plugins_dir(&app)?.join(&manifest.id);
    if dest.exists() {
        return Err(format!("plugin `{}` is already installed", manifest.id));
    }

    extract_under_prefix(&mut archive, &prefix, &dest)?;
    Ok(manifest)
}

/// Open a native file picker for a plugin `.zip` and return its path (None if
/// cancelled). Async + non-blocking callback, mirroring `skills::pick_skills_dir`
/// (a sync picker deadlocks the macOS main thread).
#[tauri::command]
pub async fn pick_plugin_zip(app: AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Plugin package", &["zip"])
        .pick_file(move |path| {
            let _ = tx.send(path);
        });
    let Some(fp) = rx.await.map_err(|_| "dialog cancelled".to_string())? else {
        return Ok(None);
    };
    Ok(Some(
        fp.into_path()
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .into_owned(),
    ))
}

/// Copy bundled plugins shipped in the app's resource dir into app-data, but
/// only if absent — so a user-uninstalled bundled plugin stays gone and user
/// edits aren't clobbered. Best-effort: a missing resource dir is not an error.
pub fn seed_bundled_plugins(app: &AppHandle) -> Result<(), String> {
    let res = match app.path().resource_dir() {
        Ok(d) => d.join("resources").join("plugins"),
        Err(_) => return Ok(()),
    };
    let entries = match std::fs::read_dir(&res) {
        Ok(e) => e,
        Err(_) => return Ok(()), // nothing bundled (or dev without resources)
    };
    let dest_root = plugins_dir(app)?;
    std::fs::create_dir_all(&dest_root).map_err(|e| format!("creating plugins dir: {e}"))?;
    for entry in entries.flatten() {
        let src = entry.path();
        if !src.is_dir() || !src.join("manifest.json").is_file() {
            continue;
        }
        let dest = dest_root.join(entry.file_name());
        if dest.exists() {
            continue; // seed-if-absent
        }
        if let Err(e) = copy_dir(&src, &dest) {
            eprintln!("[plugins] seeding {:?} failed: {e}", entry.file_name());
        }
    }
    Ok(())
}

// --- helpers -----------------------------------------------------------------

/// Find the shallowest path ending in `manifest.json`; return its parent prefix
/// (e.g. "" for a root-level zip, "myplugin/" for a folder-wrapped one).
fn manifest_prefix(archive: &mut zip::ZipArchive<std::fs::File>) -> Result<String, String> {
    let mut best: Option<String> = None;
    for i in 0..archive.len() {
        let f = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(name) = f.enclosed_name() else {
            continue;
        };
        let name = name.to_string_lossy().replace('\\', "/");
        if name == "manifest.json" || name.ends_with("/manifest.json") {
            let prefix = name.strip_suffix("manifest.json").unwrap_or("").to_string();
            let depth = prefix.matches('/').count();
            if best
                .as_ref()
                .map_or(true, |b| depth < b.matches('/').count())
            {
                best = Some(prefix);
            }
        }
    }
    best.ok_or_else(|| "zip has no manifest.json".to_string())
}

fn read_zip_text(
    archive: &mut zip::ZipArchive<std::fs::File>,
    name: &str,
) -> Result<String, String> {
    let mut f = archive
        .by_name(name)
        .map_err(|_| format!("zip missing {name}"))?;
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|e| e.to_string())?;
    Ok(s)
}

/// Extract every entry under `prefix` into `dest`, stripping the prefix.
/// zip-slip-safe (via `enclosed_name`) and size-capped.
fn extract_under_prefix(
    archive: &mut zip::ZipArchive<std::fs::File>,
    prefix: &str,
    dest: &Path,
) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("creating plugin dir: {e}"))?;
    let mut total: u64 = 0;
    for i in 0..archive.len() {
        let mut f = archive.by_index(i).map_err(|e| e.to_string())?;
        let Some(safe) = f.enclosed_name() else {
            continue; // skip entries that would escape (zip-slip)
        };
        let name = safe.to_string_lossy().replace('\\', "/");
        let Some(rel) = name.strip_prefix(prefix) else {
            continue;
        };
        if rel.is_empty() {
            continue;
        }
        let out = dest.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if f.size() > MAX_FILE_BYTES {
            return Err(format!("plugin file too large: {rel}"));
        }
        total = total.saturating_add(f.size());
        if total > MAX_TOTAL_BYTES {
            return Err("plugin zip exceeds total size budget".into());
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        std::fs::write(&out, &buf).map_err(|e| format!("writing {rel}: {e}"))?;
    }
    Ok(())
}

/// Recursively copy `src` into `dest` (files + subdirs). Used by seeding.
fn copy_dir(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn safe_relative_paths() {
        assert!(is_safe_relative("main.js"));
        assert!(is_safe_relative("dist/main.js"));
        assert!(!is_safe_relative("../main.js"));
        assert!(!is_safe_relative("/etc/passwd"));
        assert!(!is_safe_relative(""));
        assert!(!is_safe_relative("a/../../b"));
    }

    #[test]
    fn extracts_a_folder_wrapped_zip() {
        let dir = std::env::temp_dir().join(format!("snak_pltest_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let zip_path = dir.join("p.zip");

        // Build a folder-wrapped zip: wrap/manifest.json + wrap/main.js.
        {
            let file = std::fs::File::create(&zip_path).unwrap();
            let mut zw = zip::ZipWriter::new(file);
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zw.start_file("wrap/manifest.json", opts).unwrap();
            zw.write_all(b"{\"id\":\"com.t.z\"}").unwrap();
            zw.start_file("wrap/main.js", opts).unwrap();
            zw.write_all(b"export function activate(){}").unwrap();
            zw.finish().unwrap();
        }

        let f = std::fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(f).unwrap();
        // The wrapper folder is detected as the plugin root prefix.
        assert_eq!(manifest_prefix(&mut archive).unwrap(), "wrap/");

        let dest = dir.join("out");
        extract_under_prefix(&mut archive, "wrap/", &dest).unwrap();
        assert_eq!(
            std::fs::read_to_string(dest.join("manifest.json")).unwrap(),
            "{\"id\":\"com.t.z\"}"
        );
        assert!(dest.join("main.js").is_file());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
