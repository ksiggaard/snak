import { invoke } from "@tauri-apps/api/core";
import type { PreparedImage } from "@/lib/image";

/** Payload sent from the quick-input overlay to the main window. */
export interface QuickPayload {
  text: string;
  images: PreparedImage[];
}

/** Forward overlay input to the main window; backend also focuses main + hides overlay. */
export const submitQuick = (payload: QuickPayload): Promise<void> =>
  invoke("submit_quick", { payload });

export const hideQuick = (): Promise<void> => invoke("hide_quick");

export const setGlobalShortcut = (accelerator: string): Promise<void> =>
  invoke("set_global_shortcut", { accelerator });

/** Interactive region screenshot → base64 PNG, or null if cancelled. */
export const takeScreenshot = (): Promise<string | null> =>
  invoke("take_screenshot");
