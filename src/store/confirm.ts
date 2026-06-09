import { create } from "zustand";

// In-app confirmation dialog. The webview's native `window.confirm()` is a
// no-op in Tauri (it returns falsy without showing anything), so every
// confirm-gated action — delete chat/project, remove MCP server, uninstall
// plugin — silently did nothing. This replaces it with a real modal: callers
// `await confirmDialog(...)` and get a boolean once the user chooses.

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Confirm button label (default "Confirm"). */
  confirmText?: string;
  /** Cancel button label (default "Cancel"). */
  cancelText?: string;
  /** Style the confirm button as destructive (default false). */
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolve: ((ok: boolean) => void) | null;
  /** Open the dialog; resolves true (confirmed) or false (cancelled). */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Answer the open dialog (wired to the dialog's buttons / Esc). */
  respond: (ok: boolean) => void;
}

export const useConfirm = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolve: null,

  confirm: (options) =>
    new Promise<boolean>((resolve) => {
      // If a prior dialog was somehow still pending, cancel it first.
      get().resolve?.(false);
      set({ open: true, options, resolve });
    }),

  respond: (ok) => {
    get().resolve?.(ok);
    set({ open: false, options: null, resolve: null });
  },
}));

/** Imperative helper: `if (await confirmDialog({ title: "Delete?" })) …`. */
export const confirmDialog = (options: ConfirmOptions): Promise<boolean> =>
  useConfirm.getState().confirm(options);
