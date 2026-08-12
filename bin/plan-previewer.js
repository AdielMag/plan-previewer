#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import pc from 'picocolors';
import { startPlanPreviewer } from '../src/server.js';

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
    } else if (arg.startsWith('--context=')) {
      options.context = arg.split('=').slice(1).join('=');
    } else if (arg === '-c' || arg === '--context') {
      options.context = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      showHelp();
      process.exit(0);
    } else if (!arg.startsWith('-') && !filePath) {
      filePath = arg;
    }
  }

  // Fallbacks if no explicit plan file passed
  if (!filePath) {
    const candidates = ['plan.md', 'PLAN.md', 'task_plan.md', 'IMPLEMENTATION_PLAN.md'];
    for (const cand of candidates) {
      if (fs.existsSync(path.resolve(process.cwd(), cand))) {
        filePath = cand;
        break;
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
  --agent=<claude|antigravity>  Explicitly override caller agent auto-detection
  -p, --port=<number>           Specify local server port (default: 3456)
  --no-open                     Do not automatically open browser tab
  -h, --help                    Show this help message

${pc.bold('Examples:')}
  npx plan-previewer ./plan.md
  npx plan-previewer ./docs/PLAN.md --agent=antigravity
`);
}

async function main() {
  const { filePath, options } = parseArgs();

  if (options.action === 'install') {
    const installScript = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install-skills.js');
    await import(pathToFileURL(installScript).href);
    return;
  }

  if (!filePath) {
    console.error(pc.red('Error: No markdown plan file provided or found in directory.'));
    showHelp();
    process.exit(1);
  }

  await startPlanPreviewer(filePath, options);
}

main().catch((err) => {
  console.error(pc.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
