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
   npx plan-previewer ./plan.md
   ```
2. The previewer launches an interactive web UI for the user to review, edit, and annotate your plan.
3. The command will wait for the user to click submit.
4. Read the generated `.plan-feedback.json` file or terminal stdout to receive user comments, questions, and approval status.
