import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { buildModelOptions } from "@/lib/modelOptions";

/**
 * Default-model settings: the provider+model new chats (and the quick-input
 * overlay) start from. Picks from the configured model list (Settings →
 * Models). Key-agnostic — you may set a default before adding the key — so it
 * lists all configured models for enabled providers.
 */
export function DefaultModel() {
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
  const selectedIndex = options.findIndex(
    (o) => o.provider === provider && o.modelId === model,
  );

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle>Default Model</CardTitle>
        <CardDescription>
          The provider and model new chats (and the quick-input overlay) start
          with. You can still change it per chat from the top bar, and manage
          the list in Settings → Models.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No models configured — add some in Settings → Models.
          </p>
        ) : (
          <select
            value={selectedIndex >= 0 ? selectedIndex : 0}
            onChange={(e) => {
              const opt = options[Number(e.target.value)];
              if (opt) void setDefaultModel(opt.provider, opt.modelId);
            }}
            className="border-input bg-background h-9 max-w-72 rounded-md border px-2 text-sm"
            aria-label="Default model"
          >
            {options.map((o, i) => (
              <option key={`${o.provider}:${o.modelId}`} value={i}>
                {o.display}
              </option>
            ))}
          </select>
        )}
      </CardContent>
    </Card>
  );
}
