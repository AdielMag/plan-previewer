import { detectAgentIdFromEnv } from './detector.js';

/**
 * Bounded default for agents whose command runner has no timeout of its own.
 * Matches the "re-run the same command and keep waiting" loop the skill
 * instructions describe.
 */
export const BOUNDED_WAIT_SEC = 240;

/** Effectively "wait until the user decides" for harnesses that cap tool calls themselves. */
export const UNBOUNDED_WAIT_SEC = 24 * 60 * 60;

/**
 * Agents that impose NO timeout on the commands they run. For these, an
 * unbounded wait would freeze the agent's turn indefinitely with no way to
 * recover except a manual abort, so the previewer bounds its own wait and
 * relies on the agent re-running the command.
 *
 * Pi's bash tool takes an optional `timeout` argument and registers no timer
 * at all when it is omitted (see pi-coding-agent `dist/core/tools/bash.js`),
 * which is exactly this case. Claude Code and Antigravity both cut commands
 * off on their own, so they keep the unbounded default.
 */
const AGENTS_WITHOUT_COMMAND_TIMEOUT = new Set(['pi', 'pi-cli']);

/**
 * Decide how long the CLI should wait for a review decision.
 *
 * @param {object} [options] parsed CLI options
 * @param {number} [options.waitTimeoutMs] explicit --wait-timeout, always wins
 * @param {string} [options.agent] explicit --agent override
 * @param {NodeJS.ProcessEnv} [env] environment used for agent auto-detection
 * @returns {number} wait timeout in seconds
 */
export function resolveWaitTimeoutSec(options = {}, env = process.env) {
  if (options.waitTimeoutMs) {
    return Math.round(options.waitTimeoutMs / 1000);
  }

  const agentId = (options.agent || detectAgentIdFromEnv(env) || '').toLowerCase().trim();
  return AGENTS_WITHOUT_COMMAND_TIMEOUT.has(agentId) ? BOUNDED_WAIT_SEC : UNBOUNDED_WAIT_SEC;
}
