import fs from 'fs';
import path from 'path';
import { startPlanPreviewer } from './server.js';
import { parseAskFileContent, parseAskArg } from './ask-parser.js';

const args = process.argv.slice(2);
const filePath = args[0] || 'plan.md';

const options = {
  open: true,
  port: 3456,
  questions: [],
};

for (let i = 1; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--no-open') {
    options.open = false;
  } else if (arg.startsWith('--port=')) {
    options.port = parseInt(arg.split('=')[1], 10) || 3456;
  } else if (arg.startsWith('--context=')) {
    options.context = arg.split('=').slice(1).join('=');
  } else if (arg.startsWith('--agent=')) {
    options.agent = arg.split('=')[1];
  } else if (arg.startsWith('--response=')) {
    options.response = arg.split('=').slice(1).join('=');
  } else if (arg.startsWith('--response-file=')) {
    const rFile = arg.split('=').slice(1).join('=');
    try {
      if (fs.existsSync(rFile)) options.response = fs.readFileSync(rFile, 'utf8').trim();
    } catch (e) {}
  } else if (arg.startsWith('--ask=')) {
    options.questions.push(...parseAskArg(arg.split('=').slice(1).join('=')));
  } else if (arg.startsWith('--ask-file=')) {
    const aFile = arg.split('=').slice(1).join('=');
    try {
      if (fs.existsSync(aFile)) {
        options.questions.push(...parseAskFileContent(fs.readFileSync(aFile, 'utf8')));
        // Temp hand-off files from the CLI spawner are single-use.
        if (path.basename(aFile).startsWith('plan-previewer-ask-')) fs.unlinkSync(aFile);
      }
    } catch (e) {}
  }
}

startPlanPreviewer(filePath, options).catch((err) => {
  console.error(`Server runner error: ${err.message}`);
  process.exit(1);
});
