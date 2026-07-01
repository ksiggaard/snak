# Threads & shared state

> Part of snak's architecture guide. Core & layer boundary: [`AGENTS.md`](../../AGENTS.md).

- App state lives in a **Zustand store**, `src/store/threads.ts` (`useThreads`) — the orchestration moved here out of `ChatView`. It owns `threads`, `currentThreadId` (null = unsaved draft), `messages`, the draft provider/model, and `busy`/`error`, plus actions `init`, `selectThread`, `startNewChat`, `setProviderModel`, `send`, `rename`, `remove`.
- **Lazy thread creation:** "New chat" sets `currentThreadId = null`; the row is created in the DB on the first `send` (titled from the first message via `deriveTitle`). Empty drafts never hit the DB.
- **Last-active thread** is persisted in the `settings` table (`last_thread_id`) and restored by `init()` (called once from `App`'s mount effect).
- Sidebar `src/components/sidebar/ThreadList.tsx`: new-chat, select, double-click-to-rename, delete (confirm). `ModelPicker` sets provider+model for the current thread (persisted via `setThreadProviderModel`) or the draft.
- Components select store slices individually (`useThreads((s) => s.x)`) to limit re-renders. Sync-local-state-to-store is done with the render-time adjustment pattern (see `ModelPicker`), not `useEffect` — the `react-hooks/set-state-in-effect` rule forbids the effect form.
