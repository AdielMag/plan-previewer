#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import pc from 'picocolors';
import { resolveWaitTimeoutSec } from '../src/wait-timeout.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// A stale lock older than this is assumed to belong to a crashed/killed
// spawner and is safe to reclaim, so a bad lock can never wedge things.
const SPAWN_LOCK_STALE_MS = 15000;

function spawnLockPath(port) {
  return path.join(os.tmpdir(), `plan-previewer-spawn-${port}.lock`);
}

// Two `npx plan-previewer` invocations started close together can both probe
// the port before either daemon has bound it, both conclude "not running",
// and both spawn their own detached server - the second then hits
// EADDRINUSE, falls back to a random port, and opens a second, unrelated
// browser tab. This lock ensures only one invocation spawns; the other waits
// and reconnects to the winner's daemon instead of starting its own.
function tryAcquireSpawnLock(port) {
  const lockPath = spawnLockPath(port);
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') return true; // Unexpected error - don't block startup on it.
    try {
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age > SPAWN_LOCK_STALE_MS) {
        fs.unlinkSync(lockPath);
        return tryAcquireSpawnLock(port);
      }
    } catch (e) {}
    return false;
  }
}

function releaseSpawnLock(port) {
  try { fs.unlinkSync(spawnLockPath(port)); } catch (e) {}
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    open: true,
    port: 3456,
    agent: null,
  };

  let filePath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === 'install' || arg === 'skills' || arg === 'install-skills') {
      options.action = 'install';
      break;
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg.startsWith('--port=')) {
      options.port = parseInt(arg.split('=')[1], 10) || 3456;
    } else if (arg === '-p' || arg === '--port') {
      options.port = parseInt(args[++i], 10) || 3456;
    } else if (arg.startsWith('--agent=')) {
      options.agent = arg.split('=')[1];
    } else if (arg.startsWith('--wait-timeout=')) {
      const seconds = parseInt(arg.split('=')[1], 10);
      if (!isNaN(seconds) && seconds > 0) options.waitTimeoutMs = seconds * 1000;
    } else if (arg.startsWith('--context=')) {
      options.context = arg.split('=').slice(1).join('=');
    } else if (arg === '-c' || arg === '--context') {
      options.context = args[++i];
    } else if (arg.startsWith('--response=')) {
      options.response = arg.split('=').slice(1).join('=');
    } else if (arg === '-r' || arg === '--response') {
      options.response = args[++i];
    } else if (arg.startsWith('--response-file=')) {
      const rFile = arg.split('=').slice(1).join('=');
      try {
        if (fs.existsSync(rFile)) options.response = fs.readFileSync(rFile, 'utf8').trim();
      } catch (e) {}
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    }
  }

  if (!filePath) {
    const candidates = ['plan.md', 'PLAN.md', 'task_plan.md', 'IMPLEMENTATION_PLAN.md'];
    for (const cand of candidates) {
      if (fs.existsSync(path.resolve(process.cwd(), cand))) {
        filePath = cand;
        break;
      }
    }
  }

  // Automatic pickup of .plan-response.md if --response was not explicitly set
  if (!options.response) {
    const planDir = filePath ? path.dirname(path.resolve(process.cwd(), filePath)) : process.cwd();
    const autoResponseFiles = [
      path.join(planDir, '.plan-response.md'),
      path.join(process.cwd(), '.plan-response.md'),
    ];
    for (const rf of autoResponseFiles) {
      if (fs.existsSync(rf)) {
        try {
          const text = fs.readFileSync(rf, 'utf8').trim();
          if (text) {
            options.response = text;
            break;
          }
        } catch (e) {}
      }
    }
  }

  return { filePath, options };
}

function showHelp() {
  console.log(`
${pc.bold(pc.cyan('Plan Previewer'))} - Interactive Web Visual Markdown Plan Viewer & Feedback System

${pc.bold('Usage:')}
  npx plan-previewer [path-to-plan.md] [options]

${pc.bold('Options:')}
  --agent=<claude|antigravity|pi>  Explicitly override caller agent auto-detection
  -p, --port=<number>           Specify local server port (default: 3456)
  --wait-timeout=<seconds>      Max time to wait for a decision before exiting.
                                Default: 240 under Pi CLI (its bash tool has no
                                timeout, so an unbounded wait would hang the turn);
                                otherwise waits until the harness's own timeout.
  -r, --response="<summary>"    Explain changes made in response to user requests
  --response-file="<path>"      Read change response notes from a markdown file
  --no-open                     Do not automatically open browser tab
  -h, --help                    Show this help message
`);
}

