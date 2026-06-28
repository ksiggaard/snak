import { WEB_ONLY } from "@/lib/webOnly";
import { confirmDialog } from "@/store/confirm";
import { t } from "@/store/i18n";

/** Outcome of an update check, for the Settings card to give feedback on a
 *  manual ("Check for updates") run. The startup check ignores the result. */
export type UpdateOutcome =
  | { status: "unsupported" } // web-only debug harness — no Tauri runtime
  | { status: "uptodate" }
  | { status: "declined" }
  | { status: "installing" } // confirmed; app will download + relaunch
  | { status: "error"; message: string };

/**
 * Check GitHub's latest release (via tauri-plugin-updater's `latest.json`
 * endpoint) and, if a newer signed build exists, prompt to download + install +
 * relaunch. `silent` suppresses the "up to date" / error feedback (used by the
 * startup check, which shouldn't nag on every launch).
 *
 * The plugins are dynamically imported so they stay out of the main bundle and
 * never load in web-only mode.
 */
export async function checkForUpdate({
  silent,
}: {
  silent: boolean;
}): Promise<UpdateOutcome> {
  if (WEB_ONLY) return { status: "unsupported" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { status: "uptodate" };

    const ok = await confirmDialog({
      title: t("update.availableTitle"),
      description: t("update.availableBody", { version: update.version }),
      confirmText: t("update.install"),
    });
    if (!ok) return { status: "declined" };

    // ponytail: no download-progress UI — the app downloads then relaunches.
    // Add a progress toast here if the wait feels too long on slow links.
    await update.downloadAndInstall();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return { status: "installing" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!silent) return { status: "error", message };
    // Startup check: stay quiet on offline/transient errors.
    console.warn("[update] check failed:", message);
    return { status: "error", message };
  }
}
