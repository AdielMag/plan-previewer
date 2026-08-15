---
name: plan-previewer
description: MANDATORY. Execute whenever creating or updating plan markdown files (plan.md) to open browser viewer for user feedback.
---

# Plan Previewer Protocol

Whenever writing or updating a markdown plan file (e.g. `plan.md`, `PLAN.md`), you MUST follow this protocol:

0. **Apply the `rich-plan-formatting` skill to the plan content first.** Before launching the previewer, structure the plan with its choice/question blocks, alert callouts, and status badges - Plan Previewer renders these specially, and a plain, unformatted plan defeats the point of reviewing it in this viewer.

1. **Launch Previewer as a plain, blocking foreground command:**
   ```bash
   npx plan-previewer ./plan.md --context="Brief task summary"
   ```
   On **Claude Code** and **Pi CLI** this simply blocks in the foreground until the user submits feedback - let the tool call run to completion. Do NOT run it in the background and do NOT try to poll for its completion some other way. Waiting for a foreground command to finish is a capability every agent harness has; background-task polling is not reliably supported everywhere, and using it here is what breaks this flow.

2. **CRITICAL: STOP & WAIT FOR THE COMMAND TO EXIT**
   - Do NOT execute any subsequent steps or tool calls while it is running.
   - Do NOT edit code or run further bash commands.
   - The command exits on its own either when the user submits feedback (Request Changes or Approve) in the browser tab, **or** after a bounded wait with no decision yet — 4 minutes under Pi CLI, and on other harnesses whenever their own command timeout fires. This second case is normal, not an error or a signal to give up: it exists because a single command may not be allowed to run as long as a human takes to review a plan. Just re-run the same command.

3. **Inspect Feedback & Act**
   - Once the command exits, check `.plan-feedback.json` (or `.plan-feedback.md`) next to the plan file.
   - If it doesn't exist yet, or its `status` is the same one you already handled in a previous round (nothing new since your last check): the user simply hasn't responded yet. **Just re-run the exact same command again** and keep waiting — repeat as many times as it takes, there is no limit.
   - If `status` is `"approved"`, proceed with executing the plan.
   - If `status` is `"changes_requested"` or `"questions_asked"` **and you haven't already addressed it**, address the user's comments/questions, update the plan file, then re-run the exact same command (same plan file, default port). The already-open browser tab detects the server coming back and shows your update in place automatically — you do not need to open a new tab or tell the user to do anything.

4. **This is enforced, not optional, on Claude Code.** A `PreToolUse` hook on `ExitPlanMode`, installed alongside this skill, blocks exiting plan mode unless a fresh, `"approved"` `.plan-feedback.json` exists next to the plan file. Do not reason your way past steps 1-3.

