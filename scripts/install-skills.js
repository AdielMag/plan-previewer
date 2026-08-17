#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import pc from 'picocolors';
import { fileURLToPath } from 'url';
import { applyManagedRuleBlock } from '../src/rule-block.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\Adiel';
}

const home = getHomeDir();

const REGISTRY_SKILLS_DIR = path.join(home, '.agents', 'skills');

const TARGET_ENVIRONMENTS = [
  // The universal registry is installed first so link-based targets below can
  // point at a directory that already exists.
  {
    agentId: 'auto',
    name: 'Universal Agents Registry',
    path: path.join(REGISTRY_SKILLS_DIR, 'plan-previewer'),
    icon: '🧠',
  },
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
    // Pi loads BOTH ~/.pi/agent/skills and ~/.agents/skills. Writing a second
    // real copy here would make Pi report a "skill name collision" diagnostic
    // on every start, so this target links to the registry copy instead - Pi
    // canonicalizes skill paths and silently de-duplicates links.
    agentId: 'pi',
    name: 'Pi CLI',
    path: path.join(home, '.pi', 'agent', 'skills', 'plan-previewer'),
    icon: 'π',
    linkToRegistry: true,
  },
];

function generateSkillContent(agentId) {
  const agentFlag = agentId && agentId !== 'auto' ? ` --agent=${agentId}` : '';
  return `---
name: plan-previewer
description: MANDATORY before executing a plan (authoring/approval + revision rounds) and any time you deliberately want to check in with the user mid-execution. NOT for routine plan-file edits (e.g. checklist ticking) after approval.
---

# Plan Previewer Protocol

Plan Previewer has two distinct triggers - know which one applies before you launch it:

- **Phase A - Before execution (mandatory).** Any time you are authoring or revising a markdown plan file (e.g. \`plan.md\`, \`PLAN.md\`) for approval - including the first draft and every \`changes_requested\`/\`questions_asked\` revision round - you MUST follow the protocol below before proceeding.
- **Phase B - After approval (execution phase).** Once \`status\` is \`"approved"\` and you've started executing, do NOT re-launch Plan Previewer just because the plan file changed again (checking off \`- [x]\` tasks, appending progress notes, etc). Only launch it again if you have a deliberate, standalone reason to show the user something or ask them a question mid-execution (a blocking decision, a checkpoint, a final summary). When that happens, run the exact same protocol again - don't fall back to a plain chat message instead.

## Rule Zero: never ask the user questions in chat

While a Plan Previewer session is open (Phase A **or** Phase B), you MUST NOT ask the user anything in the CLI/chat - no questionnaire tool, no "which option do you prefer?" message. That splits the conversation across two surfaces and destroys the review context. Push the question into the **already-open tab** instead:

\`\`\`bash
# free-text question
npx plan-previewer ./plan.md${agentFlag} --ask="Should we ship behind a feature flag?"

# multiple-choice question (inline JSON, repeatable)
npx plan-previewer ./plan.md${agentFlag} --ask='{"id":"cache","type":"choice","title":"Cache backend","question":"Which store?","options":[{"label":"Redis","recommended":true},{"label":"SQLite"}]}'

# batch of questions
npx plan-previewer ./plan.md${agentFlag} --ask-file=./.plan-questions.json
\`\`\`

- Questions render as an **"<Agent> needs your input"** panel in the same tab (Approve stays disabled until answered).
- Answers return in \`.plan-feedback.json\` as \`status: "answered"\` + \`answers[]\`, and print as \`[PLAN-ANSWERS]\` on stdout.
- \`.plan-questions.json\` next to the plan is auto-detected and consumed after being asked once.
- The daemon stays alive after approval, so execution-phase questions reuse the same tab instead of opening a new one.

## Protocol (both phases)

0. **Apply the \`rich-plan-formatting\` skill to the plan content first.** Before launching the previewer, structure the plan to be concise and human-readable first (with progressive disclosure via collapsible \`<details>\` blocks for low-level details, choice/question blocks, alert callouts, and status badges) - Plan Previewer renders these specially, and a bloated, unformatted plan defeats the point of reviewing it in this viewer.

1. **Launch Previewer as a plain, blocking foreground command:**
   \`\`\`bash
   npx plan-previewer ./plan.md${agentFlag} --context="Brief task summary"
   \`\`\`
   - On **Claude Code** and **Pi CLI**: The command runs synchronously in foreground and blocks until the user submits feedback. No hook is involved - just let the \`bash\` tool call finish on its own.
   - On **Antigravity AGY**: If \`run_command\` sends the process to a background task, simply stop calling tools to end your turn. The installed \`Stop\` hook intercepts the execution loop's termination and automatically resumes your session with the result the instant the user submits feedback in the web UI - no extra tool call is needed.

2. **CRITICAL: STOP & WAIT FOR THE COMMAND TO EXIT**
   - Do NOT execute any subsequent plan steps or tool calls while it is running.
   - Do NOT edit project code or run further bash commands.
   - The command exits on its own either when the user submits feedback (Request Changes or Approve) in the browser tab, **or** after a bounded wait with no decision yet — 4 minutes under Pi CLI, and on other harnesses whenever their own command timeout fires. This second case is normal, not an error or a signal to give up: it exists because a single command may not be allowed to run as long as a human takes to review a plan. Just re-run the same command.

3. **Inspect Feedback & Act**
   - Once the command exits, check \`.plan-feedback.json\` (or \`.plan-feedback.md\`) next to the plan file.
   - If it doesn't exist yet, or its \`status\` is the same one you already handled in a previous round (nothing new since your last check): the user simply hasn't responded yet. **Just re-run the exact same command again** and keep waiting — repeat as many times as it takes.
   - If \`status\` is \`"approved"\`, DO NOT wait for another user prompt—immediately begin executing the plan steps (Phase B), and stop re-launching Plan Previewer for routine plan-file edits from here on.
   - If \`status\` is \`"answered"\`, read \`answers[]\`, apply them, and re-run the command (adding \`--response="..."\`) so the user sees the outcome in the same tab. If you still need input, re-run with \`--ask="..."\` - never fall back to asking in chat.
   - If \`status\` is \`"changes_requested"\` or \`"questions_asked"\` **and you haven't already addressed it**, address user comments/questions, update the plan file, then re-run the exact same command (same plan file, default port). The already-open browser tab detects the server coming back and shows your update in place automatically.

4. **This is enforced, not optional, on Claude Code.** A \`PreToolUse\` hook on \`ExitPlanMode\`, installed alongside this skill, blocks exiting plan mode unless a fresh, \`"approved"\` \`.plan-feedback.json\` exists next to the plan file. This hook only guards Phase A; it does not require re-running Plan Previewer for every Phase B plan-file edit. Do not reason your way past steps 1-3 during Phase A.
`;
}

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

