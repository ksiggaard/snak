# T63 — Workspace dashboard, profile/cover images, dedicated settings page

- **Status:** done
- **Owner:** Claude (T63)
- **Priority:** P2
- **Layer:** Frontend + Rust (migration for the images) 
- **Depends on:** T58; surfaces data from T59 (URLs) and T62 (memories)

(IDEAS 3f.) Make a workspace a first-class destination. A workspace gets its own **profile
image** and **cover image**. Clicking a workspace opens a **dashboard** (rather than the
current inline detail pane), and the workspace settings move to **their own page**.

**Acceptance criteria:**
- Each workspace has a profile image and a cover image (stored alongside the workspace —
  new migration for the columns/blobs; reuse the existing image-handling seams in
  `src/lib/image.ts` / the `attachments` model where it fits).
- Clicking a workspace opens a **dashboard** view listing its **chats, files, URLs, and
  recent memories**, plus **stats** (e.g. counts / recent activity).
- The workspace settings panel (formerly the inline `ProjectView` detail pane) becomes its
  own page/route, reachable from the dashboard.
- Existing workspaces without images render with a sensible placeholder.

**Notes:**
- 2026-06-17 (Claude, T63): Migration 026 adds `profile_image TEXT` and `cover_image TEXT`
  (both nullable) to `workspaces` via two `ALTER TABLE` statements. Images are stored as
  base64 JPEG (reusing `prepareImage` from `src/lib/image.ts`) and set via the new
  `setWorkspaceImages` DB helper. Sub-view state `openWorkspaceView: "dashboard" | "settings"`
  was added to `useWorkspaces`, reset to `"dashboard"` on every `open(id)` and `close()`.
  `WorkspaceView.tsx` is left as dead code (App.tsx now uses `WorkspacePage`); the settings
  UI lives in the new `WorkspaceSettings.tsx` (copy of WorkspaceView with a back button).
  `WorkspaceDashboard.tsx` shows: cover-image banner (gradient placeholder when none),
  profile-image avatar (initials placeholder when none), stats row (chats / files / URLs /
  memories), and four sections — Chats (click opens the thread), Files, URLs, Recent
  memories (top 5 by updated_at). Decision: `WorkspaceView.tsx` kept intact as dead code;
  new components are `WorkspacePage.tsx`, `WorkspaceDashboard.tsx`, `WorkspaceSettings.tsx`.
  22 new i18n keys added to `en` catalog and all 5 locale packs (de, fr, pl, es, da).
  Gate: `npm run build` ✓ (0 type errors), `npm run lint` ✓, `npm test` ✓ (656 pass),
  `cargo build` ✓, `cargo clippy` ✓ (1 pre-existing warning), `cargo fmt --check` ✓.
