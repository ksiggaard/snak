//! Built-in, in-process **read-only system-diagnostics** MCP-style server.
//!
//! Exposes tools that let the model inspect the local Linux machine while
//! helping debug: read directory/file contents, check owners & permissions, and
//! run a fixed catalog of read-only diagnostic commands (processes, disk usage,
//! network, sensors, …). It ships **disabled by default** (the frontend's
//! `BUILTIN_SYSDEBUG_SERVER` is `enabled: false`) and every call is gated behind
//! an explicit per-call approval in the UI (see `mcp::requires_approval`).
//!
//! ## Safety: read-only by construction
//!
//! This module calls only **read** APIs — `std::fs::read_dir`, `std::fs::read`,
//! `symlink_metadata`, `MetadataExt`. For system probes it spawns a **fixed,
//! curated set of read-only commands** via `Command::new(prog).args([...])` —
//! **never through a shell** — so there is no command-injection surface even when
//! a path argument is passed (it is one inert `argv` element). There is simply no
//! write/delete/chmod code path here to invoke. The OS still enforces file
//! permissions (the app runs as the user), so this can never read or change
//! anything the user couldn't already.

use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Context};
use serde_json::{json, Value};

use super::ToolDef;

/// The id used to namespace this server's tools (`sys__read_file`, …).
pub const SERVER_ID: &str = "sys";

/// Max characters of any single tool result handed back to the model, so a huge
/// file or command output can't blow the context window. Generous but bounded.
const MAX_TEXT_LEN: usize = 20_000;
/// Max bytes we read off disk for `read_file` before truncating (covers
/// `MAX_TEXT_LEN` chars comfortably even for multi-byte UTF-8).
const MAX_READ_BYTES: u64 = 256 * 1024;
/// Cap on `list_directory` entries returned (with a truncation note past it).
const MAX_DIR_ENTRIES: usize = 1000;
/// `search_files` bounds, so a walk over a huge tree stays cheap and finite.
const SEARCH_MAX_DEPTH: usize = 8;
const SEARCH_MAX_SCANNED: usize = 20_000;
const SEARCH_MAX_MATCHES: usize = 200;
const SEARCH_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// Wall-clock limit for any single diagnostic command.
const DIAGNOSTIC_TIMEOUT: Duration = Duration::from_secs(15);

// ---------------------------------------------------------------------------
// Diagnostic catalog — a fixed set of read-only commands. The model picks a
// `probe` by key; the argv is hardcoded here and never built from model input
// (except a single validated path arg for probes with `uses_path`).
// ---------------------------------------------------------------------------

struct Probe {
    key: &'static str,
    description: &'static str,
    prog: &'static str,
    args: &'static [&'static str],
    /// When true, an extra (validated) `path` argument is appended to `args`.
    uses_path: bool,
}

