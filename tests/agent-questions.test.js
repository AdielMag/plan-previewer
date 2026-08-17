import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { startPlanPreviewer } from '../src/server.js';
import { normalizeQuestions, parseAskFileContent, parseAskMarkdown } from '../src/ask-parser.js';

// Ephemeral ports get recycled between tests in this file, and undici's global
// connection pool can hand us a socket belonging to the previous (closed)
// server. Retry once on a hard connection failure.
async function fetchRetry(url, init, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

test('ask-parser - normalizes plain string shorthand into a text question', () => {
  const [q] = normalizeQuestions('Should we ship behind a feature flag?');
  assert.equal(q.type, 'text');
  assert.equal(q.question, 'Should we ship behind a feature flag?');
  assert.ok(q.id);
});

test('ask-parser - normalizes choice question with options', () => {
  const [q] = normalizeQuestions([
    {
      id: 'q1',
      title: 'Cache backend',
      question: 'Which store?',
      options: [
        { label: 'Redis', description: 'Fast', recommended: true },
        'SQLite',
      ],
    },
  ]);
  assert.equal(q.type, 'choice');
  assert.equal(q.id, 'q1');
  assert.equal(q.options.length, 2);
  assert.equal(q.options[0].recommended, true);
  assert.equal(q.options[1].label, 'SQLite');
});

test('ask-parser - parses [!CHOICE]/[!QUESTION] markdown blocks', () => {
  const md = [
    '> [!CHOICE] Cache backend',
    '> **Question**: Which store should we use?',
    '> - (x) **Redis**: Fast in-memory [Recommended]',
    '> - ( ) **SQLite**: Zero deps',
    '',
    '> [!QUESTION] Rollout',
    '> **Question**: Any deploy window constraints?',
  ].join('\n');

  const parsed = parseAskMarkdown(md);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].type, 'choice');
  assert.equal(parsed[0].options[0].label, 'Redis');
  assert.equal(parsed[0].options[0].recommended, true);
  assert.equal(parsed[1].type, 'text');
  assert.equal(parsed[1].question, 'Any deploy window constraints?');
});

test('ask-parser - parseAskFileContent handles JSON and markdown', () => {
  const fromJson = parseAskFileContent('[{"question":"A?"},{"question":"B?"}]');
  assert.equal(fromJson.length, 2);

  const fromMd = parseAskFileContent('> [!QUESTION] T\n> **Question**: C?');
  assert.equal(fromMd.length, 1);
  assert.equal(fromMd[0].question, 'C?');
});

test('server - agent questions round-trip: notify -> plan -> feedback answers', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ask-test-'));
  const planFile = path.join(tmpDir, 'plan.md');
  fs.writeFileSync(planFile, '# Sample Plan\n', 'utf8');

  const runner = await startPlanPreviewer(planFile, {
    port: 0,
    open: false,
    silent: true,
    testMode: true,
    context: 'Ask test session',
  });

  const testPort = runner.port;

  try {
    const initial = await (await fetch(`http://localhost:${testPort}/api/plan`)).json();
    assert.deepEqual(initial.agentQuestions, []);

    await fetch(`http://localhost:${testPort}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: planFile,
        questions: [
          { id: 'q1', type: 'choice', title: 'Cache', question: 'Which store?', options: ['Redis', 'SQLite'] },
          'Any deploy constraints?',
        ],
      }),
    });

    const afterAsk = await (await fetch(`http://localhost:${testPort}/api/plan`)).json();
    assert.equal(afterAsk.agentQuestions.length, 1);
    const round = afterAsk.agentQuestions[0];
    assert.equal(round.status, 'pending');
    assert.equal(round.questions.length, 2);
    assert.equal(round.questions[0].type, 'choice');

    await fetch(`http://localhost:${testPort}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'answered',
        comment: '',
        answers: [
          { roundId: round.roundId, id: 'q1', type: 'choice', title: 'Cache', question: 'Which store?', selected: 'Redis' },
          { roundId: round.roundId, id: round.questions[1].id, type: 'text', question: 'Any deploy constraints?', answer: 'Ship after Tuesday' },
        ],
      }),
    });

    const feedback = JSON.parse(fs.readFileSync(path.join(tmpDir, '.plan-feedback.json'), 'utf8'));
    assert.equal(feedback.status, 'answered');
    assert.equal(feedback.answers.length, 2);
    assert.equal(feedback.answers[0].selected, 'Redis');

    const feedbackMd = fs.readFileSync(path.join(tmpDir, '.plan-feedback.md'), 'utf8');
    assert.ok(feedbackMd.includes('Answers To Your Questions'));
    assert.ok(feedbackMd.includes('Ship after Tuesday'));

    const afterAnswer = await (await fetch(`http://localhost:${testPort}/api/plan`)).json();
    assert.equal(afterAnswer.agentQuestions[0].status, 'answered');
  } finally {
    if (runner && typeof runner.close === 'function') runner.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('server - stays alive after approval so execution-phase asks reuse the session', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-approve-test-'));
  const planFile = path.join(tmpDir, 'plan.md');
  fs.writeFileSync(planFile, '# Sample Plan\n', 'utf8');

  const runner = await startPlanPreviewer(planFile, {
    port: 0,
    open: false,
    silent: true,
    testMode: true,
  });

  try {
    await fetchRetry(`http://localhost:${runner.port}/api/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved', comment: '' }),
    });

    await new Promise((r) => setTimeout(r, 2200));

    const status = await (await fetchRetry(`http://localhost:${runner.port}/api/status`)).json();
    assert.equal(status.running, true);
    assert.equal(status.planApproved, true);
  } finally {
    if (runner && typeof runner.close === 'function') runner.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
