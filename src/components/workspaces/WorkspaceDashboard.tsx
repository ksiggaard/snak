import { useRef } from "react";
import { FileText, Globe, Image as ImageIcon, MessageSquare, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspaces } from "@/store/workspaces";
import { useThreads } from "@/store/threads";
import { useT } from "@/store/i18n";
import { prepareImage } from "@/lib/image";
import { splitWorkspaceFiles, recentMemories, workspaceFilesSize } from "@/lib/workspaces";
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
  const setImages = useWorkspaces((s) => s.setImages);
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
  const { uploaded: uploadedFiles, urls: urlFiles } = splitWorkspaceFiles(files);
  const topMemories = recentMemories(memory, RECENT_MEMORIES_COUNT);
  const totalChars = workspaceFilesSize(files);

  async function onPickProfileImage(list: FileList | null) {
    if (!list || list.length === 0 || !workspace) return;
    const file = list[0]!;
    const prepared = await prepareImage(file);
    await setImages(workspace.id, prepared.base64, workspace.cover_image);
    if (profileInputRef.current) profileInputRef.current.value = "";
  }

  async function onPickCoverImage(list: FileList | null) {
    if (!list || list.length === 0 || !workspace) return;
    const file = list[0]!;
    const prepared = await prepareImage(file);
    await setImages(workspace.id, workspace.profile_image, prepared.base64);
    if (coverInputRef.current) coverInputRef.current.value = "";
  }

  async function onRemoveProfileImage() {
    if (!workspace) return;
    await setImages(workspace.id, null, workspace.cover_image);
  }

  async function onRemoveCoverImage() {
    if (!workspace) return;
    await setImages(workspace.id, workspace.profile_image, null);
  }

  const initial = workspace.name.slice(0, 2).toUpperCase();

  return (
    <div aria-label={t("workspace.dashboard")} className="bg-card flex flex-1 flex-col overflow-y-auto rounded-lg border">
      {/* Cover image banner */}
      <div className="relative h-32 shrink-0 overflow-hidden rounded-t-lg">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div
              className="h-full w-full cursor-pointer"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files[0];
                if (!file || !workspace) return;
                void (async () => {
                  try {
                    const prepared = await prepareImage(file);
                    await setImages(workspace.id, workspace.profile_image, prepared.base64);
                  } catch { /* ignore non-image drops */ }
                })();
              }}
            >
              {workspace.cover_image ? (
                <img
                  src={`data:image/jpeg;base64,${workspace.cover_image}`}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${workspace.cover_image_x * 100}% ${workspace.cover_image_y * 100}%`,
                  }}
                />
              ) : (
                <div className="from-primary/30 to-primary/10 h-full w-full bg-gradient-to-br" />
              )}
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onClick={() => {
                /* Reposition starts inline drag mode — handled in Task 9 */
              }}
            >
              <ImageIcon className="size-3.5" />
              {t("workspace.repositionImage")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => coverInputRef.current?.click()}>
              <ImageIcon className="size-3.5" />
              {t("workspace.replaceImage")}
            </DropdownMenuItem>
            {workspace.cover_image && (
              <DropdownMenuItem onClick={() => void onRemoveCoverImage()}>
                <X className="size-3.5" />
                {t("workspace.clearImage")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div
                className="cursor-pointer"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files[0];
                  if (!file || !workspace) return;
                  void (async () => {
                    try {
                      const prepared = await prepareImage(file);
                      await setImages(workspace.id, prepared.base64, workspace.cover_image);
                    } catch { /* ignore */ }
                  })();
                }}
              >
                {workspace.profile_image ? (
                  <img
                    src={`data:image/jpeg;base64,${workspace.profile_image}`}
                    alt={workspace.name}
                    className="border-card size-16 rounded-full border-4 object-cover"
                    style={{
                      objectPosition: `${workspace.profile_image_x * 100}% ${workspace.profile_image_y * 100}%`,
                      transform: `scale(${workspace.profile_image_zoom})`,
                      transformOrigin: "center",
                    }}
                  />
                ) : (
                  <div className="border-card bg-primary/20 text-primary flex size-16 items-center justify-center rounded-full border-4 text-xl font-bold">
                    {initial}
                  </div>
                )}
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem
                onClick={() => {
                  /* Opens reposition overlay — handled in Task 8 */
                }}
              >
                <ImageIcon className="size-3.5" />
                {t("workspace.repositionImage")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => profileInputRef.current?.click()}>
                <ImageIcon className="size-3.5" />
                {t("workspace.replaceImage")}
              </DropdownMenuItem>
              {workspace.profile_image && (
                <DropdownMenuItem onClick={() => void onRemoveProfileImage()}>
                  <X className="size-3.5" />
                  {t("workspace.clearImage")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
            aria-label={t("workspace.openSettings")}
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
          {totalChars > 0 && (
            <div className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">∑</span>
              <span>{t("workspace.totalFileSize", { size: totalChars.toLocaleString() })}</span>
            </div>
          )}
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
      <div className="border-t px-5 py-3">
        <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
          {t("workspace.urlsSection")}
        </p>
        {urlFiles.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("workspace.noUrls")}</p>
        ) : (
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
        )}
      </div>

      {/* Recent memories */}
      {topMemories.length > 0 && (
        <div className="border-t px-5 py-3">
          <p className="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wide">
            {t("workspace.recentMemories")}
          </p>
          <ul className="flex flex-col gap-1">
            {topMemories.map((m) => (
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
