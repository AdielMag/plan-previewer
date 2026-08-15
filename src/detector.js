import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ENV_DETECTION_REASONS = {
  pi: 'Pi CLI environment active',
  claude: 'Claude Code environment active',
  antigravity: 'Antigravity environment active',
};

/**
 * Cheap, environment-variable-only agent detection.
 *
 * Kept separate from `detectCallerAgent` because that one may walk the parent
 * process tree via PowerShell/ps, which costs seconds. Callers that just need a
 * quick hint (e.g. choosing a default wait timeout on every CLI invocation)
 * must not pay that cost.
 *
 * @param {NodeJS.ProcessEnv} [env] environment to inspect
 * @returns {string|null} agent id, or null when no signal is present
 */
export function detectAgentIdFromEnv(env = process.env) {
  // Pi is checked first: it exports unambiguous PI_* variables, while the model
  // it happens to run (e.g. PI_MODEL=claude-opus-5) must never be mistaken for
  // the host agent itself.
  if (env.PI_CODING_AGENT || env.PI_SESSION_ID || (env.PI_MODEL && env.PI_PROVIDER)) {
    return 'pi';
  }
  if (env.CLAUDE_CODE || env.CLAUDE_CONVERSATION_ID || env.CLAUDE_PROJECT_DIR) {
    return 'claude';
  }
  if (env.ANTIGRAVITY_AGENT || env.AGY_VERSION || env.GEMINI_CONVERSATION_ID) {
    return 'antigravity';
  }
  return null;
}

/**
 * Automatically detects or formats the caller agent for plan-previewer.
 * @param {object} options CLI options passed to plan-previewer
 * @returns {object} Caller metadata containing agent ID, display name, icon, and detection reason.
 */
export function detectCallerAgent(options = {}) {
  // 1. Explicit CLI argument override flag (supports any agent name)
  if (options.agent) {
    return createAgentMeta(options.agent, `CLI argument flag (--agent=${options.agent})`);
  }

  const env = process.env;

  // 2. Direct Environment Variable Signals
  const envAgentId = detectAgentIdFromEnv(env);
  if (envAgentId) {
    return createAgentMeta(envAgentId, ENV_DETECTION_REASONS[envAgentId]);
  }

  // 3. Parent Process Tree Inspection (PPID chain)
  const detectedFromProcess = inspectParentProcessTree();
  if (detectedFromProcess) {
    return createAgentMeta(detectedFromProcess.id, detectedFromProcess.reason);
  }

  // 4. Command line env fallback
  const parentCmd = (env._ || env.COMMAND_MODE || '').toLowerCase();
  if (parentCmd.includes('claude')) {
    return createAgentMeta('claude', 'Claude binary caller detected');
  }
  if (parentCmd.includes('agy') || parentCmd.includes('antigravity')) {
    return createAgentMeta('antigravity', 'Antigravity binary caller detected');
  }
  if (isPiBinary(parentCmd)) {
    return createAgentMeta('pi', 'Pi binary caller detected');
  }

  // Default fallback if running in standalone terminal
  return createAgentMeta('agent', 'Generic agent session');
}

/**
 * Strict match for the Pi CLI executable. `pi` is a two-letter name, so a naive
 * substring test would misfire on unrelated processes (pip, pipx, spinner,
 * npm-pipe wrappers). Only an exact binary name - with or without a Windows
 * extension, and with or without a leading path - counts.
 * @param {string} value process name or command string
 * @returns {boolean}
 */
function isPiBinary(value) {
  if (!value) return false;
  const first = String(value).trim().split(/\s+/)[0].toLowerCase();
  const base = first.split(/[\\/]/).pop() || '';
  return /^pi(\.exe|\.cmd|\.ps1|\.bat)?$/.test(base);
}

