import { useThreads } from "@/store/threads";
import { useModels } from "@/store/models";
import { useProviders } from "@/lib/providers";
import { currentModelLabel } from "@/lib/modelOptions";
import { ModelChooser } from "@/components/chat/ModelChooser";

/** Store-bound model picker for the chat composer: reads the current thread's
 *  (or the draft's) provider+model and persists a change via the threads store.
 *  When planner mode is active the picker shows "Planner" and the planner model
 *  is displayed in the dropdown as a separated entry at the top. Selecting a
 *  regular model turns planner off implicitly. */
export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const draftUsePlanner = useThreads((s) => s.draftUsePlanner);
  const plannerProvider = useThreads((s) => s.plannerProvider);
  const plannerModel = useThreads((s) => s.plannerModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);
  const setUsePlanner = useThreads((s) => s.setUsePlanner);
  const models = useModels((s) => s.models);
  const providers = useProviders();

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;
  const plannerActive = currentId
    ? (current?.planner_active ?? 0) !== 0
    : draftUsePlanner;

  const { providerLabel: plannerProviderLabel, label: plannerModelLabel } =
    currentModelLabel(providers, models, plannerProvider, plannerModel);

  return (
    <ModelChooser
      provider={provider}
      model={model}
      onSelect={(p, m) => void setProviderModel(p, m)}
      align="end"
      plannerEntry={{
        active: plannerActive,
        providerLabel: plannerProviderLabel,
        modelLabel: plannerModelLabel,
        onSelect: () => void setUsePlanner(!plannerActive),
      }}
    />
  );
}
