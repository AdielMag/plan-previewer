# Plan Previewer

An interactive visual markdown plan previewer and feedback system built for AI coding agents such as Claude Code, Antigravity, and Pi CLI.
It provides an automated web interface for previewing rendered markdown plans, selecting design choices, making inline text annotations, tracking real-time activity, reviewing agent change summaries, and transmitting user approval back to your active agent session.

![Plan Previewer Demo](docs/plan_previewer_demo_v3.gif)

## Key Features

- **Multi-Agent Auto-Detection & Branding**: Automatically detects whether the session was opened by Claude Code, Antigravity, or Pi CLI - first from agent-specific environment variables (`CLAUDE_*`, `ANTIGRAVITY_*`/`AGY_*`, `PI_*`), then by inspecting parent process trees (`process.ppid`). Displays custom avatars, π symbols, and brand gradients (purple/cyan for Pi, amber for Claude, blue/green for Antigravity).
- **Warm Editorial Theme**: A flat, sharp-cornered, shadow-free light/dark palette (warm cream light theme, warm charcoal dark theme with amber accents) tuned for long-form reading comfort, based on a dedicated design handoff.
- **Summary & Full View Modes**: Toggle between a **Summary View** (30-second scan: hides deep-dive `<details>` accordions, code blocks, and tables for an executive digest) and a **Full View** (everything expanded) directly from the header.
- **Decisions Tray**: All `[!CHOICE]` and `[!QUESTION]` blocks in a plan are automatically grouped into a single, compact **Decisions** tray with `D1`/`D2`/`Q1`-style badges, a live "X of Y resolved" counter, and collapsible rows that preview the current selection or answer when closed.
- **Interactive Choice Cards & Open Questions**: `[!CHOICE]` and `[!QUESTION]` blocks render as radio-style option rows with `[Recommended]` badge parsing, Answered/Unanswered chips, and explicit **Clear** controls.
- **In-Tab Agent Questions (`--ask`)**: When the agent needs input it never asks in the CLI/chat - it pushes questions into the already-open previewer tab (`--ask="..."`, `--ask-file=...`, or `.plan-questions.json`). They render as an *"<Agent> needs your input"* panel with radio options and free-text fields; the user answers in place and the answers return to the agent as `answers[]` in `.plan-feedback.json`. The session also stays alive after approval, so execution-phase questions reuse the same tab instead of spawning a new one.
- **Agent Change Summaries & Changelogs**: When an agent addresses requested changes, it can supply an authored explanation of what was changed via `--response="..."` or `.plan-response.md`. The web UI renders this explanation as the primary response bubble in the activity feed alongside line diff statistics (+N / −M lines).
- **Responsive Layout & Width Switcher**:
  - **Narrow (Comfortable)**: 820px centered reading column.
  - **Wide (75% / 1160px)**: Default sweet spot for plans with tables, code blocks, and diagrams.
  - **Full Width**: 100% fluid edge-to-edge layout stretching across the screen.
  - **Collapsible Sidebars**: Toggle buttons to collapse the Outline (TOC) and Activity sidebars, with scroll-spy highlighting the active section as you read.
- **Live Activity Feed with Category Colors**:
  - Real-time reactivity: selecting an option, typing an answer, or leaving a note immediately updates the "Pending this turn" panel in the Activity sidebar.
  - Distinct semantic color coding: **violet** for design choice/answer selections, **amber** for highlighted text snippet notes, **cyan** for open questions.
  - **Click-to-Scroll**: Clicking any activity item smoothly scrolls to and flashes the corresponding row or note in the document.
- **Floating Text Selection Annotations**: Highlight text anywhere in the plan preview to open an elevated popover card for leaving notes or asking questions directly on that snippet.
- **Action Button States**: The **Request changes** button stays disabled until an activity (choice selection, comment, question answer, or text note) is made, preventing accidental empty submissions.
- **Realtime Live File Sync & Fallback Parsing**: Uses file watching and polling to update the document live. Includes a built-in local markdown parser and `localStorage` caching so the plan renders reliably without external CDN dependencies.
- **Enforced, Not Just Documented**:
  - **Claude Code**: Installs a `PreToolUse` hook on `ExitPlanMode` that blocks exiting plan mode without fresh `"approved"` feedback.
  - **Pi CLI**: Installs an enhanced `plan-mode` extension that permits path-gated writes for plan artifacts (`plan.md`, `task_plan.md`, `*-plan.md`, `.plan-response.md`) while protecting source code, plus the `questionnaire` tool extension.
- **Scoped to Pre-Approval + Intentional Check-ins Only**: Plan Previewer is required before execution (drafting a plan and every revision round) and any time the agent deliberately wants to check in with the user mid-execution - it is *not* meant to relaunch automatically on every routine plan-file edit made while executing an already-approved plan (e.g. ticking off checklist items).

## Installation & Setup

Install globally via npm:

```bash
npm install -g plan-previewer
```

Register skills, extensions, and mandatory agent rules across Claude Code, Antigravity, and Pi CLI:

```bash
plan-previewer install --auto
```

Or re-run skill setup anytime:

```bash
npx plan-previewer install
```

### Agent Integrations

#### Claude Code
`plan-previewer install` registers the `PreToolUse` hook on `ExitPlanMode` in `~/.claude/settings.json` and copies `hooks/require-plan-previewer.mjs` to `~/.claude/hooks/`. Claude Code is prevented from exiting plan mode until `.plan-feedback.json` contains `status: "approved"`.

