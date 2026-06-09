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

export const CLOSE_TO_TRAY_KEY = "close_to_tray";

/** Push the current value into the Rust-side managed state (read by the
 * window-close handler). Persistence lives in the `settings` table. */
const syncBackend = (enabled: boolean): Promise<void> =>
  invoke("set_close_to_tray", { enabled });

export function CloseToTraySetting() {
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
        <CardTitle>Close to tray</CardTitle>
        <CardDescription>
          When on, closing the window hides it to the system tray and the app
          keeps running for the global shortcut. Quit from the tray menu to exit
          fully.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <Button
          variant={enabled ? "default" : "outline"}
          onClick={() => void toggle()}
        >
          {enabled ? "On" : "Off"}
        </Button>
        <span className="text-muted-foreground text-sm">
          {enabled ? "Closing hides to tray" : "Closing quits the app"}
        </span>
      </CardContent>
    </Card>
  );
}