const PROBES: &[Probe] = &[
    Probe {
        key: "processes",
        description: "running processes (ps aux)",
        prog: "ps",
        args: &["aux"],
        uses_path: false,
    },
    Probe {
        key: "process_tree",
        description: "process tree (ps -ejH)",
        prog: "ps",
        args: &["-ejH"],
        uses_path: false,
    },
    Probe {
        key: "memory",
        description: "memory usage (free -h)",
        prog: "free",
        args: &["-h"],
        uses_path: false,
    },
    Probe {
        key: "top",
        description: "one-shot top snapshot (top -b -n1)",
        prog: "top",
        args: &["-b", "-n1"],
        uses_path: false,
    },
    Probe {
        key: "disk_free",
        description: "filesystem free space (df -h)",
        prog: "df",
        args: &["-h"],
        uses_path: false,
    },
    Probe {
        key: "disk_usage",
        description: "disk usage of a directory, one level deep (du -h -d1 <path>)",
        prog: "du",
        args: &["-h", "-d1"],
        uses_path: true,
    },
    Probe {
        key: "block_devices",
        description: "block devices & mounts (lsblk)",
        prog: "lsblk",
        args: &["-o", "NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT"],
        uses_path: false,
    },
    Probe {
        key: "network_interfaces",
        description: "network interfaces & addresses (ip -o addr)",
        prog: "ip",
        args: &["-o", "addr"],
        uses_path: false,
    },
    Probe {
        key: "network_routes",
        description: "routing table (ip route)",
        prog: "ip",
        args: &["route"],
        uses_path: false,
    },
    Probe {
        key: "network_sockets",
        description: "listening/open sockets (ss -tunap)",
        prog: "ss",
        args: &["-tunap"],
        uses_path: false,
    },
    Probe {
        key: "dns",
        description: "DNS resolver status (resolvectl status)",
        prog: "resolvectl",
        args: &["status"],
        uses_path: false,
    },
    Probe {
        key: "sensors",
        description: "hardware sensors / temperatures (sensors)",
        prog: "sensors",
        args: &[],
        uses_path: false,
    },
    Probe {
        key: "bluetooth",
        description: "known bluetooth devices (bluetoothctl devices)",
        prog: "bluetoothctl",
        args: &["devices"],
        uses_path: false,
    },
    Probe {
        key: "usb",
        description: "USB devices (lsusb)",
        prog: "lsusb",
        args: &[],
        uses_path: false,
    },
    Probe {
        key: "pci",
        description: "PCI devices (lspci)",
        prog: "lspci",
        args: &[],
        uses_path: false,
    },
    Probe {
        key: "cpu",
        description: "CPU info (lscpu)",
        prog: "lscpu",
        args: &[],
        uses_path: false,
    },
    Probe {
        key: "kernel",
        description: "kernel & OS (uname -a)",
        prog: "uname",
        args: &["-a"],
        uses_path: false,
    },
    Probe {
        key: "uptime",
        description: "uptime & load (uptime)",
        prog: "uptime",
        args: &[],
        uses_path: false,
    },
    Probe {
        key: "modules",
        description: "loaded kernel modules (lsmod)",
        prog: "lsmod",
        args: &[],
        uses_path: false,
    },
    Probe {
        key: "systemd_failed",
        description: "failed systemd units (systemctl --failed)",
        prog: "systemctl",
        args: &["--no-pager", "--failed"],
        uses_path: false,
    },
    Probe {
        key: "journal_recent",
        description: "last 200 journal lines (journalctl -n 200)",
        prog: "journalctl",
        args: &["--no-pager", "-n", "200"],
        uses_path: false,
    },
];

fn find_probe(key: &str) -> Option<&'static Probe> {
    PROBES.iter().find(|p| p.key == key)
}

/// Human-readable list of probe keys + descriptions, for the tool schema.
fn probe_help() -> String {
    PROBES
        .iter()
        .map(|p| format!("`{}` — {}", p.key, p.description))
        .collect::<Vec<_>>()
        .join("; ")
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/// The read-only tools this built-in server advertises.
pub fn tools() -> Vec<ToolDef> {
    let path_arg = json!({
        "type": "object",
        "properties": {
            "path": { "type": "string", "description": "Absolute filesystem path." }
        },
        "required": ["path"]
    });
    vec![
        ToolDef {
            name: "list_directory".to_string(),
            description: "List the entries of a directory (name, type, size). Read-only.".to_string(),
            input_schema: path_arg.clone(),
        },
        ToolDef {
            name: "read_file".to_string(),
            description: "Read a text file's contents (length-capped; binary files are reported, not dumped). Read-only.".to_string(),
            input_schema: path_arg.clone(),
        },
        ToolDef {
            name: "stat_path".to_string(),
            description: "Show a path's type, size, owner, group, octal+rwx permissions, timestamps, and (for symlinks) target. Read-only.".to_string(),
            input_schema: path_arg,
        },
        ToolDef {
            name: "search_files".to_string(),
            description: "Recursively search under a directory for files whose name contains `pattern`; if `content` is true, also report files whose text contains it. Bounded & read-only.".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "root": { "type": "string", "description": "Absolute directory to search under." },
                    "pattern": { "type": "string", "description": "Case-insensitive substring to match." },
                    "content": { "type": "boolean", "description": "Also grep file contents (default false)." }
                },
                "required": ["root", "pattern"]
            }),
        },
        ToolDef {
            name: "run_diagnostic".to_string(),
            description: format!(
                "Run a read-only system diagnostic command and return its output. \
                 `probe` selects which: {}. Only `disk_usage` uses `path`.",
                probe_help()
            ),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "probe": {
                        "type": "string",
                        "enum": PROBES.iter().map(|p| p.key).collect::<Vec<_>>(),
                        "description": "Which diagnostic to run."
                    },
                    "path": { "type": "string", "description": "Directory path (only used by `disk_usage`)." }
                },
                "required": ["probe"]
            }),
        },
    ]
}

