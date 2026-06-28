import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUserCommands } from "@/store/userCommands";
import {
  BUILTIN_COMMAND_NAMES,
  normalizeUserCommand,
  type UserSlashCommand,
} from "@/lib/slashCommands";
import { useT } from "@/store/i18n";

/**
 * Settings card for user-authored slash commands. Each command has three fields:
 * the trigger word (e.g. `/proof-read`), an input hint (documents the expected
 * argument; shown in the composer palette), and an instructions template (use
 * `{input}` to place the typed text, else it's appended). Edits a local draft
 * and persists via Save (mirrors the Quick actions card); validation on Save
 * blocks malformed words, built-in collisions, and duplicates.
 */
export function SlashCommands() {
  const t = useT();
  const commands = useUserCommands((s) => s.commands);
  const initialized = useUserCommands((s) => s.initialized);
  const init = useUserCommands((s) => s.init);
  const save = useUserCommands((s) => s.save);

  const [draft, setDraft] = useState<UserSlashCommand[]>(commands);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) void init();
  }, [initialized, init]);

  // Re-seed the draft once the store has loaded (render-time sync, not an
  // effect — matches the Quick actions card / ModelPicker).
  const [syncedInit, setSyncedInit] = useState(initialized);
  if (initialized !== syncedInit) {
    setSyncedInit(initialized);
    setDraft(commands);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(commands);

  function update(index: number, patch: Partial<UserSlashCommand>) {
    setDraft(draft.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function remove(index: number) {
    setDraft(draft.filter((_, i) => i !== index));
  }

  function add() {
    setDraft([
      ...draft,
      { id: crypto.randomUUID(), command: "", input: "", instructions: "" },
    ]);
  }

  async function onSave() {
    const seen = new Set<string>();
    const cleaned: UserSlashCommand[] = [];
    for (const c of draft) {
      // Drop fully-blank rows the user added but never filled in.
      if (!c.command.trim() && !c.input.trim() && !c.instructions.trim())
        continue;
      const norm = normalizeUserCommand(c.command);
      if (!norm) {
        setError(
          t("slashCommands.invalidError", { command: c.command || "?" }),
        );
        return;
      }
      const name = norm.slice(1);
      if (BUILTIN_COMMAND_NAMES.includes(name)) {
        setError(t("slashCommands.collisionError", { command: norm }));
        return;
      }
      if (seen.has(name)) {
        setError(t("slashCommands.duplicateError", { command: norm }));
        return;
      }
      seen.add(name);
      cleaned.push({ ...c, command: norm });
    }
    setError(null);
    setBusy(true);
    try {
      await save(cleaned);
      setDraft(cleaned);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      <CardHeader>
        <CardTitle>{t("slashCommands.title")}</CardTitle>
        <CardDescription>{t("slashCommands.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          {draft.length === 0 && (
            <p className="text-muted-foreground text-xs">
              {t("slashCommands.empty")}
            </p>
          )}

          {draft.map((c, i) => (
            <div
              key={c.id}
              className="flex flex-col gap-2 rounded-md border p-3"
            >
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`sc-command-${c.id}`}>
                      {t("slashCommands.commandLabel")}
                    </Label>
                    <Input
                      id={`sc-command-${c.id}`}
                      value={c.command}
                      disabled={busy}
                      placeholder={t("slashCommands.commandPlaceholder")}
                      onChange={(e) => update(i, { command: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`sc-input-${c.id}`}>
                      {t("slashCommands.inputLabel")}
                    </Label>
                    <Input
                      id={`sc-input-${c.id}`}
                      value={c.input}
                      disabled={busy}
                      placeholder={t("slashCommands.inputPlaceholder")}
                      onChange={(e) => update(i, { input: e.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`sc-instructions-${c.id}`}>
                      {t("slashCommands.instructionsLabel")}
                    </Label>
                    <Textarea
                      id={`sc-instructions-${c.id}`}
                      rows={3}
                      value={c.instructions}
                      disabled={busy}
                      placeholder={t("slashCommands.instructionsPlaceholder")}
                      onChange={(e) =>
                        update(i, { instructions: e.target.value })
                      }
                    />
                    <p className="text-muted-foreground text-xs">
                      {t("slashCommands.instructionsHint")}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={t("slashCommands.remove")}
                  disabled={busy}
                  onClick={() => remove(i)}
                  className="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-30"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}

          <div>
            <Button variant="outline" size="sm" onClick={add} disabled={busy}>
              {t("slashCommands.add")}
            </Button>
          </div>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={() => void onSave()} disabled={busy || !dirty}>
            {t("common.save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
