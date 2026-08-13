#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pc from 'picocolors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Adiel';
}

const home = getHomeDir();

const TARGET_ENVIRONMENTS = [
  {
    agentId: 'claude',
    name: 'Claude Code',
    path: path.join(home, '.claude', 'skills', 'plan-previewer'),
    icon: '🤖',
  },
  {
    agentId: 'antigravity',
    name: 'Antigravity (AGY CLI)',
    path: path.join(home, '.gemini', 'config', 'skills', 'plan-previewer'),
    icon: '⚡',
  },
  {
    agentId: 'auto',
    name: 'Universal Agents Registry',
    path: path.join(home, '.agents', 'skills', 'plan-previewer'),
    icon: '🧠',
  },
];

function generateSkillContent(agentId) {
  const agentFlag = agentId && agentId !== 'auto' ? ` --agent=${agentId}` : '';
  return `---
name: plan-previewer
description: MANDATORY. Execute whenever creating or updating plan markdown files to open browser viewer for user feedback.
---

# Plan Previewer Protocol

Whenever writing or updating a markdown plan file (e.g. \`plan.md\`, \`PLAN.md\`), you MUST follow this protocol:

1. **Launch Previewer:**
   Run the previewer in terminal:
   \`\`\`bash
   npx plan-previewer ./plan.md${agentFlag} --context="Brief task summary"
   \`\`\`

2. **CRITICAL: STOP & WAIT FOR USER INPUT**
   - Do NOT execute any subsequent steps or tool calls.
   - Do NOT edit code or run further bash commands.
   - You MUST wait synchronously for \`npx plan-previewer\` to finish executing (which occurs when the user clicks Submit in the browser UI or closes the tab).

3. **Inspect Feedback Before Proceeding**
   - Once the command exits, inspect \`.plan-feedback.json\` (or \`.plan-feedback.md\`), written next to the plan file, not necessarily your terminal's working directory.
   - If \`status\` is \`"approved"\`, proceed with executing the plan.
   - If \`status\` is \`"changes_requested"\` or \`"questions_asked"\`, address user comments/questions, update the plan file, re-run \`npx plan-previewer\`, and wait again.

4. **This is enforced, not optional, on Claude Code.** A \`PreToolUse\` hook on \`ExitPlanMode\`, installed alongside this skill, blocks exiting plan mode unless a fresh, \`"approved"\` \`.plan-feedback.json\` exists next to the plan file. Do not reason your way past steps 1-3.
`;
}

const MANDATORY_RULE_BLOCK = `
# Plan Previewer Required Execution

Whenever you write, update, or propose an execution plan or plan markdown file (such as \`./plan.md\`, \`PLAN.md\`, or temporary plan files), you MUST follow this protocol:

1. Run \`npx plan-previewer <path-to-plan> --context="<task summary>"\` in terminal.
2. **CRITICAL: STOP AND WAIT.** Do NOT execute plan steps, edit files, or make further tool calls until the user submits feedback in the web UI and the command finishes.
3. Read \`.plan-feedback.json\` (or \`.plan-feedback.md\`), written next to the plan file, to inspect the user's comments, questions, and approval status.
4. If \`status\` is \`'approved'\`, proceed with execution. If \`status\` is \`'changes_requested'\` or \`'questions_asked'\`, update the plan, re-run \`npx plan-previewer\`, and wait again.
5. On Claude Code, this is enforced by a \`PreToolUse\` hook on \`ExitPlanMode\` (\`~/.claude/hooks/require-plan-previewer.mjs\`). Exiting plan mode is blocked unless step 3's feedback file is fresh and \`"approved"\`. Do not attempt to bypass it; fix the underlying gap instead.
`;

async function promptUser(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function installSkillToPath(targetDir, name, agentId) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, 'SKILL.md');
    const content = generateSkillContent(agentId);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log(` ${pc.green('✔')} Installed skill to ${pc.bold(name)} -> ${pc.gray(targetFile)}`);
    return true;
  } catch (err) {
    console.error(` ${pc.red('✖')} Failed to install to ${name}: ${err.message}`);
    return false;
  }
}

function updateAgentRuleFiles() {
  const claudeRuleFile = path.join(home, '.claude', 'CLAUDE.md');
  ensureRuleInFile(claudeRuleFile, 'Claude Code global rules (CLAUDE.md)');

  const geminiRuleFile = path.join(home, '.gemini', 'config', 'GEMINI.md');
  ensureRuleInFile(geminiRuleFile, 'Antigravity global rules (GEMINI.md)');
}