// ---------------------------------------------------------------------------
// Approval-card text
// ---------------------------------------------------------------------------

/// A `(summary, detail)` pair describing what a call would do, shown in the UI's
/// per-call approval gate before anything runs.
pub fn describe(tool: &str, args: &Value) -> (String, String) {
    let path = args.get("path").and_then(|p| p.as_str());
    match tool {
        "list_directory" => ("List directory".into(), path.unwrap_or("?").into()),
        "read_file" => ("Read file".into(), path.unwrap_or("?").into()),
        "stat_path" => (
            "Inspect owner & permissions".into(),
            path.unwrap_or("?").into(),
        ),
        "search_files" => {
            let root = args.get("root").and_then(|r| r.as_str()).unwrap_or("?");
            let pat = args.get("pattern").and_then(|p| p.as_str()).unwrap_or("");
            ("Search files".into(), format!("\"{pat}\" under {root}"))
        }
        "run_diagnostic" => {
            let probe = args.get("probe").and_then(|p| p.as_str()).unwrap_or("?");
            match find_probe(probe) {
                Some(p) => {
                    let mut detail = format!("{} {}", p.prog, p.args.join(" "));
                    if p.uses_path {
                        if let Some(path) = path {
                            detail.push(' ');
                            detail.push_str(path);
                        }
                    }
                    ("Run diagnostic".into(), detail.trim().to_string())
                }
                None => ("Run diagnostic".into(), probe.into()),
            }
        }
        other => ("Tool call".into(), other.into()),
    }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// Execute one read-only tool call. Errors are returned as `Err` and surfaced to
/// the model as a failed `tool_result` by the chat loop (a bad call never aborts
/// the turn).
pub async fn call_tool(tool: &str, args: &Value) -> anyhow::Result<String> {
    match tool {
        "list_directory" => list_directory(require_str(args, "path")?),
        "read_file" => read_file(require_str(args, "path")?),
        "stat_path" => stat_path(require_str(args, "path")?),
        "search_files" => {
            let root = require_str(args, "root")?;
            let pattern = require_str(args, "pattern")?;
            let content = args
                .get("content")
                .and_then(|c| c.as_bool())
                .unwrap_or(false);
            search_files(root, pattern, content)
        }
        "run_diagnostic" => run_diagnostic(args).await,
        other => Err(anyhow!("unknown system tool: {other}")),
    }
}

fn require_str<'a>(args: &'a Value, key: &str) -> anyhow::Result<&'a str> {
    args.get(key)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| anyhow!("missing required string argument `{key}`"))
}

// ---------------------------------------------------------------------------
// Filesystem tools (read-only)
// ---------------------------------------------------------------------------

