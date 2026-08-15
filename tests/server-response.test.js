import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { startPlanPreviewer } from '../src/server.js';

test('server - records and exposes agent response summaries', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-resp-test-'));
  const planFile = path.join(tmpDir, 'plan.md');
  fs.writeFileSync(planFile, '# Sample Plan\n\n- [ ] Step 1\n', 'utf8');

  const runner = await startPlanPreviewer(planFile, {
    port: 0, // Ephemeral port to avoid collisions
    open: false,
    silent: true,
    testMode: true,
    context: 'Test response session',
  });

  const testPort = runner.port;

  try {
    // 1. Initial plan fetch
    const res1 = await fetch(`http://localhost:${testPort}/api/plan`);
    const data1 = await res1.json();
    assert.equal(data1.success, true);
    assert.deepEqual(data1.agentResponses, []);

    // 2. Notify with agent response note
    const notifyRes = await fetch(`http://localhost:${testPort}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: planFile,
        response: 'Added Redis caching and updated database schema per requested changes.',
      }),
    });
    const notifyData = await notifyRes.json();
    assert.equal(notifyData.success, true);

    // 3. Plan fetch after response
    const res2 = await fetch(`http://localhost:${testPort}/api/plan`);
    const data2 = await res2.json();
    assert.equal(data2.success, true);
    assert.equal(data2.agentResponses.length, 1);
    assert.equal(
      data2.agentResponses[0].text,
      'Added Redis caching and updated database schema per requested changes.'
    );
  } finally {
    if (runner && typeof runner.close === 'function') {
      runner.close();
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
