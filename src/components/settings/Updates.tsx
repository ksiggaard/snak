import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WEB_ONLY } from "@/lib/webOnly";
import { checkForUpdate } from "@/lib/update";
import { useT } from "@/store/i18n";

export function Updates() {
  const t = useT();
  const [version, setVersion] = useState<string>(WEB_ONLY ? "dev" : "");
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<
    { kind: "ok" | "error"; text: string } | null
  >(null);

  useEffect(() => {
    if (WEB_ONLY) return;
    // Async setState (in .then) is fine; a synchronous one here is not.
    void import("@tauri-apps/api/app").then(({ getVersion }) =>
      getVersion().then(setVersion),
    );
  }, []);

  async function check() {
    setChecking(true);
    setFeedback(null);
    const outcome = await checkForUpdate({ silent: false });
    setChecking(false);
    if (outcome.status === "uptodate") {
      setFeedback({ kind: "ok", text: t("updates.uptodate") });
    } else if (outcome.status === "error") {
      setFeedback({ kind: "error", text: outcome.message });
    }
    // "installing" relaunches the app; "declined"/"unsupported" need no message.
  }

  return (
    <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2">
      <Card className="w-full max-w-lg xl:max-w-2xl">
        <CardHeader>
          <CardTitle>{t("updates.title")}</CardTitle>
          <CardDescription>{t("updates.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {version && (
            <p className="text-muted-foreground text-sm">
              {t("updates.currentVersion", { version })}
            </p>
          )}
          <div>
            <Button onClick={() => void check()} disabled={checking || WEB_ONLY}>
              {checking ? t("updates.checking") : t("updates.check")}
            </Button>
          </div>
          {feedback?.kind === "ok" && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {feedback.text}
            </p>
          )}
          {feedback?.kind === "error" && (
            <p className="text-destructive text-xs">{feedback.text}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
