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

# Plan Previewer

When writing or updating plan markdown files, run:
\`\`\`bash
npx plan-previewer ./plan.md${agentFlag} --context="Brief task summary"
\`\`\`
Read \`./.plan-feedback.json\` for user edits, questions, and approval status.
`;
}

const MANDATORY_RULE_BLOCK = `
# Plan Previewer Required Execution
Whenever writing, updating, or editing plan markdown files, execute \`npx plan-previewer <path-to-plan> --context="<task summary>"\`. Read \`./.plan-feedback.json\` for user feedback.
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

  console.log(
    pc.bold(
      pc.green(`\nSuccessfully configured ${installedCount} agent skill environments and agent rules!`)
    )
  );
}

main().catch((err) => {
  console.error(pc.red(`Installer error: ${err.message}`));
});
