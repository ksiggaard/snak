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
//! - It is handed to the terminal via the `KDE_LLM_STAGED_CMD` environment
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
const STAGED_CMD_ENV: &str = "KDE_LLM_STAGED_CMD";

/// A bash `--rcfile` that, on interactive startup, sources the user's normal
/// config and then stages `$KDE_LLM_STAGED_CMD` **without executing it**:
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
__kde_llm_stage() {\n\
  READLINE_LINE=\"${KDE_LLM_STAGED_CMD}\"\n\
  READLINE_POINT=${#READLINE_LINE}\n\
  bind -r '\\e[0n' 2>/dev/null\n\
}\n\
\n\
if [ -n \"${KDE_LLM_STAGED_CMD}\" ]; then\n\
  history -s \"${KDE_LLM_STAGED_CMD}\"\n\
  echo '# Command staged below (and in history: press Up). Review, then Enter to run — not auto-executed.'\n\
  bind -x '\"\\e[0n\": __kde_llm_stage' 2>/dev/null\n\
  printf '\\e[5n'\n\
fi\n\
";

/// Write the rcfile to a temp path and return it.
fn write_rcfile() -> Result<std::path::PathBuf, String> {
    let path = temp_path("kde-llm-stage", "bashrc");
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

#[cfg(target_os = "linux")]
fn launch_terminal(command: &str) -> Result<(), String> {
    let rcfile = write_rcfile()?;
    // Konsole on KDE. `-e bash --rcfile <rc> -i` starts an interactive shell
    // that stages (does not run) the command. The command is passed only via
    // the env var, never on the argv / shell line.
    let try_spawn = |program: &str| -> std::io::Result<std::process::Child> {
        std::process::Command::new(program)
            .arg("-e")
            .arg("bash")
            .arg("--rcfile")
            .arg(&rcfile)
            .arg("-i")
            .env(STAGED_CMD_ENV, command)
            .spawn()
    };

    // Prefer Konsole (KDE); fall back to common emulators.
    for program in ["konsole", "x-terminal-emulator", "xterm"] {
        match try_spawn(program) {
            Ok(_) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("failed to launch {program}: {e}")),
        }
    }
    Err("no supported terminal emulator found (tried konsole, x-terminal-emulator, xterm)".into())
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
    let cmd_file = temp_path("kde-llm-cmd", "txt");
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
    let launcher_path = temp_path("kde-llm-launch", "command");
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
        assert!(BASH_RCFILE.contains("READLINE_LINE=\"${KDE_LLM_STAGED_CMD}\""));
        assert!(BASH_RCFILE.contains("history -s \"${KDE_LLM_STAGED_CMD}\""));
        // It must NOT eval/exec the staged command.
        assert!(!BASH_RCFILE.contains("eval"));
        assert!(!BASH_RCFILE.contains("$(${KDE_LLM_STAGED_CMD})"));
    }

    #[test]
    fn empty_command_is_rejected() {
        assert!(open_in_terminal("   \n  ".to_string()).is_err());
    }
}
