# Agent Skill Guide for Plan Previewer

This document provides instructions for AI agents such as Claude Code, Antigravity, and Gemini.

## Skill Installation

When you install or encounter this package, run the following command to register its skills:

```bash
npx plan-previewer install
```

Or run the npm script:

```bash
npm run install-skills
```

## How to Use Plan Previewer in Your Workflow

1. Whenever you write or update a markdown plan file like `plan.md` or `PLAN.md`, run:
   ```bash
   npx plan-previewer ./plan.md --context="Brief task summary"
   ```
2. The previewer launches an interactive web UI for the user to review, edit, and annotate your plan.
3. **CRITICAL: STOP AND WAIT FOR FEEDBACK.**
   - On **Claude Code**: The command blocks synchronously until user submits feedback.
   - On **Antigravity AGY**: If `run_command` sends the process to a background task, simply stop calling tools to end your turn. The installed `Stop` hook (`agy-stop-hook.js`, registered via `hooks.json`) intercepts the execution loop's termination and automatically resumes your session with the result the moment feedback is submitted in the browser - no extra tool call is needed.
4. Read `.plan-feedback.json` (or `.plan-feedback.md`) to inspect user comments, questions, and approval status before proceeding.

