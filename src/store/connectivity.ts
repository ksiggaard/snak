import { create } from "zustand";
import { getSetting, setSetting } from "@/lib/db";
import { probeConnectivity } from "@/lib/connectivity";

// Offline-mode connectivity state. Structurally mirrors `src/store/ollama.ts`:
// probe a thing, hold its status, and let the UI gate off it.
//
// "Effective offline" combines two signals (see `deriveOffline`):
//   1. auto-detection — the Rust reachability probe + the browser
//      `online`/`offline` events;
//   2. a manual "Work offline" override, persisted in the `settings` table.
//
// When effective-offline, the UI greys out cloud providers (the keyless local
// `ollama` stays available) and the chat path drops the internet-requiring MCP
// servers (`web`, `youtube`). Everything local keeps working.

/** Settings-table key for the manual "Work offline" override. */
export const FORCE_OFFLINE_KEY = "force_offline";

/** Backstop poll interval (ms) — catches captive-portal/VPN drops that don't
 *  fire a browser `online`/`offline` event. Only runs while the window is
 *  visible so we don't wake the radio in the background. */
const POLL_INTERVAL = 30_000;

type Status = "online" | "offline" | "checking";

interface ConnectivityState {
  /** Auto-detected reachability; "checking" until the first probe answers. */
  status: Status;
  /** epoch ms of the last completed probe (null until the first one lands). */
  lastChecked: number | null;
  /** A probe is in flight (dedupes concurrent refreshes). */
  probing: boolean;
  /** Manual "Work offline" override. null while the setting is still loading. */
  forceOffline: boolean | null;

  /** Load the persisted override, wire listeners + the backstop poll (once),
   *  then run the first probe. Called from App + QuickInput mount effects. */
  init: () => Promise<void>;
  /** Run the Rust probe and update status. */
  refresh: () => Promise<void>;
  /** Persist + apply the manual "Work offline" override. */
  setForceOffline: (v: boolean) => Promise<void>;
}

/**
 * Pure: effective-offline = manual override wins, else the auto status. While
 * the first probe is in flight ("checking") — and while the override setting is
 * still loading (`null`) — we treat as ONLINE, so a transient startup state
 * never wrongly blocks the first paint or the first send. Unit-tested.
 */
export function deriveOffline(
  status: Status,
  forceOffline: boolean | null,
): boolean {
  if (forceOffline === true) return true;
  return status === "offline";
}

/** Guard so HMR / a double-init (App + QuickInput in the same window context)
 *  don't stack duplicate listeners and intervals. */
let wired = false;

export const useConnectivity = create<ConnectivityState>((set, get) => ({
  status: "checking",
  lastChecked: null,
  probing: false,
  forceOffline: null,

  init: async () => {
    const forced = (await getSetting(FORCE_OFFLINE_KEY)) === "true";
    set({ forceOffline: forced });

    if (!wired) {
      wired = true;
      // `offline` is trustworthy (the interface is down) → flip immediately and
      // skip the doomed probe. `online` only means "maybe" → confirm by probing.
      window.addEventListener("offline", () => set({ status: "offline" }));
      window.addEventListener("online", () => void get().refresh());
      // Backstop poll for silent drops the events miss; visible-only.
      setInterval(() => {
        if (document.visibilityState === "visible") void get().refresh();
      }, POLL_INTERVAL);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") void get().refresh();
      });
    }

    // Seed from the cheap browser hint (avoids a flash), then confirm via probe.
    if (!navigator.onLine) set({ status: "offline" });
    await get().refresh();
  },

  refresh: async () => {
    if (get().probing) return;
    set({ probing: true });
    try {
      const { online } = await probeConnectivity();
      set({ status: online ? "online" : "offline", lastChecked: Date.now() });
    } catch {
      // The command itself shouldn't reject, but treat any failure as offline.
      set({ status: "offline", lastChecked: Date.now() });
    } finally {
      set({ probing: false });
    }
  },

  setForceOffline: async (v) => {
    await setSetting(FORCE_OFFLINE_KEY, v ? "true" : "false");
    set({ forceOffline: v });
  },
}));

/** React selector: the effective offline flag for gating. */
export function useIsOffline(): boolean {
  return useConnectivity((s) => deriveOffline(s.status, s.forceOffline));
}
