---
name: plan-previewer
description: MANDATORY. Execute whenever creating or updating plan markdown files (plan.md) to open browser viewer for user feedback.
---

# Plan Previewer Protocol

Whenever writing or updating a markdown plan file (e.g. `plan.md`, `PLAN.md`), you MUST follow this protocol:

1. **Launch Previewer:**
   Run the previewer in terminal:
   ```bash
   npx plan-previewer ./plan.md --context="Brief task summary"
   ```

2. **CRITICAL: STOP & WAIT FOR USER INPUT**
   - Do NOT execute any subsequent steps or tool calls.
   - Do NOT edit code or run further bash commands.
   - You MUST wait synchronously for `npx plan-previewer` to finish executing (which occurs when the user clicks Submit in the browser UI or closes the tab).

3. **Inspect Feedback Before Proceeding**
   - Once the command exits, inspect `.plan-feedback.json` (or `.plan-feedback.md`), written next to the plan file, not necessarily your terminal's working directory.
   - If `status` is `"approved"`, proceed with executing the plan.
   - If `status` is `"changes_requested"` or `"questions_asked"`, address user comments/questions, update the plan file, re-run `npx plan-previewer`, and wait again.

4. **This is enforced, not optional, on Claude Code.** A `PreToolUse` hook on `ExitPlanMode`, installed alongside this skill, blocks exiting plan mode unless a fresh, `"approved"` `.plan-feedback.json` exists next to the plan file. Do not reason your way past steps 1-3.