function probeServerRunningNative(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/status`, { agent: false, timeout: 800 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data && data.running === true);
        } catch (e) {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// A single 800ms probe can false-negative under momentary system load (e.g. two
// Node processes starting up close together), which used to cause a spurious
// second server to be spawned. Retry a couple of times before giving up.
async function isServerRunningNative(port, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    if (await probeServerRunningNative(port)) return true;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function waitForFeedbackNative(port, timeoutSec, planFile) {
  return new Promise((resolve) => {
    const query = `timeout=${timeoutSec}&planFile=${encodeURIComponent(planFile)}`;
    const req = http.get(
      `http://localhost:${port}/api/wait-feedback?${query}`,
      { agent: false },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
  });
}

function spawnDetachedServer(filePath, options) {
  const serverModule = path.join(__dirname, '..', 'src', 'server-runner.js');
  const args = [serverModule, filePath];
  if (options.port) args.push(`--port=${options.port}`);
  if (options.context) args.push(`--context=${options.context}`);
  if (options.agent) args.push(`--agent=${options.agent}`);
  if (options.response) args.push(`--response=${options.response}`);
  if (options.open === false) args.push('--no-open');

  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    // Without this, Windows pops a visible console window for the detached
    // child even though stdio is ignored - and each spawn (including ones
    // the spawn lock now prevents from racing) flashed one open.
    windowsHide: true,
  });
  child.unref();
}

async function main() {
  const { filePath, options } = parseArgs();

  if (options.action === 'install') {
    const installScript = path.join(__dirname, '..', 'scripts', 'install-skills.js');
    await import(pathToFileURL(installScript).href);
    return;
  }

  if (!filePath) {
    console.error(pc.red('Error: No markdown plan file provided or found in directory.'));
    showHelp();
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  const port = options.port || 3456;

  let running = await isServerRunningNative(port);
  const wasAlreadyRunning = running;

  if (!running) {
    const isSpawner = tryAcquireSpawnLock(port);
    if (isSpawner) spawnDetachedServer(filePath, options);
    // A cold `npx` invocation can take well over 4s to resolve/install deps and
    // bind the port, especially on Windows. Give it a longer bounded window
    // (~12s) before giving up, so we don't falsely report a startup failure
    // while the detached daemon is actually still coming up in the background.
    try {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 200));
        running = await probeServerRunningNative(port);
        if (running) break;
      }
    } finally {
      if (isSpawner) releaseSpawnLock(port);
    }
  }

  if (running) {
    try {
      await fetch(`http://localhost:${port}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: absolutePath,
          context: options.context,
          agent: options.agent,
          response: options.response,
          // If we just spawned this server ourselves, its own startup sequence
          // already opens the browser tab - opening again here would duplicate it.
          open: wasAlreadyRunning ? options.open : false,
        }),
      });
      console.log(pc.bold(pc.cyan(`\n🚀 Plan Previewer Connected (Server active on port ${port})`)));
      console.log(`${pc.bold('Target Plan:')} ${absolutePath}\n`);
    } catch (err) {}

    const timeoutSec = resolveWaitTimeoutSec(options);
    const data = await waitForFeedbackNative(port, timeoutSec, absolutePath);

    if (data && data.feedback) {
      const fb = data.feedback;
      console.log(
        `\n[PLAN-REVIEW]: status=${fb.status.toUpperCase()} | comment="${fb.comment || 'None'}" | saved=.plan-feedback.json\n`
      );
    } else {
      console.log(
        pc.yellow(
          `\nPlan previewer wait timeout completed after ${timeoutSec}s - no decision submitted yet.` +
            '\nThis is normal: re-run the exact same command to keep waiting (the open browser tab reconnects).'
        )
      );
    }

    try { fs.closeSync(1); } catch (e) {}
    try { fs.closeSync(2); } catch (e) {}
    process.exit(0);
  } else {
    console.error(pc.red('Failed to start persistent Plan Previewer server daemon.'));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(pc.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