function inspectParentProcessTree() {
  try {
    let currentPid = process.ppid;
    for (let depth = 0; depth < 5; depth++) {
      if (!currentPid || currentPid <= 1) break;

      let name = '';
      let cmd = '';
      let parentPid = null;

      if (process.platform === 'win32') {
        const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${currentPid}' | Format-List Name, CommandLine, ParentProcessId"`;
        // windowsHide is required here - without it, execSync flashes a
        // visible console window for every level walked (cmd.exe + the
        // powershell.exe it spawns), once per parent in the chain.
        const out = execSync(psCmd, { encoding: 'utf8', timeout: 3000, windowsHide: true });
        const nameMatch = out.match(/Name\s+:\s+(.+)/i);
        const cmdMatch = out.match(/CommandLine\s+:\s+(.+)/i);
        const ppidMatch = out.match(/ParentProcessId\s+:\s+(\d+)/i);

        if (nameMatch) name = nameMatch[1].trim();
        if (cmdMatch) cmd = cmdMatch[1].trim();
        if (ppidMatch) parentPid = parseInt(ppidMatch[1].trim(), 10);
      } else {
        const out = execSync(`ps -p ${currentPid} -o comm=,command=,ppid=`, { encoding: 'utf8', timeout: 3000 });
        const parts = out.trim().split(/\s+/);
        name = parts[0] || '';
        cmd = out.trim();
        if (parts.length > 2) {
          parentPid = parseInt(parts[parts.length - 1], 10);
        }
      }

      const fullStr = `${name} ${cmd}`.toLowerCase();

      // Check for Pi CLI processes first - its executable name is only two
      // characters, so it is matched strictly (exact binary name or the
      // pi-coding-agent/pi-node install paths) rather than by substring,
      // which would otherwise fire on words like "pip" or "spinner".
      if (isPiBinary(name) || fullStr.includes('pi-coding-agent') || fullStr.includes('pi-node')) {
        return { id: 'pi', reason: `Caller process tree includes ${name || 'pi'}` };
      }

      // Check for Claude processes
      if (fullStr.includes('claude')) {
        return { id: 'claude', reason: `Caller process tree includes ${name || 'claude'}` };
      }

      // Check for Antigravity / AGY processes
      if (fullStr.includes('agy') || fullStr.includes('antigravity') || fullStr.includes('gemini-cli')) {
        return { id: 'antigravity', reason: `Caller process tree includes ${name || 'agy'}` };
      }

      currentPid = parentPid;
    }
  } catch (err) {
    // Process tree inspection fallback
  }

  return null;
}

export function createAgentMeta(agentId, reason) {
  const id = (agentId || 'agent').toLowerCase().trim();

  if (id === 'antigravity') {
    return {
      id: 'antigravity',
      name: 'Antigravity',
      subtitle: 'Google DeepMind AI Agent',
      badge: 'Antigravity AGY',
      color: '#4285F4',
      accentColor: '#34A853',
      icon: '⚡',
      reason,
    };
  }
  if (id === 'claude' || id === 'claude-code') {
    return {
      id: 'claude',
      name: 'Claude Code',
      subtitle: 'Anthropic AI Agent',
      badge: 'Claude Code',
      color: '#D97706',
      accentColor: '#F59E0B',
      icon: '🤖',
      reason,
    };
  }
  if (id === 'pi' || id === 'pi-cli') {
    return {
      id: 'pi',
      name: 'Pi CLI',
      subtitle: 'Pi Coding Agent',
      badge: 'Pi CLI',
      color: '#7C3AED',
      accentColor: '#06B6D4',
      icon: 'π',
      reason,
    };
  }
  if (id === 'gemini') {
    return {
      id: 'gemini',
      name: 'Gemini',
      subtitle: 'Google AI Agent',
      badge: 'Gemini',
      color: '#4285F4',
      accentColor: '#EA4335',
      icon: '✨',
      reason,
    };
  }

  const capitalized = id.charAt(0).toUpperCase() + id.slice(1);
  return {
    id,
    name: capitalized,
    subtitle: 'AI Assistant',
    badge: capitalized,
    color: '#3B82F6',
    accentColor: '#10B981',
    icon: '🤖',
    reason,
  };
}