function installSkillToPath(targetDir, name, agentId, quiet = false) {
  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const targetFile = path.join(targetDir, 'SKILL.md');
    const content = generateSkillContent(agentId);
    fs.writeFileSync(targetFile, content, 'utf8');

    // Also install rich-plan-formatting skill in sibling directory
    const richSkillDir = path.join(path.dirname(targetDir), 'rich-plan-formatting');
    fs.mkdirSync(richSkillDir, { recursive: true });
    const richSource = path.join(__dirname, '..', 'skills', 'rich-plan-formatting', 'SKILL.md');
    if (fs.existsSync(richSource)) {
      fs.copyFileSync(richSource, path.join(richSkillDir, 'SKILL.md'));
    }

    if (!quiet) {
      console.log(` ${pc.green('✔')} Installed skills to ${pc.bold(name)} -> ${pc.gray(targetFile)}`);
    }
    return true;
  } catch (err) {
    console.error(` ${pc.red('✖')} Failed to install to ${name}: ${err.message}`);
    return false;
  }
}

/**
 * Point `targetDir` at the matching skill directory in ~/.agents/skills instead
 * of duplicating its contents. Uses a Windows junction when a plain symlink is
 * not permitted (symlinks need Developer Mode / elevation there, junctions do
 * not), and falls back to a real copy if neither is possible.
 * @returns {boolean} true if the link/copy succeeded
 */
