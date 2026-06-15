//! External-stdio MCP sessions via the `rmcp` SDK.
//!
//! Each enabled external **stdio** server is kept alive as a persistent child
//! process, scoped per chat thread. `rmcp`'s `RunningService` is the session: it
//! runs the initialize/initialized handshake once and correlates request ids, so
//! many `tools/call`s reuse one process and the server keeps its state across a
//! thread's messages. Sessions are torn down on idle, thread deletion, config
//! change, and app exit. Built-in and HTTP servers do NOT use this module.

use anyhow::anyhow;

/// Split a whitespace-delimited command line into (program, args).
fn parse_command(command: &str) -> anyhow::Result<(String, Vec<String>)> {
    let mut parts = command.split_whitespace();
    let prog = parts
        .next()
        .ok_or_else(|| anyhow!("empty stdio command"))?
        .to_string();
    Ok((prog, parts.map(|s| s.to_string()).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_program_and_args() {
        let (prog, args) =
            parse_command("npx -y @mozilla/firefox-devtools-mcp@latest --headless").unwrap();
        assert_eq!(prog, "npx");
        assert_eq!(
            args,
            ["-y", "@mozilla/firefox-devtools-mcp@latest", "--headless"]
        );
    }

    #[test]
    fn empty_command_errors() {
        assert!(parse_command("   ").is_err());
    }
}
