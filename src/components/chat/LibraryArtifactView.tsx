import { useLibrary } from "@/store/library";
import { useThreads } from "@/store/threads";
import { ArtifactViewer } from "@/components/chat/ArtifactViewer";

/** Thin wrapper that loads a library artifact from the store and renders the
 *  full `ArtifactViewer` in library mode. Provider/model for AI editing come
 *  from the active chat or the app default. */
export function LibraryArtifactView() {
  const { openId, setOpenId, items } = useLibrary();
  const provider = useThreads((s) => s.defaultProvider);
  const model = useThreads((s) => s.defaultModel);

  const item = items.find((i) => i.id === openId);
  if (!openId || !item) return null;

  return (
    <ArtifactViewer
      artifactId={null}
      title={item.title}
      files={item.files}
      initialTab="preview"
      onClose={() => setOpenId(null)}
      editProvider={provider}
      editModel={model}
    />
  );
}