function linkSkillDir(targetDir, registryDir, agentId) {
  if (!fs.existsSync(registryDir)) return false;

  try {
    const existing = fs.lstatSync(targetDir, { throwIfNoEntry: false });
    if (existing) {
      // Already linked to the right place - nothing to do.
      if (existing.isSymbolicLink()) {
        try {
          if (fs.realpathSync(targetDir) === fs.realpathSync(registryDir)) return true;
        } catch (e) {}
      }
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(targetDir), { recursive: true });
  } catch (err) {
    return false;
  }

  for (const type of ['junction', 'dir']) {
    try {
      fs.symlinkSync(registryDir, targetDir, type);
      return true;
    } catch (err) {
      if (process.platform !== 'win32') break;
    }
  }

  // Last resort: a real copy. Pi may emit a skill-name collision diagnostic in
  // this case, but having the skill available matters more.
  return installSkillToPath(targetDir, 'copy fallback', agentId, true);
}

function updateAgentRuleFiles() {
  const claudeRuleFile = path.join(home, '.claude', 'CLAUDE.md');
  ensureRuleInFile(claudeRuleFile, 'Claude Code global rules (CLAUDE.md)');

  const geminiRuleFile = path.join(home, '.gemini', 'config', 'GEMINI.md');
  ensureRuleInFile(geminiRuleFile, 'Antigravity global rules (GEMINI.md)');

  // Pi CLI loads its global context file from the agent dir, preferring
  // AGENTS.md over CLAUDE.md.
  const piRuleFile = path.join(home, '.pi', 'agent', 'AGENTS.md');
  ensureRuleInFile(piRuleFile, 'Pi CLI global rules (AGENTS.md)');
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

    const original = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    const { content, mode } = applyManagedRuleBlock(original);

    if (mode === 'unchanged') {
      console.log(` ${pc.blue('ℹ')} Rule already up to date in ${pc.bold(label)}`);
      return;
    }

    // These are user-owned files that normally hold unrelated personal
    // instructions. Upgrading a pre-marker block is the only path that rewrites
    // a region we did not previously delimit, so keep a one-time backup.
    if (mode === 'migrated') {
      const backupPath = `${filePath}.plan-previewer.bak`;
      if (!fs.existsSync(backupPath)) {
        fs.writeFileSync(backupPath, original, 'utf8');
        console.log(` ${pc.blue('ℹ')} Backed up previous ${pc.bold(label)} -> ${pc.gray(backupPath)}`);
      }
    }

    fs.writeFileSync(filePath, content, 'utf8');

    const verb = { added: 'Added', updated: 'Refreshed', migrated: 'Upgraded legacy' }[mode];
    console.log(` ${pc.green('✔')} ${verb} mandatory execution rule in ${pc.bold(label)} -> ${pc.gray(filePath)}`);
  } catch (err) {
    console.error(` ${pc.yellow('⚠')} Could not update ${label}: ${err.message}`);
  }
}

