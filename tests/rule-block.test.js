import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyManagedRuleBlock,
  buildManagedRuleBlock,
  findLegacyBlock,
  RULE_BLOCK_START,
  RULE_BLOCK_END,
} from '../src/rule-block.js';

const LEGACY_BLOCK = `# Plan Previewer Required Execution

Whenever you write a plan you MUST follow this protocol:

1. Run \`npx plan-previewer <path-to-plan>\` in terminal.
2. Wait for it to exit (~4 minutes by default).
`;

test('applyManagedRuleBlock - adds block to an empty file', () => {
  const { content, mode } = applyManagedRuleBlock('');
  assert.equal(mode, 'added');
  assert.ok(content.includes(RULE_BLOCK_START));
  assert.ok(content.includes(RULE_BLOCK_END));
  assert.ok(content.endsWith('\n'));
});

test('applyManagedRuleBlock - appends without disturbing existing user rules', () => {
  const userRules = '# My Rules\n\nAlways write tests first.\n';
  const { content, mode } = applyManagedRuleBlock(userRules);

  assert.equal(mode, 'added');
  assert.ok(content.startsWith('# My Rules'));
  assert.ok(content.includes('Always write tests first.'));
  assert.ok(content.indexOf(RULE_BLOCK_START) > content.indexOf('Always write tests first.'));
});

test('applyManagedRuleBlock - is idempotent', () => {
  const first = applyManagedRuleBlock('# My Rules\n\nBe concise.\n').content;
  const second = applyManagedRuleBlock(first);

  assert.equal(second.mode, 'unchanged');
  assert.equal(second.content, first);

  // A third pass must not accumulate duplicate blocks either.
  const third = applyManagedRuleBlock(second.content);
  assert.equal(third.mode, 'unchanged');
  assert.equal(third.content.match(new RegExp(RULE_BLOCK_START, 'g')).length, 1);
});

test('applyManagedRuleBlock - refreshes a stale managed block in place', () => {
  const stale = `# My Rules\n\nBe concise.\n\n${RULE_BLOCK_START}\nOUTDATED INSTRUCTIONS\n${RULE_BLOCK_END}\n\n# Trailing Section\n\nKeep me.\n`;
  const { content, mode } = applyManagedRuleBlock(stale);

  assert.equal(mode, 'updated');
  assert.ok(!content.includes('OUTDATED INSTRUCTIONS'), 'stale body must be replaced');
  assert.ok(content.includes('Be concise.'), 'content before the block is preserved');
  assert.ok(content.includes('# Trailing Section'), 'content after the block is preserved');
  assert.ok(content.includes('Keep me.'));
  assert.equal(content.match(new RegExp(RULE_BLOCK_START, 'g')).length, 1);
});

test('applyManagedRuleBlock - migrates a legacy unmarked block', () => {
  const legacyFile = `# Adiel's Global Instructions\n\nBe direct.\n\n${LEGACY_BLOCK}`;
  const { content, mode } = applyManagedRuleBlock(legacyFile);

  assert.equal(mode, 'migrated');
  assert.ok(content.includes("# Adiel's Global Instructions"));
  assert.ok(content.includes('Be direct.'));
  assert.ok(content.includes(RULE_BLOCK_START), 'block is now marked for future updates');
  assert.ok(!content.includes('(~4 minutes by default)'), 'legacy wording is gone');
  assert.equal(content.match(/# Plan Previewer Required Execution/g).length, 1, 'no duplicate rule heading');
});

test('applyManagedRuleBlock - legacy migration stops at the next heading', () => {
  const legacyFile = `# Top\n\nkeep before\n\n${LEGACY_BLOCK}\n# Subagent Delegation Protocol\n\nkeep after\n`;
  const { content, mode } = applyManagedRuleBlock(legacyFile);

  assert.equal(mode, 'migrated');
  assert.ok(content.includes('keep before'));
  assert.ok(content.includes('# Subagent Delegation Protocol'));
  assert.ok(content.includes('keep after'));
  assert.ok(!content.includes('~4 minutes by default'));
});

test('applyManagedRuleBlock - migrating twice converges', () => {
  const once = applyManagedRuleBlock(`# Top\n\nhi\n\n${LEGACY_BLOCK}`).content;
  const twice = applyManagedRuleBlock(once);
  assert.equal(twice.mode, 'unchanged');
});

test('findLegacyBlock - returns null when no legacy block exists', () => {
  assert.equal(findLegacyBlock('# Unrelated\n\nnothing here\n'), null);
  assert.equal(findLegacyBlock(''), null);
});

test('buildManagedRuleBlock - carries current guidance and markers', () => {
  const block = buildManagedRuleBlock();
  assert.ok(block.startsWith(RULE_BLOCK_START));
  assert.ok(block.endsWith(RULE_BLOCK_END));
  assert.ok(block.includes('Pi CLI'), 'Pi guidance must ship in the managed block');
  assert.ok(block.includes('4 minutes under Pi CLI'));
});
