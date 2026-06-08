import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useThreads } from "@/store/threads";
import { PROVIDERS } from "@/lib/providers";
import { cn } from "@/lib/utils";
import type { Provider } from "@/types/db";

const providerLabel = (p: Provider) =>
  PROVIDERS.find((x) => x.id === p)?.label ?? p;

export function ThreadList() {
  const threads = useThreads((s) => s.threads);
  const currentId = useThreads((s) => s.currentThreadId);
  const selectThread = useThreads((s) => s.selectThread);
  const startNewChat = useThreads((s) => s.startNewChat);
  const rename = useThreads((s) => s.rename);
  const remove = useThreads((s) => s.remove);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function beginEdit(id: string, title: string) {
    setEditingId(id);
    setDraft(title);
  }

  async function commitEdit() {
    if (editingId) await rename(editingId, draft);
    setEditingId(null);
  }

  return (
    <aside className="bg-card flex w-64 flex-col border-r">
      <div className="p-2">
        <Button
          className="w-full justify-start"
          variant="outline"
          onClick={() => startNewChat()}
        >
          <Plus className="size-4" />
          New chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {threads.length === 0 && (
          <p className="text-muted-foreground px-2 py-4 text-xs">
            No conversations yet.
          </p>
        )}
        {threads.map((t) => {
          const active = t.id === currentId;
          return (
            <div
              key={t.id}
              className={cn(
                "group flex items-center gap-1 rounded-md px-2 py-1.5",
                active ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              {editingId === t.id ? (
                <Input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-7 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => void selectThread(t.id)}
                  onDoubleClick={() => beginEdit(t.id, t.title)}
                  className="min-w-0 flex-1 text-left"
                  title="Double-click to rename"
                >
                  <div className="truncate text-sm">{t.title}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {providerLabel(t.provider)}
                  </div>
                </button>
              )}
              <button
                type="button"
                aria-label="Delete conversation"
                onClick={() => {
                  if (confirm(`Delete "${t.title}"?`)) void remove(t.id);
                }}
                className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