function installAgyHook() {
  const targetPaths = [
    // Global Customizations Root - applies regardless of which workspace is open.
    path.join(getHomeDir(), '.gemini', 'config', 'hooks.json'),
    // Workspace Customizations Root for whichever project the installer is run from.
    path.join(process.cwd(), '.agents', 'hooks.json'),
  ];

  const scriptPath = path.resolve(__dirname, 'agy-stop-hook.js').replace(/\\/g, '/');

  for (const agyHooksPath of targetPaths) {
    try {
      const dir = path.dirname(agyHooksPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let agyHooks = {};
      if (fs.existsSync(agyHooksPath)) {
        try {
          agyHooks = JSON.parse(fs.readFileSync(agyHooksPath, 'utf8'));
        } catch (e) {}
      }

      agyHooks['plan-previewer-guard'] = {
        Stop: [
          {
            type: 'command',
            command: `node "${scriptPath}"`,
            timeout: 250,
          },
        ],
      };

      fs.writeFileSync(agyHooksPath, JSON.stringify(agyHooks, null, 2), 'utf8');
      console.log(` ${pc.green('✔')} Installed AGY Stop hook -> ${pc.gray(agyHooksPath)}`);
    } catch (err) {
      console.error(` ${pc.yellow('⚠')} Could not install AGY Stop hook at ${agyHooksPath}: ${err.message}`);
    }
  }
}

function installPiExtensions() {
  const piExtensionsDir = path.join(home, '.pi', 'agent', 'extensions');
  const sourceDir = path.join(__dirname, '..', 'extensions');

  if (!fs.existsSync(sourceDir)) return;

  try {
    fs.mkdirSync(piExtensionsDir, { recursive: true });

    // 1. Install plan-mode extension
    const planModeSrc = path.join(sourceDir, 'plan-mode');
    const planModeDest = path.join(piExtensionsDir, 'plan-mode');
    if (fs.existsSync(planModeSrc)) {
      fs.mkdirSync(planModeDest, { recursive: true });
      for (const file of fs.readdirSync(planModeSrc)) {
        fs.copyFileSync(path.join(planModeSrc, file), path.join(planModeDest, file));
      }
      console.log(` ${pc.green('✔')} Installed enhanced plan-mode extension -> ${pc.gray(planModeDest)}`);
    }

    // 2. Install questionnaire tool extension
    const questionnaireSrc = path.join(sourceDir, 'questionnaire.ts');
    const questionnaireDest = path.join(piExtensionsDir, 'questionnaire.ts');
    if (fs.existsSync(questionnaireSrc)) {
      fs.copyFileSync(questionnaireSrc, questionnaireDest);
      console.log(` ${pc.green('✔')} Installed questionnaire extension -> ${pc.gray(questionnaireDest)}`);
    }
  } catch (err) {
    console.error(` ${pc.yellow('⚠')} Could not install Pi extensions: ${err.message}`);
  }
}

async function main() {
  const isAuto = process.argv.includes('--auto') || !process.stdin.isTTY;

  console.log(pc.bold(pc.cyan('\n🛠️  Plan Previewer Agent Setup & Skill Installer')));
  console.log(pc.gray('Configures auto-plan viewing skills and mandatory agent rules for Claude Code, Antigravity, and Pi CLI.\n'));

  let shouldInstall = true;

  if (!isAuto) {
    const answer = await promptUser(
      pc.bold('Do you want to install Plan Previewer skills and agent rules for Claude Code, Antigravity, and Pi CLI? (Y/n): ')
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
    const label = `${env.icon} ${env.name}`;
    let success;

    if (env.linkToRegistry) {
      success =
        linkSkillDir(env.path, path.join(REGISTRY_SKILLS_DIR, 'plan-previewer'), env.agentId) &&
        linkSkillDir(
          path.join(path.dirname(env.path), 'rich-plan-formatting'),
          path.join(REGISTRY_SKILLS_DIR, 'rich-plan-formatting'),
          env.agentId
        );
      if (success) {
        console.log(` ${pc.green('✔')} Linked skills for ${pc.bold(label)} -> ${pc.gray(env.path)}`);
      } else {
        // Linking failed entirely - fall back to a standalone copy.
        success = installSkillToPath(env.path, label, env.agentId);
      }
    } else {
      success = installSkillToPath(env.path, label, env.agentId);
    }

    if (success) installedCount++;
  }

  console.log(pc.bold('\nConfiguring mandatory agent rules:'));
  updateAgentRuleFiles();

  console.log(pc.bold('\nInstalling enforcement hooks & agent extensions:'));
  installEnforcementHook();
  installAgyHook();
  installPiExtensions();

  console.log(
    pc.bold(
      pc.green(`\nSuccessfully configured ${installedCount} agent skill environments and agent hooks!`)
    )
  );
}

main().catch((err) => {
  console.error(pc.red(`Installer error: ${err.message}`));
});
