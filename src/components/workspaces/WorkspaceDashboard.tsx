import { useRef, useState } from "react";
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

  const [repositioning, setRepositioning] = useState(false);
  const [repos, setRepos] = useState({ x: 0.5, y: 0.5, zoom: 1.0 });
  const [dragStart, setDragStart] = useState<{ mx: number; my: number; x: number; y: number } | null>(null);
  const [minZoomVal, setMinZoomVal] = useState(1.0);
  const imgRef = useRef<HTMLImageElement>(null);

  const [draggingCover, setDraggingCover] = useState(false);
  const [coverDrag, setCoverDrag] = useState<{ mx: number; my: number; x: number; y: number } | null>(null);
  const [coverPos, setCoverPos] = useState({ x: 0.5, y: 0.5 });
  const coverImgRef = useRef<HTMLImageElement>(null);

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

  function openReposition() {
    if (!workspace) return;
    setRepos({
      x: workspace.profile_image_x,
      y: workspace.profile_image_y,
      zoom: workspace.profile_image_zoom,
    });
    setRepositioning(true);
    // Compute minZoom after next render when imgRef is populated
    requestAnimationFrame(() => {
      if (imgRef.current) {
        const d = 256;
        setMinZoomVal(d / Math.min(imgRef.current.naturalWidth, imgRef.current.naturalHeight));
      }
    });
  }

  function closeReposition() {
    setRepositioning(false);
    setDragStart(null);
  }

  async function saveReposition() {
    if (!workspace) return;
    await setImages(
      workspace.id,
      workspace.profile_image,
      workspace.cover_image,
      repos.x,
      repos.y,
      repos.zoom,
      workspace.cover_image_x,
      workspace.cover_image_y,
    );
    setRepositioning(false);
    setDragStart(null);
  }

  async function startCoverReposition() {
    if (!workspace) return;
    setCoverPos({
      x: workspace.cover_image_x,
      y: workspace.cover_image_y,
    });
    setDraggingCover(true);
  }

  return (
    <div aria-label={t("workspace.dashboard")} className="bg-card flex flex-1 flex-col overflow-y-auto rounded-lg border">
      {/* Cover image banner */}
      <div className="relative h-32 shrink-0 overflow-hidden rounded-t-lg">
        {draggingCover ? (
          <div
            className="h-full w-full cursor-grab active:cursor-grabbing"
            onMouseDown={(e) => {
              if (!coverImgRef.current) return;
              setCoverDrag({ mx: e.clientX, my: e.clientY, x: coverPos.x, y: coverPos.y });
              e.preventDefault();
            }}
            onMouseMove={(e) => {
              if (!coverDrag || !coverImgRef.current) return;
              const rect = coverImgRef.current.getBoundingClientRect();
              const dx = (e.clientX - coverDrag.mx) / rect.width;
              const dy = (e.clientY - coverDrag.my) / rect.height;
              setCoverPos({
                x: Math.max(0, Math.min(1, coverDrag.x - dx)),
                y: Math.max(0, Math.min(1, coverDrag.y - dy)),
              });
            }}
            onMouseUp={async () => {
              setCoverDrag(null);
              setDraggingCover(false);
              if (!workspace) return;
              await setImages(
                workspace.id,
                workspace.profile_image,
                workspace.cover_image,
                workspace.profile_image_x,
                workspace.profile_image_y,
                workspace.profile_image_zoom,
                coverPos.x,
                coverPos.y,
              );
            }}
            onMouseLeave={() => setCoverDrag(null)}
          >
            {workspace.cover_image && (
              <img
                ref={coverImgRef}
                src={`data:image/jpeg;base64,${workspace.cover_image}`}
                alt=""
                className="h-full w-full object-cover"
                style={{ objectPosition: `${coverPos.x * 100}% ${coverPos.y * 100}%` }}
                draggable={false}
              />
            )}
          </div>
        ) : (
          /* Drop-to-replace + DropdownMenu trigger (from Task 7) wraps the image */
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
                    } catch { /* ignore */ }
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
              <DropdownMenuItem onClick={startCoverReposition}>
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
        )}
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
              <DropdownMenuItem onClick={openReposition}>
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
      {/* Profile image reposition overlay */}
      {repositioning && (
        <div
          className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeReposition();
          }}
        >
          <div className="flex flex-col items-center gap-4">
            <div
              className="relative size-64 overflow-hidden rounded-full border-4 border-white/30"
              onMouseDown={(e) => {
                if (!imgRef.current) return;
                setDragStart({
                  mx: e.clientX,
                  my: e.clientY,
                  x: repos.x,
                  y: repos.y,
                });
                e.preventDefault();
              }}
              onMouseMove={(e) => {
                if (!dragStart || !imgRef.current) return;
                const rect = imgRef.current.getBoundingClientRect();
                const dx = (e.clientX - dragStart.mx) / rect.width;
                const dy = (e.clientY - dragStart.my) / rect.height;
                setRepos((r) => ({
                  ...r,
                  x: Math.max(0, Math.min(1, dragStart.x - dx)),
                  y: Math.max(0, Math.min(1, dragStart.y - dy)),
                }));
              }}
              onMouseUp={() => setDragStart(null)}
              onMouseLeave={() => setDragStart(null)}
            >
              {workspace?.profile_image && (
                <img
                  ref={imgRef}
                  src={`data:image/jpeg;base64,${workspace.profile_image}`}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{
                    objectPosition: `${repos.x * 100}% ${repos.y * 100}%`,
                    transform: `scale(${repos.zoom})`,
                    transformOrigin: "center",
                  }}
                  draggable={false}
                />
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">
                {t("workspace.imageZoom")}
              </span>
              <input
                type="range"
                min={minZoomVal}
                max={3.0}
                step={0.01}
                value={repos.zoom}
                onChange={(e) =>
                  setRepos((r) => ({ ...r, zoom: parseFloat(e.target.value) }))
                }
                className="w-32"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void saveReposition()}>
                {t("common.save")}
              </Button>
              <Button size="sm" variant="outline" onClick={closeReposition}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
