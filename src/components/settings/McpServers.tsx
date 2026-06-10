import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  listTools,
  loadServers,
  saveServers,
  type McpListedTool,
  type McpServer,
  type McpTransport,
} from "@/lib/mcp";
import { confirmDialog } from "@/store/confirm";

/**
 * MCP servers settings card (T13). Lets the user toggle the built-in web-browse
 * server, add/remove custom stdio or HTTP MCP servers, and refresh the tool list
 * each server exposes. Config is persisted in the `settings` table via
 * `saveServers`; `chat_stream` reads the enabled list and exposes their tools to
 * the model. When everything here is disabled, chat behaves exactly as before.
 */
export function McpServers() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<McpListedTool[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Draft for the "add custom server" row.
  const [draftLabel, setDraftLabel] = useState("");
  const [draftTransport, setDraftTransport] = useState<McpTransport>("stdio");
  const [draftTarget, setDraftTarget] = useState("");

  useEffect(() => {
    void loadServers().then(setServers);
  }, []);

  async function persist(next: McpServer[]) {
    setServers(next);
    await saveServers(next);
  }

  function toggle(id: string) {
    void persist(
      servers.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  }

  function remove(id: string) {
    void persist(servers.filter((s) => s.id !== id));
  }

  function addCustom() {
    const target = draftTarget.trim();
    const label = draftLabel.trim();
    if (!target || !label) return;
    // Derive a stable id from the label; de-dupe against existing.
    const base =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "server";
    let id = base;
    let n = 1;
    while (servers.some((s) => s.id === id)) id = `${base}-${++n}`;

    const server: McpServer = {
      id,
      label,
      transport: draftTransport,
      enabled: true,
      ...(draftTransport === "http" ? { url: target } : { command: target }),
    };
    void persist([...servers, server]);
    setDraftLabel("");
    setDraftTarget("");
  }

  async function refreshTools() {
    setLoading(true);
    setError(null);
    try {
      setTools(await listTools(servers.filter((s) => s.enabled)));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>MCP servers</CardTitle>
        <CardDescription>
          Connect Model Context Protocol servers to give the model tools. The
          built-in web-browsing server works out of the box. Add custom servers
          over stdio (a command) or HTTP (a URL). Enabled servers&apos; tools are
          offered to the model on every message.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex items-start justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.label}</span>
                  <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                    {s.transport}
                  </span>
                  {s.builtin && (
                    <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                      built-in
                    </span>
                  )}
                </div>
                {(s.command || s.url) && (
                  <span className="text-muted-foreground text-xs break-all">
                    {s.command ?? s.url}
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs select-none">
                  <Switch
                    checked={s.enabled}
                    onCheckedChange={() => toggle(s.id)}
                    aria-label={`${s.label} ${s.enabled ? "enabled" : "disabled"}`}
                  />
                  <span className="w-12">{s.enabled ? "Enabled" : "Disabled"}</span>
                </label>
                {!s.builtin && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void confirmDialog({
                        title: `Remove "${s.label}"?`,
                        confirmText: "Remove",
                        destructive: true,
                      }).then((ok) => {
                        if (ok) remove(s.id);
                      });
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            Add custom server
          </span>
          <Input
            placeholder="Label (e.g. GitHub)"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
          />
          <div className="flex gap-2">
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={draftTransport}
              onChange={(e) =>
                setDraftTransport(e.target.value as McpTransport)
              }
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </select>
            <Input
              placeholder={
                draftTransport === "http"
                  ? "https://server/mcp"
                  : "command --arg"
              }
              value={draftTarget}
              onChange={(e) => setDraftTarget(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!draftLabel.trim() || !draftTarget.trim()}
            onClick={addCustom}
          >
            Add server
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              Available tools
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void refreshTools()}
            >
              {loading ? "Loading…" : "Refresh"}
            </Button>
          </div>
          {tools.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Refresh to list tools from enabled servers.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tools.map((t) => (
                <li key={`${t.server_id}__${t.name}`} className="text-sm">
                  <code>
                    {t.server_id}__{t.name}
                  </code>
                  {t.description && (
                    <span className="text-muted-foreground">
                      {" "}
                      — {t.description}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {error && <p className="text-destructive text-sm">{error}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