const HOOK_SOURCE = path.join(__dirname, '..', 'hooks', 'require-plan-previewer.mjs');
const HOOK_DEST_DIR = path.join(home, '.claude', 'hooks');
const HOOK_DEST = path.join(HOOK_DEST_DIR, 'require-plan-previewer.mjs');
const SETTINGS_PATH = path.join(home, '.claude', 'settings.json');
const HOOK_COMMAND = 'node "$HOME/.claude/hooks/require-plan-previewer.mjs"';

function installEnforcementHook() {
  try {
    fs.mkdirSync(HOOK_DEST_DIR, { recursive: true });
    fs.copyFileSync(HOOK_SOURCE, HOOK_DEST);
    console.log(` ${pc.green('✔')} Installed enforcement hook -> ${pc.gray(HOOK_DEST)}`);
  } catch (err) {
    console.error(` ${pc.red('✖')} Failed to install enforcement hook: ${err.message}`);
    return;
  }

  let settings = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } else {
      fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    }
  } catch (err) {
    console.error(
      ` ${pc.yellow('⚠')} Could not parse existing ${SETTINGS_PATH}: ${err.message}. Skipping hook registration to avoid corrupting it.`
    );
    return;
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];

  const alreadyRegistered = settings.hooks.PreToolUse.some(
    (entry) =>
      entry.matcher === 'ExitPlanMode' &&
      (entry.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('require-plan-previewer'))
  );

  if (alreadyRegistered) {
    console.log(` ${pc.blue('ℹ')} Enforcement hook already registered in ${pc.bold('settings.json')}`);
    return;
  }

  settings.hooks.PreToolUse.push({
    matcher: 'ExitPlanMode',
    hooks: [
      {
        type: 'command',
        command: HOOK_COMMAND,
        shell: 'bash',
        timeout: 15,
      },
    ],
  });

  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log(
      ` ${pc.green('✔')} Registered PreToolUse/ExitPlanMode enforcement hook in ${pc.bold('settings.json')} -> ${pc.gray(
        SETTINGS_PATH
      )}`
    );
  } catch (err) {
    console.error(` ${pc.red('✖')} Failed to update ${SETTINGS_PATH}: ${err.message}`);
  }
}

function ensureRuleInFile(filePath, label) {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';

    if (!content.includes('Plan Previewer Required Execution') && !content.includes('npx plan-previewer')) {
      content += '\n' + MANDATORY_RULE_BLOCK.trim() + '\n';
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(` ${pc.green('✔')} Added mandatory execution rule to ${pc.bold(label)} -> ${pc.gray(filePath)}`);
    } else {
      console.log(` ${pc.blue('ℹ')} Rule already present in ${pc.bold(label)}`);
    }
  } catch (err) {
    console.error(` ${pc.yellow('⚠')} Could not update ${label}: ${err.message}`);
  }
}

async function main() {
  const isAuto = process.argv.includes('--auto') || !process.stdin.isTTY;

  console.log(pc.bold(pc.cyan('\n🛠️  Plan Previewer Agent Setup & Skill Installer')));
  console.log(pc.gray('Configures auto-plan viewing skills and mandatory agent rules for Claude Code and Antigravity.\n'));

  let shouldInstall = true;

  if (!isAuto) {
    const answer = await promptUser(
      pc.bold('Do you want to install Plan Previewer skills and agent rules for Claude Code and Antigravity? (Y/n): ')
    );
    if (answer === 'n' || answer === 'no') {
      shouldInstall = false;
    }
  }

  if (!shouldInstall) {
    console.log(pc.yellow('Setup skipped by user. You can run `npx plan-previewer install` anytime.'));
    process.exit(0);
  }

  console.log(pc.bold('Installing skills across agent environments:'));
  let installedCount = 0;

  for (const env of TARGET_ENVIRONMENTS) {
    const success = installSkillToPath(env.path, `${env.icon} ${env.name}`, env.agentId);
    if (success) installedCount++;
  }

  console.log(pc.bold('\nConfiguring mandatory agent rules:'));
  updateAgentRuleFiles();

  console.log(pc.bold('\nInstalling enforcement hook (Claude Code):'));
  installEnforcementHook();

  console.log(
    pc.bold(
      pc.green(`\nSuccessfully configured ${installedCount} agent skill environments and agent rules!`)
    )
  );
}

main().catch((err) => {
  console.error(pc.red(`Installer error: ${err.message}`));
});
