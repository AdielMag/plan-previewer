# Plan Previewer

An interactive visual markdown plan previewer and feedback system built for AI coding agents such as Claude Code and Antigravity.
It provides an automated web interface for previewing rendered markdown plans, live editing plan tasks, making text-selection annotations, appending feedback, and transmitting user approval back to your active agent session.

![Plan Previewer Demo](docs/plan_previewer_demo_v3.gif)

## Key Features

- **Dual Agent Auto-Detection**: Automatically detects whether the session was opened by Claude Code or Antigravity by inspecting parent process trees (`process.ppid`) without needing manual selection.
- **Claude Design Handoff Aesthetic**: Built using the dark canvas aesthetic with IBM Plex typography, OKLCH teal accents, and inline highlight badges.
- **Text Selection Annotations**: Highlight text anywhere in the plan preview to open a floating question popover (`"Quote snippet..."`, input box, `Cancel`, and `Ask →`).
- **Realtime Live File Sync**: Uses `fs.watch` and lightweight version polling to update the document, task progress metrics, and rendered markdown live whenever the plan file changes on disk via CLI.
- **Auto Tab Shutdown**: Automatically closes the browser tab and terminates the server process upon clicking **Approve plan**, **Request changes**, or exiting the viewer.
- **Ultra Token-Lean Footprint**: Output feedback and agent skill files are optimized (~30 words) to minimize LLM context window consumption.
- **Enforced, Not Just Documented (Claude Code)**: Installs a `PreToolUse` hook on `ExitPlanMode` that blocks the agent from exiting plan mode unless a fresh, `"approved"` `.plan-feedback.json` exists next to the plan file. This removes the ability for an agent to skip the previewer by reasoning that a particular task "doesn't need it."

## Installation & Setup

Install globally via npm:

```bash
npm install -g plan-previewer
```

Register skills and mandatory agent rules across Claude Code and Antigravity:

```bash
plan-previewer install --auto
```

Or re-run skill setup anytime:

```bash
npx plan-previewer install
```

### Enforcement Hook (Claude Code)

`plan-previewer install` also copies `hooks/require-plan-previewer.mjs` to `~/.claude/hooks/` and registers it as a `PreToolUse` hook on `ExitPlanMode` in `~/.claude/settings.json` (merged in, existing settings are preserved). Before Claude Code is allowed to leave plan mode, the hook checks the most recently written plan file under `~/.claude/plans/` and denies the call unless `.plan-feedback.json` next to it is newer than the plan and has `status: "approved"`. Re-running `plan-previewer install` is idempotent; it will not duplicate the hook entry.

## How It Works

```
┌────────────────────────┐      ┌─────────────────────────┐      ┌────────────────────────┐
│  AI Agent              │ ---> │ CLI Binary              │ ---> │ Local Web Server       │
│  (Claude / Antigravity)│      │ plan-previewer ./plan.md│      │ (Auto-detects Agent)   │
└────────────────────────┘      └─────────────────────────┘      └────────────────────────┘
                                                                             │
                                                                             ▼
┌────────────────────────┐      ┌─────────────────────────┐      ┌────────────────────────┐
│ Agent Continues Task   │ <--- │ .plan-feedback.json     │ <--- │ Browser Web Viewer     │
│ (Reads User Feedback)  │      │ (Written on Submit)     │      │ (Auto-closes on Done)  │
└────────────────────────┘      └─────────────────────────┘      └────────────────────────┘
```

## Usage

Preview any markdown plan file:

```bash
plan-previewer ./plan.md
```

Specify session context or custom port:

```bash
plan-previewer ./plan.md --context="Building Realtime Notification System" --port=3456
```

Explicitly override caller agent detection:

```bash
plan-previewer ./plan.md --agent=claude
```

## CLI Options

| Flag | Description | Default |
|---|---|---|
| `[path]` | Path to target markdown plan file | `./plan.md` |
| `--context=<string>`, `-c` | Task goal or session context summary | First `# Heading` |
| `--agent=<claude\|antigravity>` | Explicitly set calling agent | Auto-detected |
| `--port=<number>`, `-p` | Local HTTP server port | `3456` |
| `--no-open` | Do not automatically launch browser tab | `false` |
| `install` | Install agent skills into Claude and Antigravity | N/A |

## License

MIT License. Created for agentic software workflows.
