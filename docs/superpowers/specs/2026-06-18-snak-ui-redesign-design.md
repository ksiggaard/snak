> 📐 **Historical design doc.** A dated, point-in-time design record — kept for the
> rationale, not as current truth. For how the feature works today,
> [`AGENTS.md`](../../../AGENTS.md) is canonical; where this doc and the code disagree,
> the code wins.

# Snak UI Redesign

**Date:** 2026-06-18
**Status:** in-progress

## Overview

Comprehensive visual refresh: breathing room, refined palette with elevation depth, smooth animations via framer-motion, density slider. All existing appearance settings untouched. No structural DOM changes — same component tree, same layout, upgraded skin.

## 1. Spacing & Density Token System

New CSS variable `--density` drives spatial scale:
- `0` = compact (~0.75× base, roughly today's spacing)
- `1` = default (1.0×, new airy defaults)
- `2` = comfortable (~1.5×, generous)

All margin/padding/gap use `calc()` with this variable so the slider scales them.
Density stored in `localStorage`, injected via `<style id="custom-density">`.

**Default spacing changes (density=1):**

| Area | Current | New |
|------|---------|-----|
| Main content padding | `p-3` (12px) | `p-5` (20px) |
| Sidebar pane padding | `px-2 pb-2` | `px-3 pb-3` |
| Composer internal | `p-3` | `p-4` |
| Message gap (default style) | `gap-4` | `gap-5` |
| Settings card gap | `gap-4` | `gap-5` |
| Card internal padding | `p-4` | `p-5` |
| ThreadRow | `px-2 py-1.5` | `px-3 py-2` |
| TitleBar height | `h-8` (32px) | `h-9` (36px) |

## 2. Typography

- Card titles: `text-base font-semibold` (unchanged)
- Muted/secondary: slightly less contrast for clearer hierarchy
- Sidebar row titles: `text-sm` (up from mixed `text-xs`/`text-sm`)
- Chat content: fully respects existing `chatSize` setting, no default change
- UI font size default: 16px (no change from current)

## 3. Color & Elevation

**Shadow tokens** (injected CSS variables):
- `--shadow-xs`: subtle card edge (0.5px y, 1px blur)
- `--shadow-sm`: raised element (1px y, 3px blur)
- `--shadow-md`: floating element (2px y, 8px blur)
- `--shadow-lg`: modal/dialog (4px y, 16px blur)

Applied to: composer (shadow-md on focus), sidebar (shadow-sm right edge), settings cards (shadow-xs hover→shadow-sm), modals (shadow-lg).

**Dark mode:** Slightly warm dark background, sidebar distinct from main (2-3% darker), card surfaces lifted above background, accent stays magenta but softer secondary accent added, borders softened.

**Light mode:** Warmer background, refined surface colors.

All custom color overrides in appearance settings continue to work (higher specificity injection).

## 4. Animations (framer-motion)

New dependency: `framer-motion`. All gated behind: `animations` toggle (existing), `prefers-reduced-motion`, `.no-animations` class.

- **Message entrance:** `AnimatePresence` wrapper, spring slide-in (y: 8→0, opacity fade)
- **Page/view transitions:** `AnimatePresence` crossfade + subtle vertical slide in `App.tsx`
- **Sidebar items:** Staggered mount, hover scale 1.01 + brightness lift, `layoutId` on active indicator
- **Composer focus:** Border glow pulse (CSS transition)
- **Buttons:** `whileHover={{ scale: 1.02 }}`, `whileTap={{ scale: 0.98 }}`
- **Thinking indicator:** framer-motion shimmer instead of CSS dot pulse
- **Settings cards:** `whileHover={{ y: -2, boxShadow: var(--shadow-sm) }}`

## 5. Component-Level Upgrades

- **TitleBar:** Taller (32→36px), window controls refined, search gets keyboard shortcut badge
- **SidebarRail:** Hover background pills, polished active indicator
- **ThreadRow:** Smooth hover actions fade, refined active highlight, menu animation
- **Composer:** Larger padding, placeholder more prominent, attachment hover, send button glow, ModelPicker dropdown animation
- **MessageList:** Redesigned empty state (icon animation, soft gradients), smooth scroll-to-bottom button
- **ChatMessage:** Model badge refined, code block subtle border, reasoning panel accordion animation
- **Settings:** Card hover lift, slider refinement, toggle group active animation

## 6. Unchanged

- Layout structure (sidebar rail/pane, chat area, settings layout)
- All 8 chat styles and 8 chat list styles
- All existing appearance settings: theme, colors, typography, corners, animations toggle, chat width, title bar, menu bar
- `.no-animations` kill switch and `prefers-reduced-motion` support
- `tw-animate-css` utilities (coexist, framer-motion handles component animations)
- shadcn/ui components, plugin system, slash commands, quick input overlay, screenshots

## 7. Implementation Order

1. **Foundation:** framer-motion, `--density` CSS variable + injection, density store + appearance setting
2. **Spacing pass:** Update padding/gap values across all components
3. **Color palette:** Refine dark/light tokens, add shadow tokens
4. **Animation pass:** framer-motion on messages, page transitions, sidebar, buttons, composer, thinking indicator
5. **Polishing:** TitleBar, composer, thread row, code blocks, empty state, scrollbar