fn list_directory(path: &str) -> anyhow::Result<String> {
    let mut entries: Vec<(String, char, u64)> = Vec::new();
    let read = std::fs::read_dir(path).with_context(|| format!("reading directory {path}"))?;
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        // symlink_metadata: describe the link itself, not its target.
        let meta = entry.path().symlink_metadata().ok();
        let kind = match &meta {
            Some(m) if m.file_type().is_symlink() => 'l',
            Some(m) if m.is_dir() => 'd',
            Some(_) => 'f',
            None => '?',
        };
        let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        entries.push((name, kind, size));
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    let total = entries.len();
    let truncated = total > MAX_DIR_ENTRIES;
    entries.truncate(MAX_DIR_ENTRIES);

    let mut out = format!("{path} ({total} entries)\n");
    for (name, kind, size) in &entries {
        let suffix = if *kind == 'd' { "/" } else { "" };
        out.push_str(&format!("{kind} {size:>12}  {name}{suffix}\n"));
    }
    if truncated {
        out.push_str(&format!(
            "… ({} more entries omitted)\n",
            total - MAX_DIR_ENTRIES
        ));
    }
    Ok(cap_text(out))
}

fn read_file(path: &str) -> anyhow::Result<String> {
    let meta = std::fs::symlink_metadata(path).with_context(|| format!("stat {path}"))?;
    if meta.file_type().is_symlink() {
        let target = std::fs::read_link(path).unwrap_or_default();
        bail!(
            "{path} is a symlink → {}; stat or read the target directly",
            target.display()
        );
    }
    if meta.is_dir() {
        bail!("{path} is a directory; use list_directory");
    }
    if !meta.is_file() {
        bail!("{path} is not a regular file");
    }

    use std::io::Read;
    let file = std::fs::File::open(path).with_context(|| format!("opening {path}"))?;
    let mut buf = Vec::new();
    file.take(MAX_READ_BYTES)
        .read_to_end(&mut buf)
        .with_context(|| format!("reading {path}"))?;

    // Binary detection: a NUL byte in the first chunk means "not text".
    if buf.iter().take(8192).any(|&b| b == 0) {
        return Ok(format!("[binary file, {} bytes — not shown]", meta.len()));
    }

    let text = String::from_utf8_lossy(&buf);
    let mut out = cap_text(text.into_owned());
    if meta.len() > MAX_READ_BYTES {
        out.push_str(&format!(
            "\n[… file is {} bytes; showing first {}]",
            meta.len(),
            MAX_READ_BYTES
        ));
    }
    Ok(out)
}

fn stat_path(path: &str) -> anyhow::Result<String> {
    let meta = std::fs::symlink_metadata(path).with_context(|| format!("stat {path}"))?;
    let ft = meta.file_type();
    let kind = if ft.is_symlink() {
        "symlink"
    } else if ft.is_dir() {
        "directory"
    } else if ft.is_file() {
        "file"
    } else {
        "special"
    };
    let mode = meta.permissions().mode();
    let mut out = String::new();
    out.push_str(&format!("path: {path}\n"));
    out.push_str(&format!("type: {kind}\n"));
    out.push_str(&format!("size: {} bytes\n", meta.len()));
    out.push_str(&format!(
        "permissions: {:04o} ({})\n",
        mode & 0o7777,
        rwx_string(mode)
    ));
    out.push_str(&format!(
        "owner: {} ({})\n",
        user_name(meta.uid()),
        meta.uid()
    ));
    out.push_str(&format!(
        "group: {} ({})\n",
        group_name(meta.gid()),
        meta.gid()
    ));
    out.push_str(&format!("links: {}\n", meta.nlink()));
    out.push_str(&format!("modified: {} (epoch)\n", meta.mtime()));
    out.push_str(&format!("accessed: {} (epoch)\n", meta.atime()));
    if ft.is_symlink() {
        if let Ok(target) = std::fs::read_link(path) {
            out.push_str(&format!("target: {}\n", target.display()));
        }
    }
    Ok(out)
}

