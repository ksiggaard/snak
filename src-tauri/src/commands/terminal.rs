//! "Open in terminal" for bash/sh code blocks (T17).
//!
//! Launches an OS terminal emulator with a model-generated command **staged but
//! NOT executed**: the command is placed on the shell's edit line (and as the
//! top history entry) so the user can review it and decide to press Enter (or
//! edit / discard it). We never auto-run model output.
//!
//! ## Safety / no-injection design
//!
//! The command text is passed to the spawned process as **data, never
//! interpolated into a shell string**:
//! - It is handed to the terminal via the `SNAK_STAGED_CMD` environment
//!   variable (`Command::env`), so shell metacharacters, quotes, newlines,
//!   `$(...)`, backticks, `;`, `&&`, etc. are inert bytes in an env var — not
//!   tokens the launcher parses.
//! - The interactive `bash` we start reads that env var inside a static
//!   `--rcfile` and (a) seeds it as the most-recent history entry and (b)
//!   pre-fills the readline edit buffer via a one-shot startup macro. Bash only
//!   RUNS a line when the user presses Enter, so staging never executes it.
//! - We deliberately avoid `konsole -e <cmd>` / Terminal `do script`, both of
//!   which run the command immediately.
//!
//! Mirrors the desktop-only, platform-gated pattern of `take_screenshot`.

/// Name of the environment variable carrying the staged command to the shell.
const STAGED_CMD_ENV: &str = "SNAK_STAGED_CMD";

/// A bash `--rcfile` that, on interactive startup, sources the user's normal
/// config and then stages `$SNAK_STAGED_CMD` **without executing it**:
///
/// - It is pushed as the newest history entry (`history -s`) so pressing the
///   Up arrow recalls it.
/// - It is loaded onto the current readline edit line via a one-shot macro:
///   `READLINE_LINE`/`READLINE_POINT` are only writable from a `bind -x`
///   function, so we bind the Device-Status-Report reply sequence and ask the
///   terminal to emit it once (`printf` of the DSR query). When it fires, the
///   bound function fills the edit buffer and unbinds itself.
///
/// The command itself never appears in this template — it is read at runtime
/// from the environment inside the running shell.
const BASH_RCFILE: &str = "\
# Source the user's normal interactive config first, if present.\n\
if [ -f /etc/bash.bashrc ]; then . /etc/bash.bashrc; fi\n\
if [ -f \"$HOME/.bashrc\" ]; then . \"$HOME/.bashrc\"; fi\n\
\n\
__snak_stage() {\n\
  READLINE_LINE=\"${SNAK_STAGED_CMD}\"\n\
  READLINE_POINT=${#READLINE_LINE}\n\
  bind -r '\\e[0n' 2>/dev/null\n\
}\n\
\n\
if [ -n \"${SNAK_STAGED_CMD}\" ]; then\n\
  history -s \"${SNAK_STAGED_CMD}\"\n\
  echo '# Command staged below (and in history: press Up). Review, then Enter to run — not auto-executed.'\n\
  bind -x '\"\\e[0n\": __snak_stage' 2>/dev/null\n\
  printf '\\e[5n'\n\
fi\n\
";

/// Write the rcfile to a temp path and return it.
fn write_rcfile() -> Result<std::path::PathBuf, String> {
    let path = temp_path("snak-stage", "bashrc");
    std::fs::write(&path, BASH_RCFILE).map_err(|e| format!("failed to write rcfile: {e}"))?;
    Ok(path)
}

/// A unique temp path: `<tmp>/<prefix>-<nanos>.<ext>`. Components are
/// app-controlled (never model input).
fn temp_path(prefix: &str, ext: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("{prefix}-{nanos}.{ext}"))
}

/// Open a terminal with `command` staged (pre-typed) but not executed.
///
/// Returns `Ok(())` once the terminal has been spawned. Rejects empty input.
#[tauri::command]
pub fn open_in_terminal(command: String) -> Result<(), String> {
    if command.trim().is_empty() {
        return Err("no command to stage".into());
    }
    launch_terminal(&command)
}

/// How an emulator takes "run this program with these args" on its command line.
/// Most use `-e prog args…`; GNOME-family use `-- prog args…`; a few run a bare
/// `prog args…`; wezterm needs `start -- prog args…`.
#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
enum ExecStyle {
    Dashe,
    DashDash,
    Bare,
    WeztermStart,
}

