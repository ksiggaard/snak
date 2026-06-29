import { useState } from "react";
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
import { useCustomProviders } from "@/store/customProviders";
import { useKeys } from "@/store/keys";
import { deleteApiKey, setApiKey } from "@/lib/keys";
import { confirmDialog } from "@/store/confirm";
import { useT } from "@/store/i18n";
import { PROVIDER_PRESETS, presetById } from "@/lib/providerPresets";
import type { ProviderProtocol } from "@/lib/db";

/**
 * Custom providers settings: add any OpenAI-compatible endpoint (Groq,
 * OpenRouter, a local LM Studio/vLLM server, …) with an optional key. The
 * provider then appears in the model picker and streams through the shared
 * OpenAI engine (see `providers::stream` catch-all + `chatStream`). State lives
 * in `useCustomProviders` (the `settings` table); keys go to the OS keychain.
 */
export function CustomProviders() {
  const t = useT();
  const providers = useCustomProviders((s) => s.providers);
  const add = useCustomProviders((s) => s.add);
  const remove = useCustomProviders((s) => s.remove);
  const error = useCustomProviders((s) => s.error);

  const present = useKeys((s) => s.present);
  const setPresent = useKeys((s) => s.setPresent);

  // Add-form drafts.
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [protocol, setProtocol] = useState<ProviderProtocol>("openai");
  // The chosen preset's id ("" = a fully manual entry). When set it pins the
  // canonical provider id on add so keys/threads keep resolving.
  const [presetId, setPresetId] = useState("");
  const [adding, setAdding] = useState(false);

  // Per-provider key drafts (set/replace an existing provider's key).
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const canAdd = endpoint.trim().length > 0 && model.trim().length > 0;

  // Pick a preset: pre-fill the form and pin its canonical id + protocol. The
  // empty value is a fully manual entry (id derived from the label, OpenAI-
  // compatible by default).
  function pickPreset(id: string) {
    setPresetId(id);
    const preset = presetById(id);
    if (preset) {
      setName(preset.label);
      setEndpoint(preset.baseUrl);
      setModel(preset.defaultModel);
      setProtocol(preset.protocol);
      setKey("");
    } else {
      setProtocol("openai");
    }
  }

  function resetForm() {
    setName("");
    setEndpoint("");
    setModel("");
    setKey("");
    setProtocol("openai");
    setPresetId("");
  }

  async function submitAdd() {
    if (!canAdd) return;
    setAdding(true);
    try {
      const created = await add({
        id: presetId || undefined,
        label: name.trim(),
        protocol,
        baseUrl: endpoint.trim(),
        defaultModel: model.trim(),
      });
      // Store the key (optional) against the freshly-created provider id and
      // cache its presence so the "stored" indicator reflects it immediately.
      const k = key.trim();
      if (created && k) {
        await setApiKey(created.id, k);
        await setPresent(created.id, true);
      }
      resetForm();
    } finally {
      setAdding(false);
    }
  }

  async function saveKey(id: string) {
    const k = (keyDrafts[id] ?? "").trim();
    if (!k) return;
    setBusyKey(id);
    try {
      await setApiKey(id, k);
      setKeyDrafts((d) => ({ ...d, [id]: "" }));
      await setPresent(id, true);
    } finally {
      setBusyKey(null);
    }
  }

  async function onRemove(id: string) {
    const ok = await confirmDialog({
      title: t("customProviders.removeConfirm"),
      destructive: true,
      confirmText: t("common.remove"),
    });
    if (!ok) return;
    await remove(id);
    // Best-effort: drop the stored key + its cached presence (no-op if none).
    try {
      await deleteApiKey(id);
      await setPresent(id, false);
    } catch {
      // nothing to delete — ignore
    }
  }

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      <CardHeader>
        <CardTitle>{t("customProviders.title")}</CardTitle>
        <CardDescription>{t("customProviders.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Existing providers */}
        {providers.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("customProviders.none")}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {providers.map((p) => {
              const saved = present.has(p.id);
              const draft = keyDrafts[p.id] ?? "";
              const isBusy = busyKey === p.id;
              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-1.5 border-b pb-4 last:border-b-0 last:pb-0"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.label}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onRemove(p.id)}
                    >
                      {t("common.remove")}
                    </Button>
                  </div>
                  <span className="text-muted-foreground text-xs break-all">
                    {p.baseUrl}
                  </span>
                  <div className="mt-1 flex gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={
                        saved
                          ? t("apiKeys.storedPlaceholder")
                          : t("customProviders.keyLabel")
                      }
                      value={draft}
                      disabled={isBusy}
                      onChange={(e) =>
                        setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveKey(p.id);
                      }}
                    />
                    <Button
                      onClick={() => void saveKey(p.id)}
                      disabled={isBusy || draft.trim().length === 0}
                    >
                      {saved ? t("common.update") : t("common.save")}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add form */}
        <div className="flex flex-col gap-3 border-t pt-5">
          {/* Preset picker — pre-fills the form for a well-known provider. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-preset">{t("customProviders.presetLabel")}</Label>
            <select
              id="cp-preset"
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={presetId}
              onChange={(e) => pickPreset(e.target.value)}
            >
              <option value="">{t("customProviders.presetCustom")}</option>
              {PROVIDER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-name">{t("customProviders.nameLabel")}</Label>
            <Input
              id="cp-name"
              placeholder={t("customProviders.namePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-endpoint">
              {t("customProviders.endpointLabel")}
            </Label>
            <Input
              id="cp-endpoint"
              placeholder={t("customProviders.endpointPlaceholder")}
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
            />
            <span className="text-muted-foreground text-xs">
              {t("customProviders.endpointHelp")}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-protocol">
              {t("customProviders.protocolLabel")}
            </Label>
            <select
              id="cp-protocol"
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as ProviderProtocol)}
            >
              <option value="openai">
                {t("customProviders.protocolOpenai")}
              </option>
              <option value="anthropic">
                {t("customProviders.protocolAnthropic")}
              </option>
              <option value="gemini">
                {t("customProviders.protocolGemini")}
              </option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-model">{t("customProviders.modelLabel")}</Label>
            <Input
              id="cp-model"
              placeholder={t("customProviders.modelPlaceholder")}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cp-key">{t("customProviders.keyLabel")}</Label>
            <Input
              id="cp-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </div>
          <Button
            className="self-start"
            onClick={() => void submitAdd()}
            disabled={!canAdd || adding}
          >
            {t("customProviders.add")}
          </Button>
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
