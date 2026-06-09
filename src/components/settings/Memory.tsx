import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addUserMemory,
  deleteUserMemory,
  getSetting,
  listUserMemory,
  setSetting,
  SYSTEM_PROMPT_ADDENDUM_KEY,
  updateUserMemory,
} from "@/lib/db";
import type { UserMemory } from "@/types/db";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * T10 settings card: a global custom system-prompt addendum + the user's
 * memory entries. Both are injected (global → project → thread) into the
 * leading system context on every request — see `src/lib/systemContext.ts`.
 */
export function Memory() {
  const [addendum, setAddendum] = useState("");
  const [savedAddendum, setSavedAddendum] = useState("");
  const [memories, setMemories] = useState<UserMemory[]>([]);
  const [newMemory, setNewMemory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getSetting(SYSTEM_PROMPT_ADDENDUM_KEY), listUserMemory()])
      .then(([a, m]) => {
        setAddendum(a ?? "");
        setSavedAddendum(a ?? "");
        setMemories(m);
      })
      .catch((e) => setError(errMsg(e)));
  }, []);

  async function saveAddendum() {
    setBusy(true);
    setError(null);
    try {
      await setSetting(SYSTEM_PROMPT_ADDENDUM_KEY, addendum);
      setSavedAddendum(addendum);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function addMemory() {
    const content = newMemory.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    try {
      const row = await addUserMemory(content);
      setMemories((m) => [...m, row]);
      setNewMemory("");
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveMemory(id: string, content: string) {
    setError(null);
    try {
      await updateUserMemory(id, content);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  async function removeMemory(id: string) {
    setError(null);
    try {
      await deleteUserMemory(id);
      setMemories((m) => m.filter((x) => x.id !== id));
    } catch (e) {
      setError(errMsg(e));
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>System prompt &amp; memory</CardTitle>
        <CardDescription>
          Added to the system context of every chat, ahead of any project
          instructions (precedence: global → project → thread).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="system-prompt-addendum">System-prompt addendum</Label>
          <Textarea
            id="system-prompt-addendum"
            rows={4}
            placeholder="e.g. Always respond in British English and prefer concise answers."
            value={addendum}
            disabled={busy}
            onChange={(e) => setAddendum(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => void saveAddendum()}
              disabled={busy || addendum === savedAddendum}
            >
              Save
            </Button>
            {addendum !== savedAddendum && (
              <span className="text-muted-foreground text-xs">
                Unsaved changes
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>Memory about you</Label>
            <p className="text-muted-foreground text-xs">
              Facts and preferences the assistant should remember across chats.
            </p>
          </div>

          {memories.map((m) => (
            <div key={m.id} className="flex gap-2">
              <Textarea
                rows={2}
                defaultValue={m.content}
                disabled={busy}
                onBlur={(e) => void saveMemory(m.id, e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => void removeMemory(m.id)}
                disabled={busy}
              >
                Remove
              </Button>
            </div>
          ))}

          <div className="flex gap-2">
            <Textarea
              rows={2}
              placeholder="Add a memory, e.g. I'm a TypeScript developer working on a desktop app."
              value={newMemory}
              disabled={busy}
              onChange={(e) => setNewMemory(e.target.value)}
            />
            <Button
              onClick={() => void addMemory()}
              disabled={busy || newMemory.trim().length === 0}
            >
              Add
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
