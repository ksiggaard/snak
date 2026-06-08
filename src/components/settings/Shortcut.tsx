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
import { getSetting, setSetting } from "@/lib/db";
import { setGlobalShortcut } from "@/lib/quick";

export const SHORTCUT_KEY = "global_shortcut";
export const DEFAULT_SHORTCUT = "Alt+Space";

export function ShortcutSetting() {
  const [value, setValue] = useState(DEFAULT_SHORTCUT);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSetting(SHORTCUT_KEY).then((v) => {
      if (v) setValue(v);
    });
  }, []);

  async function save() {
    const accelerator = value.trim();
    if (!accelerator) return;
    setError(null);
    try {
      await setGlobalShortcut(accelerator);
      await setSetting(SHORTCUT_KEY, accelerator);
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Global shortcut</CardTitle>
        <CardDescription>
          Summon the quick-input overlay from anywhere. Use modifiers like{" "}
          <code>Alt</code>, <code>CmdOrControl</code>, <code>Shift</code> joined
          with <code>+</code> (e.g. <code>Alt+Space</code>,{" "}
          <code>CmdOrControl+Shift+K</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            placeholder={DEFAULT_SHORTCUT}
            spellCheck={false}
            autoComplete="off"
          />
          <Button onClick={() => void save()}>Save</Button>
        </div>
        {status === "saved" && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">
            Shortcut registered ✓
          </p>
        )}
        {status === "error" && error && (
          <p className="text-destructive text-xs">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
