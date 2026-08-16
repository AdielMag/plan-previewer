import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { startPlanPreviewer } from '../src/server.js';
import { findSessionPort, readSessionMarker } from '../src/session-port.js';

test('multi-session - concurrent sessions on isolated ports do not clobber each other', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-test-'));
  const planA = path.join(tmpDir, 'planA.md');
  const planB = path.join(tmpDir, 'planB.md');

  fs.writeFileSync(planA, '# Plan A\nContent of Plan A\n');
  fs.writeFileSync(planB, '# Plan B\nContent of Plan B\n');

  let sessionA = null;
  let sessionB = null;

  try {
    // 1. Find port and start session A
    const portInfoA = await findSessionPort(planA, null, { start: 3550, end: 3560 });
    sessionA = await startPlanPreviewer(planA, {
      port: portInfoA.port,
      open: false,
      silent: true,
      testMode: true,
    });

    // Verify session A marker was written
    const markerA = readSessionMarker(planA);
    assert.ok(markerA);
    assert.equal(markerA.port, sessionA.port);

    // 2. Find port and start session B concurrently
    const portInfoB = await findSessionPort(planB, null, { start: 3550, end: 3560 });
    assert.notEqual(portInfoB.port, sessionA.port, 'Session B must get a different port than Session A');

    sessionB = await startPlanPreviewer(planB, {
      port: portInfoB.port,
      open: false,
      silent: true,
      testMode: true,
    });

    const markerB = readSessionMarker(planB);
    assert.ok(markerB);
    assert.equal(markerB.port, sessionB.port);

    // 3. Query /api/plan on both servers
    const getPlan = (port) =>
      new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}/api/plan`, (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve(JSON.parse(body)));
        }).on('error', reject);
      });

    const dataA = await getPlan(sessionA.port);
    const dataB = await getPlan(sessionB.port);

    assert.equal(dataA.filename, 'planA.md');
    assert.ok(dataA.content.includes('Content of Plan A'));

    assert.equal(dataB.filename, 'planB.md');
    assert.ok(dataB.content.includes('Content of Plan B'));

    // 4. Send feedback to Session A only
    const sendFeedback = (port, fb) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          `http://localhost:${port}/api/feedback`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve(JSON.parse(body)));
          }
        );
        req.on('error', reject);
        req.write(JSON.stringify(fb));
        req.end();
      });

    const fbResA = await sendFeedback(sessionA.port, {
      status: 'approved',
      comment: 'Approved plan A',
    });
    assert.equal(fbResA.success, true);

    // Check that Plan A feedback file was written
    const feedbackPathA = path.join(tmpDir, '.plan-feedback.json');
    assert.ok(fs.existsSync(feedbackPathA));
    const writtenFbA = JSON.parse(fs.readFileSync(feedbackPathA, 'utf8'));
    assert.equal(writtenFbA.comment, 'Approved plan A');
    assert.equal(writtenFbA.status, 'approved');

    // Verify Session B was untouched
    const dataBAfterA = await getPlan(sessionB.port);
    assert.equal(dataBAfterA.filename, 'planB.md');
    assert.ok(dataBAfterA.content.includes('Content of Plan B'));
  } finally {
    if (sessionA) sessionA.close();
    if (sessionB) sessionB.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {}
  }
});