fn search_files(root: &str, pattern: &str, content: bool) -> anyhow::Result<String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        bail!("{root} is not a directory");
    }
    let needle = pattern.to_lowercase();
    let mut matches: Vec<String> = Vec::new();
    let mut scanned = 0usize;
    let mut stack: Vec<(std::path::PathBuf, usize)> = vec![(root_path.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if matches.len() >= SEARCH_MAX_MATCHES || scanned >= SEARCH_MAX_SCANNED {
            break;
        }
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue, // unreadable dir — skip silently
        };
        for entry in read.flatten() {
            if matches.len() >= SEARCH_MAX_MATCHES || scanned >= SEARCH_MAX_SCANNED {
                break;
            }
            scanned += 1;
            let p = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue; // don't follow symlinks (avoids loops / escapes)
            }
            if meta.is_dir() {
                if depth < SEARCH_MAX_DEPTH {
                    stack.push((p, depth + 1));
                }
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.contains(&needle) {
                matches.push(format!("name  {}", p.display()));
                continue;
            }
            if content && meta.len() <= SEARCH_MAX_FILE_BYTES {
                if let Ok(bytes) = std::fs::read(&p) {
                    if !bytes.iter().take(8192).any(|&b| b == 0) {
                        if let Some(line) = first_content_match(&bytes, &needle) {
                            matches.push(format!("text  {}: {}", p.display(), line));
                        }
                    }
                }
            }
        }
    }

    let mut out = format!(
        "{} match(es) for \"{pattern}\" under {root} (scanned {scanned} entries)\n",
        matches.len()
    );
    for m in &matches {
        out.push_str(m);
        out.push('\n');
    }
    if matches.len() >= SEARCH_MAX_MATCHES {
        out.push_str("[result cap reached — narrow the search]\n");
    }
    Ok(cap_text(out))
}

