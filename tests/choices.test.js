import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChoiceOptionText, formatActivityChoiceLabel } from '../src/choices-helper.js';

test('parseChoiceOptionText - parses standard bold option with recommended tag', () => {
  const parsed = parseChoiceOptionText('(x) **Option A**: Redis (Fast in-memory storage) [Recommended]');
  assert.equal(parsed.isDefaultChecked, true);
  assert.equal(parsed.isRecommended, true);
  assert.equal(parsed.title, 'Option A');
  assert.equal(parsed.description, 'Redis (Fast in-memory storage)');
  assert.ok(!parsed.clean.includes('[Recommended]'));
});

test('parseChoiceOptionText - parses unselected option with paren description', () => {
  const parsed = parseChoiceOptionText('( ) Memcached (Simple key-value cache)');
  assert.equal(parsed.isDefaultChecked, false);
  assert.equal(parsed.isRecommended, false);
  assert.equal(parsed.title, 'Memcached');
  assert.equal(parsed.description, 'Simple key-value cache');
});

test('parseChoiceOptionText - parses plain unformatted option', () => {
  const parsed = parseChoiceOptionText('PostgreSQL UNLOGGED table');
  assert.equal(parsed.title, 'PostgreSQL UNLOGGED table');
  assert.equal(parsed.description, '');
  assert.equal(parsed.isRecommended, false);
});

test('formatActivityChoiceLabel - formats choice and question records', () => {
  assert.equal(
    formatActivityChoiceLabel({ type: 'choice', title: 'Database Choice', selected: 'Redis' }),
    'Database Choice: Redis'
  );
  assert.equal(
    formatActivityChoiceLabel({ type: 'choice', title: 'Database Choice', selected: '' }),
    'Database Choice: (None selected)'
  );
  assert.equal(
    formatActivityChoiceLabel({ type: 'question', title: 'Migration Requirement', answer: 'Yes, run script' }),
    'Migration Requirement: "Yes, run script"'
  );
});
