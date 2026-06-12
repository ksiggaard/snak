import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSetting, setSetting } from "@/lib/db";
import { useT } from "@/store/i18n";

export const CLOSE_TO_TRAY_KEY = "close_to_tray";

/** Push the current value into the Rust-side managed state (read by the
 * window-close handler). Persistence lives in the `settings` table. */
const syncBackend = (enabled: boolean): Promise<void> =>
  invoke("set_close_to_tray", { enabled });

export function CloseToTraySetting() {
  const t = useT();
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    getSetting(CLOSE_TO_TRAY_KEY).then((v) => {
      // Stored as "1"/"0"; absent (never toggled) defaults to ON, matching the
      // backend's default-true managed state.
      setEnabled(v === null ? true : v === "1");
    });
  }, []);

  async function toggle() {
    const next = !enabled;
    setEnabled(next);
    await syncBackend(next);
    await setSetting(CLOSE_TO_TRAY_KEY, next ? "1" : "0");
  }

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>{t("tray.title")}</CardTitle>
        <CardDescription>{t("tray.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Button
          variant={enabled ? "default" : "outline"}
          onClick={() => void toggle()}
        >
          {enabled ? t("common.on") : t("common.off")}
        </Button>
        <span className="text-muted-foreground text-sm">
          {enabled ? t("tray.hides") : t("tray.quits")}
        </span>
      </CardContent>
    </Card>
  );
}