#[cfg(target_os = "linux")]
impl ExecStyle {
    fn prefix(self) -> &'static [&'static str] {
        match self {
            ExecStyle::Dashe => &["-e"],
            ExecStyle::DashDash => &["--"],
            ExecStyle::Bare => &[],
            ExecStyle::WeztermStart => &["start", "--"],
        }
    }
}

/// Known emulators and their exec style. The user's configured terminal (below)
/// is matched against this table to pick the right flag; an unknown one defaults
/// to `-e` (the most common convention).
#[cfg(target_os = "linux")]
const KNOWN_TERMINALS: &[(&str, ExecStyle)] = &[
    ("konsole", ExecStyle::Dashe),
    ("ghostty", ExecStyle::Dashe),
    ("alacritty", ExecStyle::Dashe),
    ("foot", ExecStyle::Dashe),
    ("kitty", ExecStyle::Bare),
    ("wezterm", ExecStyle::WeztermStart),
    ("gnome-terminal", ExecStyle::DashDash),
    ("kgx", ExecStyle::DashDash), // GNOME Console
    ("xfce4-terminal", ExecStyle::Dashe),
    ("x-terminal-emulator", ExecStyle::Dashe),
    ("xterm", ExecStyle::Dashe),
];

/// The exec style for `program` (basename), or `-e` if we don't recognize it.
#[cfg(target_os = "linux")]
fn exec_style_for(program: &str) -> ExecStyle {
    KNOWN_TERMINALS
        .iter()
        .find(|(name, _)| *name == program)
        .map(|(_, style)| *style)
        .unwrap_or(ExecStyle::Dashe)
}

/// Reduce a configured terminal value to its binary name: take the first
/// whitespace-separated token (dropping any flags the desktop stored, e.g.
/// `ghostty --gtk-single-instance=true`) and strip the directory.
#[cfg(target_os = "linux")]
fn terminal_binary(value: &str) -> Option<String> {
    let first = value.split_whitespace().next()?;
    let base = first.rsplit('/').next()?.trim();
    if base.is_empty() {
        None
    } else {
        Some(base.to_string())
    }
}

/// The user's preferred terminal(s), most-preferred first: the `$TERMINAL` env
/// var, then the KDE-configured `TerminalApplication` (read via kreadconfig).
/// There is no portable cross-desktop "default terminal" API, so we consult the
/// few sources that exist and otherwise fall back to the known list.
#[cfg(target_os = "linux")]
fn preferred_terminals() -> Vec<String> {
    let mut out = Vec::new();
    if let Some(t) = std::env::var("TERMINAL")
        .ok()
        .and_then(|v| terminal_binary(&v))
    {
        out.push(t);
    }
    for bin in ["kreadconfig6", "kreadconfig5"] {
        if let Ok(o) = std::process::Command::new(bin)
            .args(["--group", "General", "--key", "TerminalApplication"])
            .output()
        {
            if o.status.success() {
                if let Some(t) = terminal_binary(&String::from_utf8_lossy(&o.stdout)) {
                    out.push(t);
                    break;
                }
            }
        }
    }
    out
}

#[cfg(target_os = "linux")]
fn launch_terminal(command: &str) -> Result<(), String> {
    let rcfile = write_rcfile()?;
    // `<term> <exec-prefix> bash --rcfile <rc> -i` starts an interactive shell
    // that stages (does not run) the command. The command is passed only via the
    // env var, never on the argv / shell line.
    let try_spawn = |program: &str, style: ExecStyle| -> std::io::Result<std::process::Child> {
        let mut cmd = std::process::Command::new(program);
        cmd.args(style.prefix())
            .arg("bash")
            .arg("--rcfile")
            .arg(&rcfile)
            .arg("-i")
            .env(STAGED_CMD_ENV, command);
        cmd.spawn()
    };

    // The user's configured terminal first, then the known fallbacks. Dedupe so
    // a configured terminal already in the list isn't tried twice.
    let preferred = preferred_terminals();
    let candidates = preferred
        .iter()
        .map(|p| (p.as_str(), exec_style_for(p)))
        .chain(KNOWN_TERMINALS.iter().map(|(n, s)| (*n, *s)));

    let mut tried: Vec<String> = Vec::new();
    for (program, style) in candidates {
        if tried.iter().any(|t| t == program) {
            continue;
        }
        tried.push(program.to_string());
        match try_spawn(program, style) {
            Ok(_) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("failed to launch {program}: {e}")),
        }
    }
    Err(format!(
        "no supported terminal emulator found (tried {})",
        tried.join(", ")
    ))
}

