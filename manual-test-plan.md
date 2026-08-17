<!-- SUMMARY -->
# Manual Test: Theming for the Settings Page — Light **and** Dark (Executive Summary)

> [!NOTE]
> **Executive Summary**: Rewritten from your answers in the previewer. This is no longer a "dark mode" plan - it is a **two-theme token migration**: light and dark both come from one token set, and a brand-new user follows their **system preference** rather than a hard-coded default.

## What changed from round 1

| Round 1 (rejected) | Round 2 (this plan) |
|---|---|
| Dark mode bolted on, light left hard-coded | **Full token pass** - light and dark share one source of truth |
| Light was the implicit default | **Follow system preference** on first load, explicit choice wins after |
| 4 milestones, dark only | 5 milestones, both themes + contrast QA |

## Execution Milestones

- [ ] 1. Audit and extract every hard-coded color into `tokens.css` (light set first)
- [ ] 2. Add the dark token set against the same variable names
- [ ] 3. Resolution order: stored choice → `prefers-color-scheme` → light fallback
- [ ] 4. Theme toggle in the settings header (Light / Dark / System)
- [ ] 5. Contrast QA on both themes across the 6 highest-traffic screens

> [!IMPORTANT]
> You skipped the "what bothers you about light mode today" question, so milestone 5 uses a generic WCAG AA contrast sweep. Tell me a specific screen and I'll target it.
<!-- /SUMMARY -->

<!-- FULL -->
# Manual Test: Theming for the Settings Page — Light and Dark (Full Specification)

## 1. Decisions Locked In (answered in the previewer)

| Decision | Answer | Consequence |
|---|---|---|
| Default theme | Follow system preference | No hard-coded default; `prefers-color-scheme` drives first paint |
| Light mode scope | Full token pass | Light colors get refactored into the same tokens as dark |
| Light-mode pain points | *(skipped)* | Generic WCAG AA sweep instead of targeted fixes |

## 2. Implementation Breakdown

1. **`src/styles/tokens.css`** `[NEW]` - `:root` holds the **light** token set (`--bg`, `--fg`, `--muted`, `--accent`, `--border`); `[data-theme="dark"]` overrides the same names. No component may reference a raw hex after this step.
2. **`src/lib/theme.ts`** `[NEW]` - `resolveTheme()` = `localStorage.theme` → `matchMedia('(prefers-color-scheme: dark)')` → `'light'`. Exposes `setTheme('light'|'dark'|'system')` and subscribes to system changes while in `system` mode.
3. **`index.html`** `[MODIFY]` - blocking inline snippet applies `data-theme` before first paint to avoid a flash.
4. **`src/components/ThemeToggle.tsx`** `[NEW]` - three-state control: Light / Dark / **System** (default).
5. **`src/pages/Settings.tsx`** `[MODIFY]` - mount the toggle, delete inline color literals.

## 3. File Changes Breakdown

| File | Action | Description |
|---|---|---|
| `src/styles/tokens.css` | `[NEW]` | Single token set, light + dark |
| `src/lib/theme.ts` | `[NEW]` | Resolution order + live system listener |
| `index.html` | `[MODIFY]` | Pre-paint theme application |
| `src/components/ThemeToggle.tsx` | `[NEW]` | Light / Dark / System control |
| `src/pages/Settings.tsx` | `[MODIFY]` | Mount toggle, drop color literals |

## 4. Verification

- Unit: stored choice beats system preference; `system` mode reacts to OS changes live.
- Visual: no hard-coded hex left outside `tokens.css` (lint rule / grep gate).
- Contrast: WCAG AA sweep on both themes across the 6 highest-traffic screens.

> [!WARNING]
> Throwaway plan used only to exercise Plan Previewer's agent-question flow. Do not execute it.
<!-- /FULL -->
