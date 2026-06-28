/**
 * Validate a Tauri global-shortcut accelerator before we (re)register it.
 *
 * Returns an error message to show the user, or null when valid. We validate
 * client-side so an invalid string never reaches Rust: `set_global_shortcut`
 * unregisters the working shortcut *before* registering the new one, so a bad
 * accelerator there would leave the user with no shortcut at all.
 *
 * ponytail: covers modifiers + single letters/digits, F1–F24, and the common
 * named keys, and intentionally requires a modifier (so a bare key isn't bound
 * globally). It's stricter than Tauri's full grammar — widen NAMED_KEYS if a
 * key Tauri accepts gets rejected here.
 */
const MODIFIERS = new Set([
  "ctrl",
  "control",
  "cmd",
  "command",
  "commandorcontrol",
  "cmdorctrl",
  "alt",
  "option",
  "altgr",
  "shift",
  "super",
  "meta",
]);

const NAMED_KEYS = new Set([
  "space",
  "enter",
  "return",
  "tab",
  "backspace",
  "delete",
  "esc",
  "escape",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "insert",
  "plus",
  "minus",
]);

export function validateAccelerator(accel: string): string | null {
  const parts = accel
    .trim()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return "Use at least one modifier plus a key, e.g. Alt+Space.";
  }
  const last = parts[parts.length - 1];
  for (const mod of parts.slice(0, -1)) {
    if (!MODIFIERS.has(mod.toLowerCase())) {
      return `"${mod}" is not a valid modifier.`;
    }
  }
  const key = last.toLowerCase();
  if (MODIFIERS.has(key)) {
    return "End with a non-modifier key, e.g. Alt+Space.";
  }
  const valid =
    /^[a-z0-9]$/.test(key) ||
    /^f([1-9]|1[0-9]|2[0-4])$/.test(key) ||
    NAMED_KEYS.has(key);
  return valid ? null : `"${last}" isn't a recognized key.`;
}
