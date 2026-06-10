import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory `settings` table backing the mocked db helpers.
const settings = new Map<string, string>();

vi.mock("@/lib/db", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  setSetting: vi.fn(async (key: string, value: string) => {
    settings.set(key, value);
  }),
}));

vi.mock("@/lib/keys", () => ({
  // The keychain read (would prompt in the real app) — backfill only.
  readApiKeyPresence: vi.fn(async () => false),
}));

vi.mock("@/lib/providers", () => ({
  KNOWN_PROVIDER_IDS: ["anthropic", "openai", "mistral", "gemini"] as const,
}));

import { PRESENCE_SYNCED_KEY, presenceKey, useKeys } from "@/store/keys";
import { readApiKeyPresence } from "@/lib/keys";

beforeEach(() => {
  settings.clear();
  useKeys.setState({ present: new Set(), loaded: false });
  vi.clearAllMocks();
});

describe("useKeys", () => {
  it("backfills presence from the keychain once on an un-synced install", async () => {
    // Two of four providers have a stored key.
    vi.mocked(readApiKeyPresence).mockImplementation(
      async (p) => p === "anthropic" || p === "openai",
    );

    await useKeys.getState().load();

    const s = useKeys.getState();
    expect(s.loaded).toBe(true);
    expect([...s.present].sort()).toEqual(["anthropic", "openai"]);
    // Read the keychain exactly once per known provider...
    expect(readApiKeyPresence).toHaveBeenCalledTimes(4);
    // ...then marked the install synced and cached each flag.
    expect(settings.get(PRESENCE_SYNCED_KEY)).toBe("1");
    expect(settings.get(presenceKey("anthropic"))).toBe("1");
    expect(settings.get(presenceKey("mistral"))).toBe("0");
  });

  it("never touches the keychain once already synced (reads the cache only)", async () => {
    settings.set(PRESENCE_SYNCED_KEY, "1");
    settings.set(presenceKey("gemini"), "1");

    await useKeys.getState().load();

    expect(readApiKeyPresence).not.toHaveBeenCalled();
    expect([...useKeys.getState().present]).toEqual(["gemini"]);
    expect(useKeys.getState().loaded).toBe(true);
  });

  it("setPresent writes the cache flag and updates state", async () => {
    settings.set(PRESENCE_SYNCED_KEY, "1");
    await useKeys.getState().load();

    await useKeys.getState().setPresent("mistral", true);
    expect(settings.get(presenceKey("mistral"))).toBe("1");
    expect(useKeys.getState().present.has("mistral")).toBe(true);

    await useKeys.getState().setPresent("mistral", false);
    expect(settings.get(presenceKey("mistral"))).toBe("0");
    expect(useKeys.getState().present.has("mistral")).toBe(false);
  });
});
