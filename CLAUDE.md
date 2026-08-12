# Plan Previewer

Plan Previewer is an interactive web viewer and skill system for AI agents like Claude Code and Antigravity.
It allows agents to open rendered markdown plans in a browser interface where users can view created timestamps, edit the plan, add inline questions, append comments, and submit feedback back to the originating agent.

## Core Capabilities

- Auto-detects whether the command was executed by Claude Code or Antigravity without requiring manual picker inputs.
- Beautifully prettifies markdown plans with task progress bars, code highlighting, and metadata badges.
- Enables live side-by-side plan editing and instant preview updates.
- Supports inline section questions and bottom comment submission directly back to the calling agent.
- Offers interactive CLI skill installation for both Claude Code and Antigravity agent environments.

## Repository Structure

- `bin/plan-previewer.js`: CLI launcher binary that starts the local web server and opens the browser.
- `src/server.js`: Express server and real-time API layer handling markdown I/O and feedback events.
- `src/detector.js`: Caller environment detection logic for Claude Code vs Antigravity.
- `public/`: Frontend static web application featuring modern markdown rendering, editor, and feedback interface.
- `skills/plan-previewer/SKILL.md`: Skill definition installed into agent directories.
- `scripts/install-skills.js`: Skill installer prompt script for agent setup.

## Development & Usage Commands

- `npm install`: Install project dependencies.
- `npm run start`: Launch the plan previewer for a target plan file.
- `npm run install-skills`: Interactively install skills into Claude Code and Antigravity skill folders.
- `npm test`: Run verification tests for environment detector and server APIs.

## Guidelines & Rules

- Always ensure one full sentence per line when writing markdown documentation files.
- Never use em dashes anywhere in code or documentation.
- Maintain dual agent support for both Claude Code and Antigravity.
