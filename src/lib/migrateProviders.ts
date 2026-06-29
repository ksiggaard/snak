// One-time migration for the built-in → custom-provider switch.
//
// The app no longer ships cloud providers (OpenAI, Anthropic, Mistral, Gemini);
// users add them from presets. To keep existing setups working, on first launch
// after the upgrade we recreate a custom provider for each formerly-built-in
// cloud provider the user actually configured — detected by a key being stored
// for it — reusing the canonical id so the existing keychain key and prior
// threads keep resolving with no re-entry. Guarded by a settings flag so the
// keychain is read at most once.

import {
  getSetting,
  setSetting,
  getCustomProviders,
  setCustomProviders,
  type CustomProvider,
} from "@/lib/db";
import { readApiKeyPresence } from "@/lib/keys";
import { MIGRATABLE_BUILTIN_IDS, presetById } from "@/lib/providerPresets";

/** settings flag marking the one-time built-in→custom-provider migration done. */
export const PROVIDERS_MIGRATED_KEY = "providers_migrated_v2";

/**
 * Run the migration if it hasn't run yet. Returns the ids that were recreated as
 * custom providers (so the caller can refresh the key-presence cache for them).
 * Idempotent: a no-op once the flag is set, and it never overwrites a provider
 * the user already has under the same id.
 */
export async function migrateBuiltinProviders(): Promise<string[]> {
  if ((await getSetting(PROVIDERS_MIGRATED_KEY)) === "1") return [];

  const existing = await getCustomProviders();
  const have = new Set(existing.map((p) => p.id));
  const added: CustomProvider[] = [];

  for (const id of MIGRATABLE_BUILTIN_IDS) {
    if (have.has(id)) continue;
    const preset = presetById(id);
    if (!preset) continue;
    // Only migrate providers the user actually configured (key in the keychain).
    // This is the single keychain read for these ids — guarded by the flag so it
    // never prompts again on later launches. A missing entry returns false
    // without an OS prompt, so fresh installs migrate nothing and pay nothing.
    const keyed = await readApiKeyPresence(id).catch(() => false);
    if (!keyed) continue;
    added.push({
      id: preset.id,
      label: preset.label,
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      defaultModel: preset.defaultModel,
    });
  }

  if (added.length) await setCustomProviders([...existing, ...added]);
  await setSetting(PROVIDERS_MIGRATED_KEY, "1");
  return added.map((p) => p.id);
}
