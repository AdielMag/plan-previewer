import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCallerAgent, createAgentMeta, detectAgentIdFromEnv } from '../src/detector.js';
import { resolveWaitTimeoutSec, BOUNDED_WAIT_SEC, UNBOUNDED_WAIT_SEC } from '../src/wait-timeout.js';

const AGENT_ENV_KEYS = [
  'CLAUDE_CODE',
  'CLAUDE_CONVERSATION_ID',
  'CLAUDE_PROJECT_DIR',
  'ANTIGRAVITY_AGENT',
  'AGY_VERSION',
  'GEMINI_CONVERSATION_ID',
  'PI_CODING_AGENT',
  'PI_SESSION_ID',
  'PI_MODEL',
  'PI_PROVIDER',
];

function withEnv(vars, fn) {
  const saved = {};
  for (const key of AGENT_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of AGENT_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('detectCallerAgent - explicit CLI argument overrides', () => {
  const claudeAgent = detectCallerAgent({ agent: 'claude' });
  assert.equal(claudeAgent.id, 'claude');
  assert.equal(claudeAgent.name, 'Claude Code');

  const antigravityAgent = detectCallerAgent({ agent: 'antigravity' });
  assert.equal(antigravityAgent.id, 'antigravity');
  assert.equal(antigravityAgent.name, 'Antigravity');

  const customAgent = detectCallerAgent({ agent: 'custom' });
  assert.equal(customAgent.id, 'custom');
  assert.equal(customAgent.name, 'Custom');

  const piAgent = detectCallerAgent({ agent: 'pi' });
  assert.equal(piAgent.id, 'pi');
  assert.equal(piAgent.name, 'Pi CLI');
});

test('createAgentMeta - pi aliases and branding', () => {
  for (const alias of ['pi', 'PI', 'pi-cli']) {
    const meta = createAgentMeta(alias, 'test');
    assert.equal(meta.id, 'pi');
    assert.equal(meta.name, 'Pi CLI');
    assert.equal(meta.badge, 'Pi CLI');
    assert.ok(meta.color && meta.accentColor, 'pi meta must carry brand colors for the UI avatar');
  }
});

test('detectCallerAgent - pi environment detection', () => {
  withEnv({ PI_CODING_AGENT: 'true' }, () => {
    assert.equal(detectCallerAgent().id, 'pi');
  });

  withEnv({ PI_SESSION_ID: 'abc-123' }, () => {
    assert.equal(detectCallerAgent().id, 'pi');
  });

  withEnv({ PI_MODEL: 'claude-opus-5', PI_PROVIDER: 'anthropic' }, () => {
    assert.equal(detectCallerAgent().id, 'pi');
  });
});

test('detectCallerAgent - pi wins over the model it happens to run', () => {
  // Pi can drive Anthropic models; PI_MODEL=claude-* must not be reported as
  // a Claude Code session, since the host agent is what the UI and skill
  // instructions key off of.
  withEnv({ PI_CODING_AGENT: 'true', PI_MODEL: 'claude-opus-5', PI_PROVIDER: 'anthropic' }, () => {
    const result = detectCallerAgent();
    assert.equal(result.id, 'pi');
    assert.equal(result.name, 'Pi CLI');
  });
});

test('detectCallerAgent - explicit flag still overrides pi env', () => {
  withEnv({ PI_CODING_AGENT: 'true' }, () => {
    assert.equal(detectCallerAgent({ agent: 'claude' }).id, 'claude');
  });
});

test('detectAgentIdFromEnv - pure env detection without process-tree cost', () => {
  assert.equal(detectAgentIdFromEnv({ PI_CODING_AGENT: 'true' }), 'pi');
  assert.equal(detectAgentIdFromEnv({ CLAUDE_CODE: '1' }), 'claude');
  assert.equal(detectAgentIdFromEnv({ AGY_VERSION: '1' }), 'antigravity');
  assert.equal(detectAgentIdFromEnv({}), null);

  // Pi driving an Anthropic model is still Pi.
  assert.equal(detectAgentIdFromEnv({ PI_CODING_AGENT: 'true', CLAUDE_CODE: '1' }), 'pi');
});

test('resolveWaitTimeoutSec - pi gets a bounded wait, others do not', () => {
  // Pi's bash tool applies no timeout, so an unbounded wait would freeze the
  // agent's turn until manually aborted.
  assert.equal(resolveWaitTimeoutSec({}, { PI_CODING_AGENT: 'true' }), BOUNDED_WAIT_SEC);
  assert.equal(resolveWaitTimeoutSec({ agent: 'pi' }, {}), BOUNDED_WAIT_SEC);
  assert.equal(resolveWaitTimeoutSec({ agent: 'PI' }, {}), BOUNDED_WAIT_SEC);

  // Harnesses that cut commands off themselves keep the long wait.
  assert.equal(resolveWaitTimeoutSec({}, { CLAUDE_CODE: '1' }), UNBOUNDED_WAIT_SEC);
  assert.equal(resolveWaitTimeoutSec({}, { AGY_VERSION: '1' }), UNBOUNDED_WAIT_SEC);
  assert.equal(resolveWaitTimeoutSec({}, {}), UNBOUNDED_WAIT_SEC);
});

test('resolveWaitTimeoutSec - explicit --wait-timeout always wins', () => {
  assert.equal(resolveWaitTimeoutSec({ waitTimeoutMs: 15000 }, { PI_CODING_AGENT: 'true' }), 15);
  assert.equal(resolveWaitTimeoutSec({ waitTimeoutMs: 15000 }, { CLAUDE_CODE: '1' }), 15);
});

test('detectCallerAgent - environment variable detection', () => {
  withEnv({ CLAUDE_CODE: '1' }, () => {
    assert.equal(detectCallerAgent().id, 'claude');
  });

  withEnv({ ANTIGRAVITY_AGENT: '1' }, () => {
    assert.equal(detectCallerAgent().id, 'antigravity');
  });
});
