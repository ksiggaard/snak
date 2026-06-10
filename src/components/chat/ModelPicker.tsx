import { useThreads } from "@/store/threads";
import { ModelChooser } from "@/components/chat/ModelChooser";

/** Store-bound model picker for the chat composer: reads the current thread's
 *  (or the draft's) provider+model and persists a change via the threads store.
 *  The controlled chooser lives in `ModelChooser` (also used by the overlay). */
export function ModelPicker() {
  const currentId = useThreads((s) => s.currentThreadId);
  const threads = useThreads((s) => s.threads);
  const draftProvider = useThreads((s) => s.draftProvider);
  const draftModel = useThreads((s) => s.draftModel);
  const setProviderModel = useThreads((s) => s.setProviderModel);

  const current = threads.find((t) => t.id === currentId);
  const provider = current?.provider ?? draftProvider;
  const model = current?.model ?? draftModel;

  return (
    <ModelChooser
      provider={provider}
      model={model}
      onSelect={(p, m) => void setProviderModel(p, m)}
      align="end"
    />
  );
}
