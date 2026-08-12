import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Automatically detects whether the plan-previewer was launched from Claude Code or Antigravity.
 * @param {object} options CLI options passed to plan-previewer
 * @returns {object} Caller metadata containing agent ID, display name, icon, and detection reason.
 */
export function detectCallerAgent(options = {}) {
  // 1. Explicit CLI argument override flag
  if (options.agent && (options.agent === 'claude' || options.agent === 'antigravity')) {
    return createAgentMeta(options.agent, 'CLI argument flag');
  }

  const env = process.env;

  // 2. Direct Environment Variable Signals
  if (env.CLAUDE_CODE || env.CLAUDE_CONVERSATION_ID || env.CLAUDE_PROJECT_DIR) {
    return createAgentMeta('claude', 'Claude Code environment active');
  }
  if (env.ANTIGRAVITY_AGENT || env.AGY_VERSION || env.GEMINI_CONVERSATION_ID) {
    return createAgentMeta('antigravity', 'Antigravity environment active');
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

  // Default fallback if running in standalone terminal
  return createAgentMeta('claude', 'Defaulted to Claude Code');
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
        const out = execSync(psCmd, { encoding: 'utf8', timeout: 3000 });
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

function createAgentMeta(agentId, reason) {
  if (agentId === 'antigravity') {
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
