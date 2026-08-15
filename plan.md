# Plan Previewer Tool & UI Overhaul

> [!NOTE]
> **Round 2 Updates Applied**: Addressed all 4 requested changes:
> 1. **Text Selection Comment Modal**: Floating elevated popover card positioned directly next to selected text with clean borders, inline highlight marks, and instant cancellation/submission.
> 2. **Distinct Activity Colors**: Choice selections (Violet `#8b5cf6`), Text notes/highlights (Amber `#f59e0b`), Open Question answers (Cyan `#0ea5e9`).
> 3. **Wide vs Full Distinction**: Wide is a balanced ~1160px centered column; Full stretches 100% edge-to-edge across the screen.
> 4. **Action Button States**: "Request changes" is unclickable and dimmed until you type a comment, make a choice, or leave a note.

---

## 1. Agent Response Notes on Change Requests

When the user clicks **Request Changes** with feedback, the agent can supply a summary of what changed (via `--response="..."` CLI flag or `.plan-response.md` file).

```mermaid
graph LR
    A[User requests changes + comments] --> B[Agent revises plan.md]
    B --> C[Agent re-runs with --response="..."]
    C --> D[Server captures response]
    D --> E[Web UI Activity Feed displays Authored Agent Bubble]
```

- [x] **[MODIFY] `src/server.js`**: Added `agentResponses` array to session state, accepting response string in `POST /api/notify` and exposing in `GET /api/plan`.
- [x] **[MODIFY] `bin/plan-previewer.js`**: Added `--response="<summary>"` and `--response-file="<path>"` CLI flags with auto-pickup of `.plan-response.md`.
- [x] **[MODIFY] `public/app.js`**: Display authored explanation in the agent response bubble in the activity feed, with diff statistics (+N / -M lines) as metadata.

---

## 2. Interactive Choice Selection Redesign

- [x] **[MODIFY] `public/styles.css`**: Full-width selectable card rows with custom circular radio indicators, hover lift, bold selected state with purple tint, and `[Recommended]` badge styling.
- [x] **[MODIFY] `public/app.js`**: Interactive cards with status chips ("Not answered" / "Selected") and explicit **Clear** actions.

> [!CHOICE] Choice Card Visual Style
> **Question**: Which visual style do you prefer for interactive choice cards?
> - (x) **Option A**: Modern Card Grid (Distinct cards with left accent indicators, check badges, and pill tags) [Recommended]
> - ( ) **Option B**: Compact List (Slimmer rows with radio bullets and subtle highlight)
> - ( ) **Option C**: High-Contrast Bordered (Bold solid borders with prominent badge indicators)

---

## 3. Responsive Layout & Screen Width (Narrow / Wide / Full)

- [x] **[MODIFY] `public/styles.css`**:
  - **Narrow (Comfortable)**: 820px centered reading column.
  - **Wide (75%)**: 1160px centered column.
  - **Full Width**: 100% fluid edge-to-edge layout stretching the card across the full screen.
- [x] **[MODIFY] `public/index.html` & `public/app.js`**: Header width switcher persisted to `localStorage`, plus collapsible Outline and Activity sidebar buttons.

> [!CHOICE] Default Width Setting
> **Question**: What should be the default width mode on initial launch?
> - (x) **Option A**: Wide Mode (~1160px / 75% width - ideal for tables, code, and diagrams) [Recommended]
> - ( ) **Option B**: Full Width (100% fluid - edge-to-edge space utilization)
> - ( ) **Option C**: Comfortable Mode (~820px - optimized for narrow reading)

---

## 4. Live Selection Tracking in Activity Feed & Distinct Colors

- [x] **[MODIFY] `public/app.js`**:
  - Real-time reactivity: picking an option immediately adds a badge to Draft Choices in the Activity sidebar.
  - Distinct colors: **Violet** for design choices, **Amber** for text selection notes, **Cyan** for open question answers.
  - Click any activity item to smoothly scroll and highlight that section in the plan.
  - "Request changes" button is disabled until some activity (choice selection, comment, question answer, or text note) is made.

---

## 5. Visual Polish & Universal Agent Branding

- [x] **[MODIFY] `public/app.js`**: Dynamic agent avatar rendering for Pi CLI (purple/cyan gradient, π icon), Claude, and Antigravity.
- [x] **[MODIFY] `public/styles.css`**: Floating text selection popover modal, inline mark highlight badges, toast animations, and theme contrast.

---

## 6. Verification & Test Suite

- [x] **`tests/choices.test.js`**: Unit tests for choice option parsing and recommended badge detection.
- [x] **`tests/server-response.test.js`**: Test `--response` payload handling and API endpoints.
- [x] **`tests/plan-mode-utils.test.js`**: Unit tests for Pi CLI plan mode safety.
- [x] All 32 unit tests passing.
