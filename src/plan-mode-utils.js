/**
 * Pure utility functions for plan mode.
 */

import path from 'node:path';

// Destructive commands blocked in plan mode
const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
  /\byarn\s+(add|remove|install|publish)/i,
  /\bpnpm\s+(add|remove|install|publish)/i,
  /\bpip\s+(install|uninstall)/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
  /\bbrew\s+(install|uninstall|upgrade)/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

// Safe read-only commands allowed in plan mode
const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
  /^\s*yarn\s+(list|info|why|audit)/i,
  /^\s*node\s+--version/i,
  /^\s*python\s+--version/i,
  /^\s*curl\s/i,
  /^\s*wget\s+-O\s*-/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
  /^\s*bat\b/,
  /^\s*eza\b/,
];

// Plan previewer specific allowed command patterns
const PLAN_TOOL_PATTERNS = [
  /^\s*(?:npx\s+(?:-y\s+)?)?plan-previewer(?:\s+.*)?$/i,
  /^\s*node\s+.*(?:bin[/\\]plan-previewer\.js|server-runner\.js)(?:\s+.*)?$/i,
];

/**
 * Checks for shell chaining or substitution operators that could hide or chain commands.
 */
export function hasCommandChaining(command) {
  if (!command || typeof command !== 'string') return false;
  let s = command;
  if (/`|\$\(/.test(s)) return true;

  const unquoted = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  return /[;&|]|\r|\n/.test(unquoted);
}

/**
 * Strips quoted string literals from a command to inspect the command skeleton
 * without false-positiving on argument text (e.g. --context="Refactor code layout").
 */
export function stripQuotedLiterals(command) {
  if (!command || typeof command !== 'string') return '';
  return command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

/**
 * Validates whether a command is safe to execute in plan mode.
 */
export function isSafeCommand(command) {
  if (!command || typeof command !== 'string') return false;

  if (hasCommandChaining(command)) {
    return false;
  }

  const isPlanTool = PLAN_TOOL_PATTERNS.some((p) => p.test(command));
  if (isPlanTool) {
    return true;
  }

  const skeleton = stripQuotedLiterals(command);
  const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(skeleton));
  if (isDestructive) {
    return false;
  }

  return SAFE_PATTERNS.some((p) => p.test(skeleton) || p.test(command));
}

/**
 * Plan artifacts that can be safely created or edited during plan mode.
 */
const PLAN_ARTIFACT_PATTERNS = [
  /^plan\.md$/i,
  /^plan\.[a-z0-9_-]+\.md$/i,
  /^task_plan\.md$/i,
  /^implementation_plan\.md$/i,
  /^[a-z0-9_-]+[._-]plan\.md$/i,
  /^[a-z0-9_-]+-plan\.md$/i,
  /^\.plan-feedback\.(json|md)$/i,
  /^\.plan-response\.md$/i,
];

/**
 * Determines whether a file path is a permissible plan artifact in the workspace.
 * Prevents directory traversal (e.g. `../` or writing outside cwd).
 */
export function isPlanArtifactPath(filePath, cwd = process.cwd()) {
  if (!filePath || typeof filePath !== 'string') return false;

  try {
    const resolvedCwd = path.resolve(cwd);
    const resolvedTarget = path.resolve(resolvedCwd, filePath);

    const relative = path.relative(resolvedCwd, resolvedTarget);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return false;
    }

    const base = path.basename(resolvedTarget);
    return PLAN_ARTIFACT_PATTERNS.some((pattern) => pattern.test(base));
  } catch {
    return false;
  }
}

export function cleanStepText(text) {
  if (!text || typeof text !== 'string') return '';
  let cleaned = text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+|a\s+|an\s+)?/i,
      ''
    )
    .replace(/^(a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  if (cleaned.length > 50) {
    cleaned = `${cleaned.slice(0, 47)}...`;
  }
  return cleaned;
}

export function extractTodoItems(message) {
  if (!message || typeof message !== 'string') return [];
  const items = [];
  const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
  if (!headerMatch) return items;

  let planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);

  const stopMatch = planSection.match(/\n\s*#{1,4}\s+(?:Decisions|Open questions|Open items|Choice|Questions)/i);
  if (stopMatch && stopMatch.index !== undefined) {
    planSection = planSection.slice(0, stopMatch.index);
  }

  const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

  for (const match of planSection.matchAll(numberedPattern)) {
    const text = match[2]
      .trim()
      .replace(/\*{1,2}$/, '')
      .trim();

    if (
      text.length > 5 &&
      !text.startsWith('`') &&
      !text.startsWith('/') &&
      !text.startsWith('-') &&
      !text.startsWith('>') &&
      !text.toLowerCase().startsWith('[!choice') &&
      !text.toLowerCase().startsWith('[!question')
    ) {
      const cleaned = cleanStepText(text);
      if (cleaned.length > 3) {
        items.push({ step: items.length + 1, text: cleaned, completed: false });
      }
    }
  }
  return items;
}

export function extractDoneSteps(message) {
  if (!message || typeof message !== 'string') return [];
  const steps = [];
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) steps.push(step);
  }
  return steps;
}

export function markCompletedSteps(text, items) {
  if (!text || !Array.isArray(items)) return 0;
  const doneSteps = extractDoneSteps(text);
  for (const step of doneSteps) {
    const item = items.find((t) => t.step === step);
    if (item) item.completed = true;
  }
  return doneSteps.length;
}