/// First text line containing `needle` (lowercased compare), trimmed/capped.
fn first_content_match(bytes: &[u8], needle: &str) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    for line in text.lines() {
        if line.to_lowercase().contains(needle) {
            let trimmed = line.trim();
            let capped: String = trimmed.chars().take(160).collect();
            return Some(capped);
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Diagnostic commands (read-only, fixed argv, no shell)
// ---------------------------------------------------------------------------

async fn run_diagnostic(args: &Value) -> anyhow::Result<String> {
    let probe_key = require_str(args, "probe")?;
    let probe = find_probe(probe_key).ok_or_else(|| anyhow!("unknown probe `{probe_key}`"))?;

    let mut command = tokio::process::Command::new(probe.prog);
    command.args(probe.args);
    if probe.uses_path {
        let path = require_str(args, "path")
            .map_err(|_| anyhow!("probe `{probe_key}` requires a `path` argument"))?;
        // The path is a single argv element (never shell-interpolated); validate
        // it points at something readable for a clearer error than the tool's.
        if !Path::new(path).exists() {
            bail!("path does not exist: {path}");
        }
        command.arg(path);
    }

    let run = command.output();
    let output = match tokio::time::timeout(DIAGNOSTIC_TIMEOUT, run).await {
        Err(_) => bail!("`{}` timed out after {:?}", probe.prog, DIAGNOSTIC_TIMEOUT),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => {
            bail!("`{}` is not installed on this system", probe.prog)
        }
        Ok(Err(e)) => return Err(e).with_context(|| format!("running {}", probe.prog)),
        Ok(Ok(o)) => o,
    };

    let mut out = String::from_utf8_lossy(&output.stdout).into_owned();
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        out.push_str(&format!("\n[exit {}] {}", output.status, err.trim()));
    }
    if out.trim().is_empty() {
        out = format!("(no output from {})", probe.prog);
    }
    Ok(cap_text(out))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Truncate to `MAX_TEXT_LEN` chars on a char boundary, with an ellipsis marker.
fn cap_text(s: String) -> String {
    if s.chars().count() <= MAX_TEXT_LEN {
        return s;
    }
    let truncated: String = s.chars().take(MAX_TEXT_LEN).collect();
    format!("{truncated}\n[… output truncated at {MAX_TEXT_LEN} chars]")
}

/// `rwxr-xr-x`-style string from a unix mode.
fn rwx_string(mode: u32) -> String {
    let bit = |shift: u32, ch: char| {
        if mode & (1 << shift) != 0 {
            ch
        } else {
            '-'
        }
    };
    let mut s = String::with_capacity(9);
    for (r, w, x) in [(8, 7, 6), (5, 4, 3), (2, 1, 0)] {
        s.push(bit(r, 'r'));
        s.push(bit(w, 'w'));
        s.push(bit(x, 'x'));
    }
    s
}

/// Resolve a uid to a username by parsing `/etc/passwd` (read-only, no deps).
/// Falls back to the numeric id as a string when unresolved.
fn user_name(uid: u32) -> String {
    lookup_id("/etc/passwd", uid).unwrap_or_else(|| uid.to_string())
}

/// Resolve a gid to a group name via `/etc/group` (read-only, no deps).
fn group_name(gid: u32) -> String {
    lookup_id("/etc/group", gid).unwrap_or_else(|| gid.to_string())
}

/// Parse a `name:x:id:…` colon-table (passwd/group share this prefix shape) and
/// return the name whose third field equals `id`.
fn lookup_id(file: &str, id: u32) -> Option<String> {
    let content = std::fs::read_to_string(file).ok()?;
    for line in content.lines() {
        let mut fields = line.split(':');
        let name = fields.next()?;
        let _passwd = fields.next()?;
        let row_id = fields.next()?;
        if row_id.parse::<u32>().ok() == Some(id) {
            return Some(name.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_expected_tools() {
        let names: Vec<_> = tools().into_iter().map(|t| t.name).collect();
        assert!(names.contains(&"list_directory".to_string()));
        assert!(names.contains(&"read_file".to_string()));
        assert!(names.contains(&"stat_path".to_string()));
        assert!(names.contains(&"search_files".to_string()));
        assert!(names.contains(&"run_diagnostic".to_string()));
    }

    #[test]
    fn probe_catalog_lookup() {
        assert!(find_probe("processes").is_some());
        assert!(find_probe("disk_usage").unwrap().uses_path);
        assert!(!find_probe("memory").unwrap().uses_path);
        assert!(find_probe("nope").is_none());
    }

    #[test]
    fn rwx_formats_modes() {
        assert_eq!(rwx_string(0o755), "rwxr-xr-x");
        assert_eq!(rwx_string(0o640), "rw-r-----");
        assert_eq!(rwx_string(0o000), "---------");
    }

    #[test]
    fn describe_is_human_readable() {
        let (s, d) = describe("read_file", &json!({ "path": "/etc/fstab" }));
        assert_eq!(s, "Read file");
        assert_eq!(d, "/etc/fstab");
        let (s, d) = describe("run_diagnostic", &json!({ "probe": "processes" }));
        assert_eq!(s, "Run diagnostic");
        assert_eq!(d, "ps aux");
        let (_, d) = describe(
            "run_diagnostic",
            &json!({ "probe": "disk_usage", "path": "/tmp" }),
        );
        assert_eq!(d, "du -h -d1 /tmp");
    }

    #[test]
    fn lists_a_known_directory() {
        // /etc exists on Linux CI; just assert it doesn't error and is non-empty.
        let out = list_directory("/etc").unwrap();
        assert!(out.contains("entries"));
    }

    #[test]
    fn read_file_rejects_directory() {
        assert!(read_file("/etc").is_err());
    }

    #[test]
    fn missing_arg_errors() {
        assert!(require_str(&json!({}), "path").is_err());
        assert!(require_str(&json!({ "path": "" }), "path").is_err());
        assert!(require_str(&json!({ "path": "/x" }), "path").is_ok());
    }
}
