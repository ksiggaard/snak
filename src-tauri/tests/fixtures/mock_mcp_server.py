#!/usr/bin/env python3
"""Minimal stateful stdio MCP server for tests. Exposes one tool, `increment`,
that returns a per-process running counter — so a *persisted* session returns
1, 2, 3..., while a respawn-per-call client would always get 1. JSON-RPC 2.0,
newline-framed, over stdin/stdout. Anything non-protocol goes to stderr."""
import sys
import json

counter = 0

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

def main():
    global counter
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = msg.get("method")
        mid = msg.get("id")
        if mid is None:
            # A notification (e.g. notifications/initialized) — no response.
            continue
        if method == "initialize":
            params = msg.get("params", {})
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": params.get("protocolVersion", "2025-03-26"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "mock", "version": "0.1"},
            }})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [
                {"name": "increment", "description": "increment a counter",
                 "inputSchema": {"type": "object", "properties": {}}}
            ]}})
        elif method == "tools/call":
            counter += 1
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "content": [{"type": "text", "text": str(counter)}],
                "isError": False,
            }})
        else:
            send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "method not found"}})

if __name__ == "__main__":
    main()
