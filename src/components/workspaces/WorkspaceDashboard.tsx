import { useRef } from "react";
import { FileText, Globe, MessageSquare, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWorkspaces } from "@/store/workspaces";
import { useThreads } from "@/store/threads";
import { useT } from "@/store/i18n";
import { prepareImage } from "@/lib/image";
import { setWorkspaceImages } from "@/lib/db";
import { useView } from "@/store/view";
import { useLayout } from "@/store/layout";

const RECENT_MEMORIES_COUNT = 5;

export function WorkspaceDashboard() {
  const t = useT();
  const openWorkspaceId = useWorkspaces((s) => s.openWorkspaceId);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const files = useWorkspaces((s) => s.openWorkspaceFiles);
  const memory = useWorkspaces((s) => s.openWorkspaceMemory);
  const setWorkspaceView = useWorkspaces((s) => s.setWorkspaceView);
  const refresh = useWorkspaces((s) => s.refresh);
  const threads = useThreads((s) => s.threads);
  const selectThread = useThreads((s) => s.selectThread);
  const closeWorkspace = useWorkspaces((s) => s.close);
  const showChat = useView((s) => s.showChat);
  const setCompactNav = useLayout((s) => s.setCompactNav);

  const profileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const workspace = workspaces.find((w) => w.id === openWorkspaceId);
  if (!workspace) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center text-sm">
        {t("workspace.notFound")}
      </div>
    );
  }

  const workspaceThreads = threads.filter(
    (th) => th.workspace_id === workspace.id,
  );
  const uploadedFiles = files.filter((f) => !f.source_url);
  const urlFiles = files.filter((f) => !!f.source_url);
  const recentMemories = [...memory]
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, RECENT_MEMORIES_COUNT);

  async function onPickProfileImage(list: FileList | null) {
    if (!list || list.length === 0 || !workspace) return;
    const file = list[0]!;
    const prepared = await prepareImage(file);
    await setWorkspaceImages(workspace.id, prepared.base64, workspace.cover_image);
    await refresh();
    if (profileInputRef.current) profileInputRef.current.value = "";
  }

  async function onPickCoverImage(list: FileList | null) {
    if (!list || list.length === 0 || !workspace) return;
    const file = list[0]!;
    const prepared = await prepareImage(file);
    await setWorkspaceImages(workspace.id, workspace.profile_image, prepared.base64);
    await refresh();
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  async function onRemoveProfileImage() {
    if (!workspace) return;
    await setWorkspaceImages(workspace.id, null, workspace.cover_image);
    await refresh();
  }

  async function onRemoveCoverImage() {
    if (!workspace) return;
    await setWorkspaceImages(workspace.id, workspace.profile_image, null);
    await refresh();
  }

  const initial = workspace.name.slice(0, 2).toUpperCase();

  return (
    <div className="bg-card flex flex-1 flex-col overflow-y-auto rounded-lg border">
      {/* Cover image banner */}
      <div className="relative h-32 shrink-0 overflow-hidden rounded-t-lg">
        {workspace.cover_image ? (
          <img
            src={`data:image/jpeg;base64,${workspace.cover_image}`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary/30 to-primary/10 h-full w-full bg-gradient-to-br" />
        )}
        {/* Cover image controls */}
        <div className="absolute right-2 top-2 flex gap-1">
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="bg-background/70 hover:bg-background/90 rounded px-2 py-1 text-xs"
            title={t("workspace.changeCoverImage")}
          >
            {t("workspace.coverImage")}
          </button>
          {workspace.cover_image && (
            <button
              type="button"
              onClick={() => void onRemoveCoverImage()}
              className="bg-background/70 hover:bg-background/90 rounded p-1"
              aria-label={t("workspace.removeCoverImage")}
            >
              <X className="size-3" />
            </button>
          )}
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void onPickCoverImage(e.target.files)}
        />
      </div>

      {/* Profile image + name row */}
      <div className="-mt-8 flex items-end gap-4 px-5 pb-3 pt-0">
        <div className="relative shrink-0">
          {workspace.profile_image ? (
            <img
              src={`data:image/jpeg;base64,${workspace.profile_image}`}
              alt={workspace.name}
              className="border-card size-16 rounded-full border-4 object-cover"
            />
          ) : (
            <div className="border-card bg-primary/20 text-primary flex size-16 items-center justify-center rounded-full border-4 text-xl font-bold">
              {initial}
            </div>
          )}
          <button
            type="button"
            onClick={() => profileInputRef.current?.click()}
            className="bg-background/70 hover:bg-background/90 absolute bottom-0 right-0 rounded-full p-0.5"
            aria-label={t("workspace.changeProfileImage")}
            title={t("workspace.changeProfileImage")}
          >
            <Settings2 className="size-3" />
          </button>
          {workspace.profile_image && (
            <button
              type="button"
              onClick={() => void onRemoveProfileImage()}
              className="bg-background/70 hover:bg-background/90 absolute -right-1 -top-1 rounded-full p-0.5"
              aria-label={t("workspace.removeProfileImage")}
            >
              <X className="size-3" />
            </button>
          )}
          <input
            ref={profileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickProfileImage(e.target.files)}
          />
        </div>
        <div className="mb-2 min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{workspace.name}</h1>
        </div>
        <div className="mb-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWorkspaceView("settings")}
          >
            <Settings2 className="size-4" />
            {t("workspace.settingsPage")}
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="border-t px-5 py-3">
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
          {t("workspace.stats")}
        </p>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-1.5 text-sm">
            <MessageSquare className="text-muted-foreground size-4" />
            <span>{t("workspace.statsChats", { n: workspaceThreads.length })}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <FileText className="text-muted-foreground size-4" />
            <span>{t("workspace.statsFiles", { n: uploadedFiles.length })}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <Globe className="text-muted-foreground size-4" />
            <span>{t("workspace.statsUrls", { n: urlFiles.length })}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">🧠</span>
            <span>{t("workspace.statsMemories", { n: memory.length })}</span>
          </div>
        </div>
      </div>

      {/* Chats */}
      <div className="border-t px-5 py-3">
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
          {t("workspace.chatsSection")}
        </p>
        {workspaceThreads.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("workspace.noChats")}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {workspaceThreads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className="hover:bg-accent/50 w-full rounded-md px-2 py-1.5 text-left text-sm"
                  onClick={() => {
                    showChat();
                    closeWorkspace();
                    setCompactNav(0);
                    void selectThread(thread.id);
                  }}
                >
                  <span className="truncate">{thread.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Files */}
      {uploadedFiles.length > 0 && (
        <div className="border-t px-5 py-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
            {t("workspace.filesSection")}
          </p>
          <ul className="flex flex-col gap-1">
            {uploadedFiles.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <FileText className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-muted-foreground text-xs">
                  {f.content.length.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* URLs */}
      {urlFiles.length > 0 && (
        <div className="border-t px-5 py-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
            {t("workspace.urlsSection")}
          </p>
          <ul className="flex flex-col gap-1">
            {urlFiles.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <Globe className="text-muted-foreground size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {f.source_url && (
                  <a
                    href={f.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground shrink-0 text-xs underline underline-offset-2"
                  >
                    {t("workspace.sourceUrl", { url: f.source_url })}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recent memories */}
      {recentMemories.length > 0 && (
        <div className="border-t px-5 py-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
            {t("workspace.recentMemories")}
          </p>
          <ul className="flex flex-col gap-1">
            {recentMemories.map((m) => (
              <li key={m.id} className="text-muted-foreground text-sm">
                <span className="line-clamp-2">{m.content}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