#### Antigravity (AGY CLI)
Registers the `Stop` hook in `~/.gemini/config/hooks.json` to intercept background task completion and automatically resume the agent session when feedback is submitted.

#### Pi CLI
Installs:
1. Linked skills to `~/.pi/agent/skills/` (avoiding name collisions with `~/.agents/skills/`).
2. Global mandatory rules block to `~/.pi/agent/AGENTS.md` (with automatic backup of legacy rules).
3. Enhanced `plan-mode` extension to `~/.pi/agent/extensions/plan-mode/` enabling plan artifact authoring during plan mode while strictly protecting source code.
4. `questionnaire` tool extension to `~/.pi/agent/extensions/questionnaire.ts`.

Pi CLI's bash tool executes synchronously in the foreground with a default bounded wait of **240 seconds**, after which the agent automatically re-runs the command to keep waiting.

## How It Works

```
┌────────────────────────┐      ┌─────────────────────────┐      ┌────────────────────────┐
│  AI Agent              │ ---> │ CLI Binary              │ ---> │ Local Web Server       │
│ (Claude/AGY/Pi CLI)    │      │ plan-previewer ./plan.md│      │ (Auto-detects Agent)   │
└────────────────────────┘      └─────────────────────────┘      └────────────────────────┘
                                                                             │
                                                                             ▼
┌────────────────────────┐      ┌─────────────────────────┐      ┌────────────────────────┐
│ Agent Continues Task   │ <--- │ .plan-feedback.json     │ <--- │ Browser Web Viewer     │
│ (Reads User Feedback)  │      │ (Written on Submit)     │      │ (Approved / Changes)   │
└────────────────────────┘      └─────────────────────────┘      └────────────────────────┘
```

### When Plan Previewer Should (and Shouldn't) Launch

- **Phase A - Before execution (mandatory).** Drafting a plan for the first time, and every `changes_requested`/`questions_asked` revision round, always goes through Plan Previewer.
- **Phase B - After approval (execution phase).** Once feedback status is `"approved"`, the agent executes the plan without relaunching Plan Previewer for routine plan-file edits (progress notes, checklist ticking, etc). It only comes back if the agent deliberately wants to ask the user something or show them something on purpose mid-execution - at which point it's just another Phase A round.

## Usage

Preview any markdown plan file:

```bash
plan-previewer ./plan.md
```

Pass task context summary:

```bash
plan-previewer ./plan.md --context="Building Realtime Notification System"
```

Supply change response notes when revising a plan:

```bash
plan-previewer ./plan.md --response="Added Redis caching and updated database schema per requested changes."
```

Or read response notes from a file:

```bash
plan-previewer ./plan.md --response-file="./.plan-response.md"
```

Ask the user a question **inside the open previewer tab** (never in chat):

```bash
# free-text question
plan-previewer ./plan.md --ask="Should we ship behind a feature flag?"

# multiple-choice question (inline JSON)
plan-previewer ./plan.md --ask='{"id":"cache","type":"choice","title":"Cache backend","question":"Which store?","options":[{"label":"Redis","recommended":true},{"label":"SQLite"}]}'

# batch of questions from a file (JSON, or markdown [!QUESTION]/[!CHOICE] blocks)
plan-previewer ./plan.md --ask-file=./.plan-questions.json
```

Answers come back in `.plan-feedback.json` as `status: "answered"` with an `answers[]` array, and are printed to stdout as `[PLAN-ANSWERS]`.

Explicitly override caller agent detection:

```bash
plan-previewer ./plan.md --agent=claude
plan-previewer ./plan.md --agent=pi
plan-previewer ./plan.md --agent=antigravity
```

## CLI Options

| Flag | Description | Default |
|---|---|---|
| `[path]` | Path to target markdown plan file | `./plan.md` |
| `-c`, `--context=<string>` | Task goal or session context summary | First `# Heading` |
| `-r`, `--response="<string>"` | Explanation of changes made in response to user feedback | None |
| `--response-file="<path>"` | Path to markdown file containing change response notes | Auto `.plan-response.md` |
| `--ask="<question\|json>"` | Ask the user a question inside the previewer tab (repeatable) | None |
| `--ask-file="<path>"` | Read questions from JSON or markdown blocks | Auto `.plan-questions.json` |
| `--agent=<claude\|antigravity\|pi>` | Explicitly set calling agent | Auto-detected |
| `--wait-timeout=<seconds>` | Max wait for a review decision before exiting | 240 under Pi CLI, otherwise unbounded |
| `-p`, `--port=<number>` | Local HTTP server port | `3456` |
| `--no-open` | Do not automatically launch browser tab | `false` |
| `install` | Install agent skills, rules, hooks, and extensions | N/A |

## Rich Plan Markdown Formatting

Plan Previewer parses special markdown callouts for interactive elements:

```markdown
> [!CHOICE] Database Architecture Choice
> **Question**: Which caching system should we implement for the query layer?
> - (x) **Option A**: Redis (Fast in-memory storage, supports pub/sub) [Recommended]
> - ( ) **Option B**: Memcached (Simple key-value cache)
> - ( ) **Option C**: PostgreSQL UNLOGGED table (No extra dependency)

> [!QUESTION] Data Migration Requirement
> **Question**: Do we need to run a background migration script for legacy user data?

> [!IMPORTANT]
> Key requirement: Must maintain backwards compatibility with v1 endpoints.
```

## License

MIT License. Created for agentic software workflows.
