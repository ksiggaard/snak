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
import { getSetting, setSetting } from "@/lib/db";
import { setGlobalShortcut } from "@/lib/quick";
import { validateAccelerator } from "@/lib/shortcut";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "@/store/i18n";

export const SHORTCUT_KEY = "global_shortcut";
export const DEFAULT_SHORTCUT = "Alt+Space";
export const CLOSE_TO_TRAY_KEY = "close_to_tray";

/** Push the current value into the Rust-side managed state (read by the
 * window-close handler). Persistence lives in the `settings` table. */
const syncCloseToTrayBackend = (enabled: boolean): Promise<void> =>
  invoke("set_close_to_tray", { enabled });

export function BehaviorSettings() {
  const t = useT();
  
  // Shortcut state
  const [shortcutValue, setShortcutValue] = useState(DEFAULT_SHORTCUT);
  const [shortcutStatus, setShortcutStatus] = useState<"idle" | "saved" | "error">("idle");
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  
  // Close to tray state
  const [trayEnabled, setTrayEnabled] = useState(true);

  // Load shortcut setting
  useEffect(() => {
    getSetting(SHORTCUT_KEY).then((v) => {
      if (v) setShortcutValue(v);
    });
  }, []);

  // Load close to tray setting
  useEffect(() => {
    getSetting(CLOSE_TO_TRAY_KEY).then((v) => {
      // Stored as "1"/"0"; absent (never toggled) defaults to ON, matching the
      // backend's default-true managed state.
      setTrayEnabled(v === null ? true : v === "1");
    });
  }, []);

  async function saveShortcut() {
    const accelerator = shortcutValue.trim();
    if (!accelerator) return;
    const invalid = validateAccelerator(accelerator);
    if (invalid) {
      setShortcutStatus("error");
      setShortcutError(invalid);
      return;
    }
    setShortcutError(null);
    try {
      await setGlobalShortcut(accelerator);
      await setSetting(SHORTCUT_KEY, accelerator);
      setShortcutStatus("saved");
      setTimeout(() => setShortcutStatus("idle"), 1500);
    } catch (e) {
      setShortcutStatus("error");
      setShortcutError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleTray() {
    const next = !trayEnabled;
    setTrayEnabled(next);
    await syncCloseToTrayBackend(next);
    await setSetting(CLOSE_TO_TRAY_KEY, next ? "1" : "0");
  }

  return (
    <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2">
      {/* Global Shortcut Card */}
      <Card className="w-full max-w-lg xl:max-w-2xl">
        <CardHeader>
          <CardTitle>{t("shortcut.title")}</CardTitle>
          <CardDescription>{t("shortcut.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={shortcutValue}
              onChange={(e) => setShortcutValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveShortcut();
              }}
              placeholder={DEFAULT_SHORTCUT}
              spellCheck={false}
              autoComplete="off"
            />
            <Button onClick={() => void saveShortcut()}>
              {t("common.save")}
            </Button>
          </div>
          {shortcutStatus === "saved" && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {t("shortcut.saved")}
            </p>
          )}
          {shortcutStatus === "error" && shortcutError && (
            <p className="text-destructive text-xs">{shortcutError}</p>
          )}
        </CardContent>
      </Card>

      {/* Close to Tray Card */}
      <Card className="w-full max-w-lg xl:max-w-2xl">
        <CardHeader>
          <CardTitle>{t("tray.title")}</CardTitle>
          <CardDescription>{t("tray.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <label className="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs select-none">
            <Switch
              checked={trayEnabled}
              onCheckedChange={() => void toggleTray()}
              aria-label={trayEnabled ? t("tray.hides") : t("tray.quits")}
            />
            <span className="w-12">
              {trayEnabled ? t("common.on") : t("common.off")}
            </span>
          </label>
          <span className="text-muted-foreground text-sm">
            {trayEnabled ? t("tray.hides") : t("tray.quits")}
          </span>
        </CardContent>
      </Card>
    </div>
  );
}