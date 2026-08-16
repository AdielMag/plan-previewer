import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import net from 'net';
import http from 'http';
import {
  normalizePlanPath,
  isSamePlanPath,
  getSessionMarkerPath,
  readSessionMarker,
  writeSessionMarker,
  clearSessionMarker,
  isPortFree,
  probeServerForPlan,
  findSessionPort,
} from '../src/session-port.js';

test('session-port - normalizePlanPath & isSamePlanPath handles relative and absolute paths', () => {
  const rel = './test-plan.md';
  const abs = path.resolve(rel);
  assert.equal(isSamePlanPath(rel, abs), true);
  assert.equal(isSamePlanPath('foo.md', 'bar.md'), false);
  assert.equal(isSamePlanPath(null, abs), false);
});

test('session-port - writes, reads, and clears plan-specific session markers', () => {
  const tempPlan = path.join(os.tmpdir(), `test-plan-${Date.now()}.md`);
  fs.writeFileSync(tempPlan, '# Test Plan\n');

  try {
    writeSessionMarker(tempPlan, 3457, 12345);

    const marker = readSessionMarker(tempPlan);
    assert.ok(marker, 'Marker should exist');
    assert.equal(marker.port, 3457);
    assert.equal(marker.pid, 12345);
    assert.equal(isSamePlanPath(marker.planFile, tempPlan), true);

    clearSessionMarker(tempPlan);
    const afterClear = readSessionMarker(tempPlan);
    assert.equal(afterClear, null);
  } finally {
    try { fs.unlinkSync(tempPlan); } catch (e) {}
    clearSessionMarker(tempPlan);
  }
});

test('session-port - isPortFree detects bound vs free ports', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const boundPort = server.address().port;

  const isBoundFree = await isPortFree(boundPort);
  assert.equal(isBoundFree, false, 'Bound port should not be free');

  await new Promise((resolve) => server.close(resolve));

  const isNowFree = await isPortFree(boundPort);
  assert.equal(isNowFree, true, 'Closed port should now be free');
});

test('session-port - probeServerForPlan differentiates between matching and non-matching plans', async () => {
  const planA = path.join(os.tmpdir(), `planA-${Date.now()}.md`);
  const planB = path.join(os.tmpdir(), `planB-${Date.now()}.md`);

  const mockServer = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, planFile: planA }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;

  try {
    const probeForA = await probeServerForPlan(mockPort, planA);
    assert.equal(probeForA.running, true);
    assert.equal(probeForA.matches, true);

    const probeForB = await probeServerForPlan(mockPort, planB);
    assert.equal(probeForB.running, true);
    assert.equal(probeForB.matches, false);
  } finally {
    await new Promise((resolve) => mockServer.close(resolve));
  }
});

test('session-port - findSessionPort allocates distinct ports for different plan files', async () => {
  const planA = path.join(os.tmpdir(), `sessionA-${Date.now()}.md`);
  const planB = path.join(os.tmpdir(), `sessionB-${Date.now()}.md`);

  // Create a mock server simulating an active session for planA on port 3490
  const testPortRange = { start: 3490, end: 3495 };

  const mockServerA = http.createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ running: true, planFile: planA }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => mockServerA.listen(3490, '127.0.0.1', resolve));

  try {
    // 1. Session for planA should match port 3490 and report existing/running: true
    const resultA = await findSessionPort(planA, null, testPortRange);
    assert.equal(resultA.port, 3490);
    assert.equal(resultA.isRunning, true);

    // 2. Session for planB should see 3490 is taken by planA and allocate the next free port (3491)
    const resultB = await findSessionPort(planB, null, testPortRange);
    assert.equal(resultB.port, 3491);
    assert.equal(resultB.isRunning, false);
  } finally {
    await new Promise((resolve) => mockServerA.close(resolve));
  }
});
