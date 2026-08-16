# Agent Skill Guide for Plan Previewer

This document provides instructions for AI agents such as Claude Code, Antigravity, Pi CLI, and Gemini.

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

Plan Previewer has two distinct triggers - know which one applies before you launch it:

- **Phase A - Before execution (mandatory).** Any time you write or revise a markdown plan file like `plan.md` or `PLAN.md` for approval - the first draft and every `changes_requested`/`questions_asked` revision round - you must run the protocol below.
- **Phase B - After approval (execution phase).** Once `status` is `"approved"` and you've started executing, do NOT re-launch Plan Previewer just because the plan file changed again (checking off `- [x]` tasks, appending progress notes, etc). Only launch it again if you deliberately want to show the user something or ask them a question mid-execution - treat that as a fresh Phase A round, run the same protocol, don't just send a plain chat message instead.

### Protocol (both phases)

1. Run:
   ```bash
   npx plan-previewer ./plan.md --context="Brief task summary"
   ```
2. The previewer launches an interactive web UI for the user to review, edit, and annotate your plan.
3. **CRITICAL: STOP AND WAIT FOR FEEDBACK.**
   - On **Claude Code** and **Pi CLI**: The command blocks synchronously until user submits feedback. No hook is involved - just let the command finish.
   - On **Antigravity AGY**: If `run_command` sends the process to a background task, simply stop calling tools to end your turn. The installed `Stop` hook (`agy-stop-hook.js`, registered via `hooks.json`) intercepts the execution loop's termination and automatically resumes your session with the result the moment feedback is submitted in the browser - no extra tool call is needed.
4. Read `.plan-feedback.json` (or `.plan-feedback.md`) to inspect user comments, questions, and approval status before proceeding. Once `status` is `"approved"`, move into Phase B and stop re-launching Plan Previewer for routine plan-file edits.

