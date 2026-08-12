---
name: plan-previewer
description: MANDATORY. Execute whenever creating or updating plan markdown files (plan.md) to open browser viewer for user feedback.
---

# Plan Previewer

When writing or updating plan markdown files, run:
```bash
npx plan-previewer ./plan.md --context="Brief task summary"
```
Read `./.plan-feedback.json` for user edits, questions, and approval status.
