import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useT } from "@/store/i18n";
import { useProviders } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";
import { ModelChooser } from "@/components/chat/ModelChooser";

/**
 * Default-model settings: the provider+model new chats (and the quick-input
 * overlay) start from. Picks from the configured model list (Settings →
 * Models). Key-agnostic — you may set a default before adding the key — so it
 * lists all configured models for enabled providers.
 */
export function DefaultModel() {
  const t = useT();
  const provider = useThreads((s) => s.defaultProvider);
  const model = useThreads((s) => s.defaultModel);
  const setDefaultModel = useThreads((s) => s.setDefaultModel);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  // All enabled providers count as selectable here (not filtered by API key).
  const allEnabled = new Set(providers.map((p) => p.id));
  const options = buildModelOptions(providers, allEnabled, models, {
    provider,
    model,
  });

  return (
    <Card className="w-full max-w-lg xl:max-w-2xl overflow-visible">
      <CardHeader>
        <CardTitle>{t("defaultModel.title")}</CardTitle>
        <CardDescription>{t("defaultModel.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("defaultModel.none")}
          </p>
        ) : (
          <ModelChooser
            provider={provider}
            model={model}
            onSelect={(p, m) => void setDefaultModel(p, m)}
            keyed={allEnabled}
            align="start"
          />
        )}
      </CardContent>
    </Card>
  );
}