#[cfg(target_os = "macos")]
fn launch_terminal(command: &str) -> Result<(), String> {
    let rcfile = write_rcfile()?;

    // Terminal.app cannot take an env var for a new window directly, and running
    // a `.command` file would EXECUTE its contents. So we open a tiny launcher
    // `.command` that: reads the staged command from a sibling DATA file into the
    // env var, then `exec`s interactive bash with our rcfile (which stages, not
    // runs, the command). The model command is only ever written to / read from
    // the data file as bytes — never interpolated into shell syntax.
    let cmd_file = temp_path("snak-cmd", "txt");
    std::fs::write(&cmd_file, command).map_err(|e| format!("failed to write command file: {e}"))?;

    let launcher = format!(
        "#!/bin/bash\n\
         export {env}=\"$(cat {file})\"\n\
         exec bash --rcfile {rc} -i\n",
        env = STAGED_CMD_ENV,
        // App-controlled temp paths (tmpdir + nanos): no metacharacters, but
        // single-quote defensively anyway.
        file = shell_single_quote(&cmd_file.to_string_lossy()),
        rc = shell_single_quote(&rcfile.to_string_lossy()),
    );
    let launcher_path = temp_path("snak-launch", "command");
    std::fs::write(&launcher_path, launcher)
        .map_err(|e| format!("failed to write launcher: {e}"))?;

    use std::os::unix::fs::PermissionsExt;
    let mut perms = std::fs::metadata(&launcher_path)
        .map_err(|e| e.to_string())?
        .permissions();
    perms.set_mode(0o700);
    std::fs::set_permissions(&launcher_path, perms).map_err(|e| e.to_string())?;

    std::process::Command::new("open")
        .arg("-a")
        .arg("Terminal")
        .arg(&launcher_path)
        .spawn()
        .map_err(|e| format!("failed to open Terminal: {e}"))?;
    Ok(())
}

/// Single-quote a string for safe embedding in a generated shell script. Only
/// used on app-controlled temp paths (never model command text).
#[cfg(target_os = "macos")]
fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn launch_terminal(_command: &str) -> Result<(), String> {
    let _ = write_rcfile; // silence unused-fn warning on unsupported platforms
    Err("opening a terminal is not supported on this platform yet".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rcfile_stages_without_executing() {
        // The rcfile must never run the staged command itself: no bare command
        // expansion, only assignment to the readline buffer / history.
        assert!(BASH_RCFILE.contains("READLINE_LINE=\"${SNAK_STAGED_CMD}\""));
        assert!(BASH_RCFILE.contains("history -s \"${SNAK_STAGED_CMD}\""));
        // It must NOT eval/exec the staged command.
        assert!(!BASH_RCFILE.contains("eval"));
        assert!(!BASH_RCFILE.contains("$(${SNAK_STAGED_CMD})"));
    }

    #[test]
    fn empty_command_is_rejected() {
        assert!(open_in_terminal("   \n  ".to_string()).is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn terminal_binary_strips_path_and_flags() {
        assert_eq!(
            terminal_binary("/usr/bin/ghostty --gtk-single-instance=true").as_deref(),
            Some("ghostty")
        );
        assert_eq!(terminal_binary("konsole").as_deref(), Some("konsole"));
        assert_eq!(terminal_binary("   ").as_deref(), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn exec_style_defaults_to_dashe_for_unknown() {
        // Known GNOME terminal uses `--`; an unknown one falls back to `-e`.
        assert!(matches!(
            exec_style_for("gnome-terminal"),
            ExecStyle::DashDash
        ));
        assert!(matches!(exec_style_for("kitty"), ExecStyle::Bare));
        assert!(matches!(exec_style_for("some-new-term"), ExecStyle::Dashe));
    }
}
