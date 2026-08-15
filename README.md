# Plan Previewer

An interactive visual markdown plan previewer and feedback system built for AI coding agents such as Claude Code, Antigravity, and Pi CLI.
It provides an automated web interface for previewing rendered markdown plans, selecting design choices, making inline text annotations, tracking real-time activity, reviewing agent change summaries, and transmitting user approval back to your active agent session.

![Plan Previewer Demo](docs/plan_previewer_demo_v3.gif)

## Key Features

- **Multi-Agent Auto-Detection & Branding**: Automatically detects whether the session was opened by Claude Code, Antigravity, or Pi CLI - first from agent-specific environment variables (`CLAUDE_*`, `ANTIGRAVITY_*`/`AGY_*`, `PI_*`), then by inspecting parent process trees (`process.ppid`). Displays custom avatars, π symbols, and brand gradients (purple/cyan for Pi, amber for Claude, blue/green for Antigravity).
- **Interactive Choice Cards & Open Questions**: Formats `[!CHOICE]` and `[!QUESTION]` blocks into interactive UI cards with radio options, `[Recommended]` badge parsing, Answered/Unanswered chips, and explicit **Clear** controls.
- **Agent Change Summaries & Changelogs**: When an agent addresses requested changes, it can supply an authored explanation of what was changed via `--response="..."` or `.plan-response.md`. The web UI renders this explanation as the primary response bubble in the activity feed alongside line diff statistics (+N / −M lines).
- **Responsive Layout & Width Switcher**:
  - **Narrow (Comfortable)**: 820px centered reading column.
  - **Wide (75% / 1160px)**: Default sweet spot for plans with tables, code blocks, and diagrams.
  - **Full Width**: 100% fluid edge-to-edge layout stretching across the screen.
  - **Collapsible Sidebars**: Toggle buttons to collapse the Outline (TOC) and Activity sidebars.
- **Live Activity Tracking with Category Colors**:
  - Real-time reactivity: selecting an option or typing an answer immediately updates the Activity sidebar.
  - Distinct color badges:
    - **Violet (`#8b5cf6`)**: Design choice selections.
    - **Amber (`#f59e0b`)**: Highlighted text snippet notes.
    - **Cyan (`#0ea5e9`)**: Open question answers.
  - **Click-to-Scroll**: Clicking any activity badge smoothly scrolls to and flashes the corresponding card in the document.
- **Floating Text Selection Annotations**: Highlight text anywhere in the plan preview to open an elevated popover card for leaving notes or asking questions directly on that snippet.
- **Action Button States**: The **Request changes** button stays disabled until an activity (choice selection, comment, question answer, or text note) is made, preventing accidental empty submissions.
- **Realtime Live File Sync & Fallback Parsing**: Uses file watching and polling to update the document live. Includes a built-in local markdown parser and `localStorage` caching so the plan renders reliably without external CDN dependencies.
- **Enforced, Not Just Documented**:
  - **Claude Code**: Installs a `PreToolUse` hook on `ExitPlanMode` that blocks exiting plan mode without fresh `"approved"` feedback.
  - **Pi CLI**: Installs an enhanced `plan-mode` extension that permits path-gated writes for plan artifacts (`plan.md`, `task_plan.md`, `*-plan.md`, `.plan-response.md`) while protecting source code, plus the `questionnaire` tool extension.

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
