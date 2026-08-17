#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import pc from 'picocolors';
import { resolveWaitTimeoutSec } from '../src/wait-timeout.js';
import { findSessionPort, probeServerForPlan } from '../src/session-port.js';
import { parseAskArg, parseAskFileContent } from '../src/ask-parser.js';

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
    port: null,
    agent: null,
    questions: [],
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
      options.port = parseInt(arg.split('=')[1], 10);
    } else if (arg === '-p' || arg === '--port') {
      options.port = parseInt(args[++i], 10);
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
    } else if (arg.startsWith('--ask=')) {
      options.questions.push(...parseAskArg(arg.split('=').slice(1).join('=')));
    } else if (arg === '--ask') {
      options.questions.push(...parseAskArg(args[++i]));
    } else if (arg.startsWith('--ask-file=')) {
      const aFile = arg.split('=').slice(1).join('=');
      try {
        if (fs.existsSync(aFile)) options.questions.push(...parseAskFileContent(fs.readFileSync(aFile, 'utf8')));
      } catch (e) {}
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

  // Automatic pickup of .plan-questions.json (consumed after ingest, so the
  // same questions are never asked twice).
  if (options.questions.length === 0) {
    const planDir = filePath ? path.dirname(path.resolve(process.cwd(), filePath)) : process.cwd();
    const autoAskFiles = [
      path.join(planDir, '.plan-questions.json'),
      path.join(planDir, '.plan-questions.md'),
      path.join(process.cwd(), '.plan-questions.json'),
    ];
    for (const af of autoAskFiles) {
      if (fs.existsSync(af)) {
        try {
          const parsed = parseAskFileContent(fs.readFileSync(af, 'utf8'));
          if (parsed.length) {
            options.questions = parsed;
            options.consumedAskFile = af;
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
  --ask="<question>"            Ask the user a question INSIDE the previewer tab
                                (repeatable). Never ask in chat/CLI during review.
  --ask-file="<path>"           Read questions from JSON or markdown
                                ([!QUESTION]/[!CHOICE] blocks). A
                                .plan-questions.json next to the plan is picked
                                up automatically and consumed.
  --no-open                     Do not automatically open browser tab
  -h, --help                    Show this help message
`);
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
  if (options.questions && options.questions.length) {
    // Arrays don't survive argv cleanly - hand them over via a temp file.
    try {
      const tmpAsk = path.join(os.tmpdir(), `plan-previewer-ask-${process.pid}.json`);
      fs.writeFileSync(tmpAsk, JSON.stringify(options.questions), 'utf8');
      args.push(`--ask-file=${tmpAsk}`);
    } catch (e) {}
  }
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
  const sessionInfo = await findSessionPort(absolutePath, options.port);
  const port = sessionInfo.port || 3456;

  let running = sessionInfo.isRunning;
  const wasAlreadyRunning = running;
  let spawnedByUs = false;

  if (!running) {
    const isSpawner = tryAcquireSpawnLock(port);
    spawnedByUs = isSpawner;
    if (isSpawner) spawnDetachedServer(filePath, { ...options, port });
    // A cold `npx` invocation can take well over 4s to resolve/install deps and
    // bind the port, especially on Windows. Give it a longer bounded window
    // (~12s) before giving up, so we don't falsely report a startup failure
    // while the detached daemon is actually still coming up in the background.
    try {
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 200));
        const probe = await probeServerForPlan(port, absolutePath);
        if (probe.running) {
          running = true;
          break;
        }
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
          // The daemon we just spawned already seeded these from --ask-file;
          // re-sending them here would ask the user the same thing twice.
          questions: spawnedByUs ? [] : options.questions,
          // Only the initial spawner of a new server opens the browser tab.
          // Reconnects / notify calls must never reopen browser tabs.
          open: false,
        }),
      });
      console.log(pc.bold(pc.cyan(`\n🚀 Plan Previewer Connected (Server active on port ${port})`)));
      console.log(`${pc.bold('Target Plan:')} ${absolutePath}\n`);
      if (options.questions.length) {
        console.log(
          pc.magenta(
            `Sent ${options.questions.length} question(s) to the previewer tab. ` +
              'Waiting for the user to answer them there (do NOT ask in chat).\n'
          )
        );
        if (options.consumedAskFile) {
          try { fs.unlinkSync(options.consumedAskFile); } catch (e) {}
        }
      }
    } catch (err) {}

    const timeoutSec = resolveWaitTimeoutSec(options);
    const data = await waitForFeedbackNative(port, timeoutSec, absolutePath);

    if (data && data.feedback) {
      const fb = data.feedback;
      console.log(
        `\n[PLAN-REVIEW]: status=${fb.status.toUpperCase()} | comment="${fb.comment || 'None'}" | saved=.plan-feedback.json\n`
      );
      if (Array.isArray(fb.answers) && fb.answers.length) {
        console.log(pc.bold(pc.magenta('[PLAN-ANSWERS]: user answered your questions in the previewer:')));
        fb.answers.forEach((a, i) => {
          const value = a.selected || a.answer || '(skipped)';
          console.log(`  ${i + 1}. ${a.question || a.title || a.id} -> ${value}`);
        });
        console.log('');
      }
    } else if (data && (data.closed || data.exit)) {
      console.log(
        pc.yellow(
          `\n[PLAN-REVIEW]: Plan previewer was closed by the user without submitting changes.\n` +
            `Review dismissed. To view the plan again, run: npx plan-previewer ${filePath}\n`
        )
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
