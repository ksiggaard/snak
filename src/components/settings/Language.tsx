import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { languagesDirectory } from "@/lib/languages";
import { useI18n, useT } from "@/store/i18n";

/**
 * Language settings card (T32). Lists the bundled language packs plus any user
 * packs discovered in the app-data languages folder (Rust `list_languages`),
 * and lets the user pick one. Switching applies live (every component
 * subscribed via `useT` re-renders); the choice persists in localStorage so
 * startup is synchronous with no flash, mirroring the theme preference.
 */
export function Language() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const packs = useI18n((s) => s.packs);
  const error = useI18n((s) => s.error);
  const setLocale = useI18n((s) => s.setLocale);
  const loadUserPacks = useI18n((s) => s.loadUserPacks);

  const [dir, setDir] = useState<string | null>(null);

  // Refresh user packs when the card opens (cheap; tolerates a missing dir).
  useEffect(() => {
    void loadUserPacks();
  }, [loadUserPacks]);

  // Bundled codes, to badge user-installed packs.
  const bundledCodes = new Set(["en", "de", "fr", "pl", "es", "da"]);

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl">
      <CardHeader>
        <CardTitle>{t("language.title")}</CardTitle>
        <CardDescription>{t("language.description")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col">
          {packs.map((p) => (
            <div
              key={p.code}
              className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-muted-foreground font-mono text-xs">
                  {p.code}
                </span>
                {!bundledCodes.has(p.code) && (
                  <span className="text-muted-foreground rounded border px-1 text-[10px] uppercase">
                    {t("language.userBadge")}
                  </span>
                )}
              </div>
              <Button
                size="sm"
                variant={locale === p.code ? "default" : "outline"}
                onClick={() => setLocale(p.code)}
              >
                {locale === p.code ? t("common.active") : t("common.use")}
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadUserPacks()}
          >
            {t("common.refresh")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void languagesDirectory().then(setDir)}
          >
            {t("language.showFolder")}
          </Button>
        </div>
        {dir && (
          <p className="text-muted-foreground text-xs break-all">
            {t("language.directory")} <code>{dir}</code>
          </p>
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
