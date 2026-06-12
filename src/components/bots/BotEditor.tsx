import { useEffect, useRef, useState } from "react";
import { ClipboardPaste, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BotAvatar } from "@/components/bots/BotAvatar";
import { ModelChooser } from "@/components/chat/ModelChooser";
import { useBots } from "@/store/bots";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";
import { prepareImage } from "@/lib/image";
import {
  addBotMemory,
  deleteBotMemory,
  listBotMemory,
  updateBotMemory,
} from "@/lib/db";
import type { Bot, BotMemory } from "@/types/db";

/** Avatar images are downscaled to a small square-ish thumbnail — far below
 *  the vision-input size used for chat images. */
const AVATAR_MAX_DIM = 256;

/** The shared bot edit form (T38): name, personality, avatar, default model,
 *  and per-bot memory. Used by the main-pane BotView and the settings card.
 *  Field drafts follow ProjectView's render-time sync pattern (no
 *  setState-in-effect); memory is component-local via the lib/db helpers,
 *  mirroring the global Memory card. */
export function BotEditor({ bot }: { bot: Bot }) {
  const t = useT();
  const rename = useBots((s) => s.rename);
  const setInstructions = useBots((s) => s.setInstructions);
  const setAvatar = useBots((s) => s.setAvatar);
  const setDefaultModel = useBots((s) => s.setDefaultModel);

  const appProvider = useThreads((s) => s.defaultProvider);
  const appModel = useThreads((s) => s.defaultModel);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarError, setAvatarError] = useState<"invalid" | "paste" | null>(
    null,
  );
  const [newMemory, setNewMemory] = useState("");
  const [memories, setMemories] = useState<BotMemory[]>([]);

  // Local drafts so typing doesn't write to the DB on each keystroke; re-synced
  // at render when the edited bot changes (render-time sync pattern, not an
  // effect — matches ProjectView/ModelPicker).
  const [nameDraft, setNameDraft] = useState(bot.name);
  const [instrDraft, setInstrDraft] = useState(bot.instructions);
  const [syncedId, setSyncedId] = useState(bot.id);
  if (bot.id !== syncedId) {
    setSyncedId(bot.id);
    setNameDraft(bot.name);
    setInstrDraft(bot.instructions);
    setAvatarError(null);
    setNewMemory("");
    setMemories([]);
  }

  // Memory loads async per bot (async setState in an effect is fine — only the
  // sync form is banned).
  useEffect(() => {
    let cancelled = false;
    void listBotMemory(bot.id).then((rows) => {
      if (!cancelled) setMemories(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [bot.id]);

  async function applyAvatar(image: Blob) {
    setAvatarError(null);
    try {
      const img = await prepareImage(image, AVATAR_MAX_DIM);
      await setAvatar(bot.id, img.mediaType, img.base64);
    } catch {
      setAvatarError("invalid");
    }
  }

  async function onPickAvatar(list: FileList | null) {
    const file = list?.[0];
    if (file) await applyAvatar(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** "Paste" button: read an image off the async clipboard API. WebKitGTK
   *  support varies — any failure (no API, no permission, no image) lands on
   *  the same gentle error; Ctrl+V over the editor (onPaste below) is the
   *  always-working path. */
  async function pasteAvatar() {
    setAvatarError(null);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((x) => x.startsWith("image/"));
        if (type) {
          await applyAvatar(await item.getType(type));
          return;
        }
      }
      setAvatarError("paste");
    } catch {
      setAvatarError("paste");
    }
  }

  async function addMemory() {
    const content = newMemory.trim();
    if (!content) return;
    const row = await addBotMemory(bot.id, content);
    setMemories((m) => [...m, row]);
    setNewMemory("");
  }

  async function removeMemory(id: string) {
    await deleteBotMemory(id);
    setMemories((m) => m.filter((x) => x.id !== id));
  }

  // The bot's default provider+model are set together or both null (DB helper
  // invariant); unset means new chats fall back to the app default.
  const hasCustomDefault =
    bot.default_provider !== null && bot.default_model !== null;
  const chooserProvider = hasCustomDefault
    ? bot.default_provider!
    : appProvider;
  const chooserModel = hasCustomDefault ? bot.default_model! : appModel;
  // Key-agnostic like the Default Model card: list all enabled providers.
  const allEnabled = new Set(providers.map((p) => p.id));
  const options = buildModelOptions(providers, allEnabled, models, {
    provider: chooserProvider,
    model: chooserModel,
  });

  return (
    <div
      className="flex flex-col gap-5"
      onPaste={(e) => {
        // A pasted *image* anywhere in the editor becomes the avatar (mirrors
        // the Composer's pasted-files flow). Text pastes carry no files and
        // pass through to the focused field untouched.
        const image = Array.from(e.clipboardData.files).find((f) =>
          f.type.startsWith("image/"),
        );
        if (image) {
          e.preventDefault();
          void applyAvatar(image);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`bot-name-${bot.id}`}>{t("bots.name")}</Label>
        <Input
          id={`bot-name-${bot.id}`}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => {
            if (nameDraft.trim() && nameDraft !== bot.name)
              void rename(bot.id, nameDraft);
          }}
          className="max-w-md"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("bots.avatar")}</Label>
        <div className="flex items-center gap-3">
          <BotAvatar bot={bot} className="size-16 text-2xl" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-4" />
            {t("bots.uploadAvatar")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            title={t("bots.pasteAvatarHint")}
            onClick={() => void pasteAvatar()}
          >
            <ClipboardPaste className="size-4" />
            {t("bots.pasteAvatar")}
          </Button>
          {bot.avatar_data !== null && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setAvatar(bot.id, null, null)}
            >
              {t("bots.removeAvatar")}
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void onPickAvatar(e.target.files)}
          />
        </div>
        {avatarError !== null && (
          <p className="text-destructive text-sm">
            {t(
              avatarError === "paste"
                ? "bots.avatarPasteError"
                : "bots.avatarError",
            )}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`bot-instructions-${bot.id}`}>
          {t("bots.instructions")}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t("bots.instructionsHint")}
        </p>
        <Textarea
          id={`bot-instructions-${bot.id}`}
          value={instrDraft}
          onChange={(e) => setInstrDraft(e.target.value)}
          onBlur={() => {
            if (instrDraft !== bot.instructions)
              void setInstructions(bot.id, instrDraft);
          }}
          rows={6}
          placeholder={t("bots.instructionsPlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t("bots.defaultModel")}</Label>
        <p className="text-muted-foreground text-xs">
          {t("bots.defaultModelHint")}
        </p>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("defaultModel.none")}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <ModelChooser
              provider={chooserProvider}
              model={chooserModel}
              onSelect={(p, m) => void setDefaultModel(bot.id, p, m)}
              keyed={allEnabled}
              align="start"
            />
            {hasCustomDefault ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void setDefaultModel(bot.id, null, null)}
              >
                {t("bots.useAppDefault")}
              </Button>
            ) : (
              <span className="text-muted-foreground text-xs">
                {t("bots.appDefault")}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label>{t("bots.memory")}</Label>
          <p className="text-muted-foreground text-xs">
            {t("bots.memoryHint")}
          </p>
        </div>

        {memories.map((m) => (
          <div key={m.id} className="flex gap-2">
            <Textarea
              rows={2}
              defaultValue={m.content}
              onBlur={(e) => void updateBotMemory(m.id, e.target.value)}
            />
            <Button variant="outline" onClick={() => void removeMemory(m.id)}>
              {t("bots.memoryRemove")}
            </Button>
          </div>
        ))}

        <div className="flex gap-2">
          <Textarea
            rows={2}
            placeholder={t("bots.memoryPlaceholder")}
            value={newMemory}
            onChange={(e) => setNewMemory(e.target.value)}
          />
          <Button
            onClick={() => void addMemory()}
            disabled={newMemory.trim().length === 0}
          >
            {t("bots.memoryAdd")}
          </Button>
        </div>
      </div>
    </div>
  );
}
