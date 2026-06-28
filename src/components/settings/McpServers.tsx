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
import { NativeSelect } from "@/components/NativeSelect";
import {
  BUILTIN_SYSDEBUG_SERVER,
  BUILTIN_WEB_SERVER,
  formatEnvText,
  KEYED_SEARCH_PROVIDERS,
  listTools,
  loadAllowCloudSysTools,
  loadAutoApproveSysTools,
  loadServers,
  mcpCloseServerSessions,
  parseEnvText,
  saveServers,
  setAllowCloudSysTools,
  setAutoApproveSysTools,
  setSearchApiKey,
  type McpListedTool,
  type McpServer,
  type McpServerToolError,
  type McpTransport,
  type WebSearchProvider,
} from "@/lib/mcp";
import { confirmDialog } from "@/store/confirm";
import { t as tNow, useT } from "@/store/i18n";
import { ShieldAlert } from "lucide-react";

/** Shared styling for the env-vars textareas (add + edit forms). */
const ENV_TEXTAREA_CLASS =
  "border-input bg-transparent placeholder:text-muted-foreground focus-visible:ring-ring rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-1 focus-visible:outline-none";

/** Fire-and-forget MCP session teardown: a backend hiccup must not disrupt the
 * settings UI, so log and move on (the idle reaper would reclaim them anyway). */
function closeServerSessions(id: string) {
  void mcpCloseServerSessions(id).catch((e) =>
    console.warn("mcpCloseServerSessions failed:", e),
  );
}

/**
 * MCP servers settings card (T13). Lets the user toggle the built-in web-browse
 * server, add/remove custom stdio or HTTP MCP servers, and refresh the tool list
 * each server exposes. Config is persisted in the `settings` table via
 * `saveServers`; `chat_stream` reads the enabled list and exposes their tools to
 * the model. When everything here is disabled, chat behaves exactly as before.
 */
