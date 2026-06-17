import { useWorkspaces } from "@/store/workspaces";
import { WorkspaceDashboard } from "./WorkspaceDashboard";
import { WorkspaceSettings } from "./WorkspaceSettings";

export function WorkspacePage() {
  const openWorkspaceView = useWorkspaces((s) => s.openWorkspaceView);

  if (openWorkspaceView === "settings") {
    return <WorkspaceSettings />;
  }
  return <WorkspaceDashboard />;
}
