import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { QuickActionsEditor } from "@/components/settings/QuickActionsEditor";
import { useQuickActions } from "@/store/quickActions";
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from "@/lib/quickActions";
import { useT } from "@/store/i18n";

/**
 * Settings card for the global quick actions shown on the empty new-chat
 * screen. Edits a local draft and persists explicitly via Save (mirrors the
 * Memory card's addendum). A project can override these from its own view.
 */
export function QuickActions() {
  const t = useT();
  const actions = useQuickActions((s) => s.actions);
  const initialized = useQuickActions((s) => s.initialized);
  const init = useQuickActions((s) => s.init);
  const save = useQuickActions((s) => s.save);

  const [draft, setDraft] = useState<QuickAction[]>(actions);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!initialized) void init();
  }, [initialized, init]);

  // Re-seed the draft from the store once it has loaded (render-time sync, not
  // an effect — matches ModelPicker / ProjectView).
  const [syncedInit, setSyncedInit] = useState(initialized);
  if (initialized !== syncedInit) {
    setSyncedInit(initialized);
    setDraft(actions);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(actions);

  async function onSave() {
    setBusy(true);
    try {
      await save(draft);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      <CardHeader>
        <CardTitle>{t("quickActions.title")}</CardTitle>
        <CardDescription>{t("quickActions.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <QuickActionsEditor actions={draft} onChange={setDraft} disabled={busy} />
        <div className="flex items-center gap-2">
          <Button onClick={() => void onSave()} disabled={busy || !dirty}>
            {t("common.save")}
          </Button>
          <Button
            variant="outline"
            onClick={() => setDraft(DEFAULT_QUICK_ACTIONS)}
            disabled={busy}
          >
            {t("quickActions.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
