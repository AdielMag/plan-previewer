import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCallerAgent } from '../src/detector.js';

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
});

test('detectCallerAgent - environment variable detection', () => {
  const originalEnv = process.env.CLAUDE_CODE;
  process.env.CLAUDE_CODE = '1';
  delete process.env.ANTIGRAVITY_AGENT;
  delete process.env.AGY_VERSION;

  const result = detectCallerAgent();
  assert.equal(result.id, 'claude');

  delete process.env.CLAUDE_CODE;
  process.env.ANTIGRAVITY_AGENT = '1';
  const agResult = detectCallerAgent();
  assert.equal(agResult.id, 'antigravity');

  // Restore env
  if (originalEnv) process.env.CLAUDE_CODE = originalEnv;
  else delete process.env.CLAUDE_CODE;
  delete process.env.ANTIGRAVITY_AGENT;
});
