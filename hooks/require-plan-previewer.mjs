#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook for ExitPlanMode.
 *
 * Installed by `plan-previewer install` (see scripts/install-skills.js).
 * Enforces the "Plan Previewer Required Execution" rule at the harness
 * level: the agent's own instructions are not enough, since an agent can
 * rationalize skipping them. This hook makes ExitPlanMode fail instead.
 *
 * Denies ExitPlanMode unless, for the most recently written plan file
 * under ~/.claude/plans/:
 *   1. a .plan-feedback.json exists next to that plan file (plan-previewer
 *      writes it into path.dirname(planFile), NOT the invoking shell's
 *      cwd - see src/server.js's feedbackJsonPath),
 *   2. it is newer than the plan file (so it reflects the current plan,
 *      not a stale run from an earlier plan), and
 *   3. its "status" field is "approved".
 *
 * Note: if plansDirectory is customized away from the ~/.claude/plans/
 * default (see Claude Code's plansDirectory setting), this hook still
 * looks under the default location and will not find plans written
 * elsewhere.
 *
 * The .mjs extension forces ES module mode regardless of the nearest
 * package.json, so this file behaves the same whether it runs from
 * inside this repo or after being copied to ~/.claude/hooks/.
 * Pure Node, no external dependencies, so it works the same on
 * Windows, macOS, and Linux regardless of which shell is configured.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
  });
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}

function findNewestPlanFile(plansDir) {
  const searchDirs = [plansDir, process.cwd()].filter(Boolean);
  let newestPath = null;
  let newestMtime = -Infinity;

  for (const dir of searchDirs) {
    let files;
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
    } catch {
      continue;
    }

    for (const file of files) {
      const fullPath = path.join(dir, file);
      let mtime;
      try {
        const stats = fs.statSync(fullPath);
        if (!stats.isFile()) continue;
        mtime = stats.mtimeMs;
      } catch {
        continue;
      }
      if (mtime > newestMtime) {
        newestMtime = mtime;
        newestPath = fullPath;
      }
    }
  }
  return newestPath;
}

async function main() {
  // Read and discard stdin: the hook input JSON's cwd is the invoking
  // shell's directory, which is NOT where plan-previewer writes feedback
  // (see module comment), so it is not needed for this check.
  await readStdin();

  const home = os.homedir();
  const plansDir = path.join(home, '.claude', 'plans');
  const newestPlan = findNewestPlanFile(plansDir);

  if (!newestPlan) {
    deny(`No plan file found under ${plansDir}. Write the plan file before calling ExitPlanMode.`);
    return;
  }

  const feedbackPath = path.join(path.dirname(newestPlan), '.plan-feedback.json');
  const planMtime = fs.statSync(newestPlan).mtimeMs;

  let feedbackMtime = null;
  try {
    feedbackMtime = fs.statSync(feedbackPath).mtimeMs;
  } catch {
    feedbackMtime = null;
  }

  if (feedbackMtime === null || planMtime > feedbackMtime) {
    deny(
      `npx plan-previewer has not been run (or is stale) for '${newestPlan}'. Per the Plan Previewer Required Execution rule, run: npx plan-previewer "${newestPlan}" --context="<task summary>", wait for the viewer to close, then check ${feedbackPath} before calling ExitPlanMode again. Do not skip this step.`
    );
    return;
  }

  let status = '';
  try {
    const feedback = JSON.parse(fs.readFileSync(feedbackPath, 'utf8'));
    status = feedback.status || '';
  } catch {
    status = '';
  }

  if (status !== 'approved') {
    deny(
      `plan-previewer feedback status is '${status}', not approved (feedback file: ${feedbackPath}). Address the feedback, re-run npx plan-previewer, and wait for status "approved" before calling ExitPlanMode.`
    );
    return;
  }

  process.exit(0);
}

main();