export function McpServers() {
  const t = useT();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<McpListedTool[]>([]);
  const [serverErrors, setServerErrors] = useState<McpServerToolError[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cloud opt-in for the read-only system-diagnostics server (default off).
  const [allowCloudSys, setAllowCloudSys] = useState(false);
  // Persisted "auto mode": run the read-only system tools without a per-call
  // prompt (default off). Never covers the arbitrary `run_command` runner.
  const [autoApprove, setAutoApprove] = useState(false);

  // Draft for the "add custom server" row.
  const [draftLabel, setDraftLabel] = useState("");
  const [draftTransport, setDraftTransport] = useState<McpTransport>("stdio");
  const [draftTarget, setDraftTarget] = useState("");
  const [draftEnv, setDraftEnv] = useState("");

  // Inline edit state for custom (non-builtin) servers.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState("");
  const [editEnv, setEditEnv] = useState("");

  // Web-search API key entry (T52), for keyed providers (Brave/Serper).
  const [searchKey, setSearchKey] = useState("");
  const [searchKeySaved, setSearchKeySaved] = useState(false);

  /** Change the built-in web server's search backend. */
  function setSearchProvider(provider: WebSearchProvider) {
    setSearchKey("");
    setSearchKeySaved(false);
    void persist(
      servers.map((s) =>
        s.id === BUILTIN_WEB_SERVER.id
          ? { ...s, search_provider: provider }
          : s,
      ),
    );
  }

  async function saveSearchKey(provider: WebSearchProvider) {
    const key = searchKey.trim();
    if (!key) return;
    try {
      await setSearchApiKey(provider, key);
      setSearchKey("");
      setSearchKeySaved(true);
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void loadServers().then(setServers);
    void loadAllowCloudSysTools().then(setAllowCloudSys);
    void loadAutoApproveSysTools().then(setAutoApprove);
  }, []);

  async function setAutoApproveSys(auto: boolean) {
    await setAutoApproveSysTools(auto);
    setAutoApprove(auto);
  }

  // Enabling cloud access for system diagnostics requires confirming a full
  // risk dialog; disabling (tightening) is immediate.
  async function setCloudSys(allow: boolean) {
    if (allow) {
      const ok = await confirmDialog({
        title: tNow("mcp.sysCloudRiskTitle"),
        description: tNow("mcp.sysCloudRiskBody"),
        confirmText: tNow("mcp.sysCloudRiskConfirm"),
        destructive: true,
      });
      if (!ok) return;
    }
    await setAllowCloudSysTools(allow);
    setAllowCloudSys(allow);
  }

  async function persist(next: McpServer[]) {
    setServers(next);
    await saveServers(next);
  }

  function toggle(id: string) {
    const next = servers.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s,
    );
    const nowEnabled = next.find((s) => s.id === id)?.enabled;
    if (nowEnabled === false) closeServerSessions(id);
    void persist(next);
  }

  function remove(id: string) {
    closeServerSessions(id);
    void persist(servers.filter((s) => s.id !== id));
  }

  function beginEdit(s: McpServer) {
    setEditingId(s.id);
    setEditTarget(s.command ?? s.url ?? "");
    setEditEnv(formatEnvText(s.env));
  }

  function saveEdit(s: McpServer) {
    const target = editTarget.trim();
    if (!target) return;
    closeServerSessions(s.id);
    const env = s.transport === "stdio" ? parseEnvText(editEnv) : {};
    void persist(
      servers.map((x) =>
        x.id === s.id
          ? {
              ...x,
              ...(s.transport === "http" ? { url: target } : { command: target }),
              env: Object.keys(env).length > 0 ? env : undefined,
            }
          : x,
      ),
    );
    setEditingId(null);
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

    const env = draftTransport === "stdio" ? parseEnvText(draftEnv) : {};
    const server: McpServer = {
      id,
      label,
      transport: draftTransport,
      enabled: true,
      ...(draftTransport === "http" ? { url: target } : { command: target }),
      ...(Object.keys(env).length > 0 ? { env } : {}),
    };
    void persist([...servers, server]);
    setDraftLabel("");
    setDraftTarget("");
    setDraftEnv("");
  }

  async function refreshTools() {
    setLoading(true);
    setError(null);
    try {
      const report = await listTools(servers.filter((s) => s.enabled));
      setTools(report.tools);
      setServerErrors(report.errors);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      <CardHeader>
        <CardTitle>{t("mcp.title")}</CardTitle>
        <CardDescription>{t("mcp.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col">
          {servers.map((s) => (
            <div
              key={s.id}
              className="flex flex-col gap-2 border-t py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{s.label}</span>
                    <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                      {s.transport}
                    </span>
                    {s.builtin && (
                      <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                        {t("common.builtIn")}
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
                      aria-label={`${s.label} ${s.enabled ? t("common.enabled") : t("common.disabled")}`}
                    />
                    <span className="w-12">
                      {s.enabled ? t("common.enabled") : t("common.disabled")}
                    </span>
                  </label>
                  {!s.builtin && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          editingId === s.id ? setEditingId(null) : beginEdit(s)
                        }
                      >
                        {editingId === s.id
                          ? t("common.cancel")
                          : t("common.edit")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void confirmDialog({
                            title: tNow("mcp.removeTitle", { label: s.label }),
                            confirmText: tNow("common.remove"),
                            destructive: true,
                          }).then((ok) => {
                            if (ok) remove(s.id);
                          });
                        }}
                      >
                        {t("common.remove")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {editingId === s.id && (
                <div className="mt-2 flex flex-col gap-2">
                  <Input
                    value={editTarget}
                    onChange={(e) => setEditTarget(e.target.value)}
                    placeholder={
                      s.transport === "http"
                        ? "https://server/mcp"
                        : "command --arg"
                    }
                  />
                  {s.transport === "stdio" && (
                    <textarea
                      className={ENV_TEXTAREA_CLASS}
                      rows={2}
                      aria-label={t("mcp.envLabel")}
                      placeholder={t("mcp.envPlaceholder")}
                      value={editEnv}
                      onChange={(e) => setEditEnv(e.target.value)}
                    />
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    className="self-start"
                    onClick={() => saveEdit(s)}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              )}
              {s.id === BUILTIN_WEB_SERVER.id && s.enabled && (
                <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2 text-xs">
                  <span className="text-muted-foreground">
                    {t("mcp.searchProviderHint")}
                  </span>
                  <NativeSelect
                    className="h-9 self-start"
                    value={s.search_provider ?? "duckduckgo"}
                    onChange={(e) =>
                      setSearchProvider(e.target.value as WebSearchProvider)
                    }
                    aria-label={t("mcp.searchProvider")}
                  >
                    <option value="duckduckgo">
                      {t("mcp.searchProviderDuckduckgo")}
                    </option>
                    <option value="brave">
                      {t("mcp.searchProviderBrave")}
                    </option>
                    <option value="serper">
                      {t("mcp.searchProviderSerper")}
                    </option>
                  </NativeSelect>
                  {s.search_provider &&
                    KEYED_SEARCH_PROVIDERS.includes(s.search_provider) && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="password"
                          autoComplete="off"
                          placeholder={t("mcp.searchApiKeyPlaceholder", {
                            provider: s.search_provider,
                          })}
                          value={searchKey}
                          onChange={(e) => {
                            setSearchKey(e.target.value);
                            setSearchKeySaved(false);
                          }}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!searchKey.trim()}
                          onClick={() =>
                            void saveSearchKey(s.search_provider!)
                          }
                        >
                          {searchKeySaved
                            ? t("mcp.searchApiKeySaved")
                            : t("common.save")}
                        </Button>
                      </div>
                    )}
                </div>
              )}
              {s.id === BUILTIN_SYSDEBUG_SERVER.id && s.enabled && (
                <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2 text-xs">
                  <div className="text-muted-foreground flex items-start gap-1.5">
                    <ShieldAlert
                      className={
                        allowCloudSys
                          ? "text-destructive mt-0.5 size-3.5 shrink-0"
                          : "mt-0.5 size-3.5 shrink-0"
                      }
                      aria-hidden
                    />
                    <span>
                      {allowCloudSys
                        ? t("mcp.sysCloudAllowed")
                        : t("mcp.sysLocalOnly")}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant={allowCloudSys ? "outline" : "secondary"}
                    className="self-start"
                    onClick={() => void setCloudSys(!allowCloudSys)}
                  >
                    {allowCloudSys
                      ? t("mcp.sysRestrictLocal")
                      : t("mcp.sysAllowCloud")}
                  </Button>
                  <div className="text-muted-foreground border-t pt-2">
                    {t("mcp.sysAutoApproveExplain")}
                  </div>
                  <Button
                    size="sm"
                    variant={autoApprove ? "outline" : "secondary"}
                    className="self-start"
                    onClick={() => void setAutoApproveSys(!autoApprove)}
                  >
                    {autoApprove
                      ? t("mcp.sysAutoApproveOff")
                      : t("mcp.sysAutoApproveOn")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            {t("mcp.addCustom")}
          </span>
          <Input
            placeholder={t("mcp.labelPlaceholder")}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
          />
          <div className="flex gap-2">
            <NativeSelect
              className="h-9 w-24 shrink-0"
              value={draftTransport}
              onChange={(e) =>
                setDraftTransport(e.target.value as McpTransport)
              }
            >
              <option value="stdio">stdio</option>
              <option value="http">http</option>
            </NativeSelect>
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
          {draftTransport === "stdio" && (
            <textarea
              className={ENV_TEXTAREA_CLASS}
              rows={2}
              aria-label={t("mcp.envLabel")}
              placeholder={t("mcp.envPlaceholder")}
              value={draftEnv}
              onChange={(e) => setDraftEnv(e.target.value)}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={!draftLabel.trim() || !draftTarget.trim()}
            onClick={addCustom}
          >
            {t("mcp.addServer")}
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
              {t("mcp.availableTools")}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => void refreshTools()}
            >
              {loading ? t("common.loading") : t("common.refresh")}
            </Button>
          </div>
          {serverErrors.length > 0 && (
            <ul className="flex flex-col gap-1">
              {serverErrors.map((e) => (
                <li
                  key={e.server_id}
                  className="text-destructive text-xs break-all"
                >
                  <code>{e.server_id}</code>: {e.message}
                </li>
              ))}
            </ul>
          )}
          {tools.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("mcp.refreshHint")}
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
