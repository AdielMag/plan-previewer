import express from 'express';
import fs from 'fs';
import path from 'path';
import open from 'open';
import pc from 'picocolors';
import { fileURLToPath } from 'url';
import { detectCallerAgent } from './detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startPlanPreviewer(filePath, options = {}) {
  const absolutePath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(absolutePath)) {
    console.error(pc.red(`Error: Target plan file does not exist at "${absolutePath}"`));
    process.exit(1);
  }

  const callerAgent = detectCallerAgent(options);
  const stats = fs.statSync(absolutePath);
  const createdAt = stats.birthtime && !isNaN(stats.birthtime.getTime()) ? stats.birthtime : stats.mtime;

  const rawInitialContent = fs.readFileSync(absolutePath, 'utf8');
  const sessionContext = options.context || extractDerivedContext(rawInitialContent, absolutePath);

  let fileVersion = 1;

  // File watcher for external edits from CLI or agent tools
  try {
    fs.watch(absolutePath, (eventType) => {
      fileVersion++;
    });
  } catch (err) {
    // Fallback if fs.watch fails on some file locks
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Serve frontend static assets from public/ directory
  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  // Heartbeat tracking for automatic shutdown when tab is closed
  let lastHeartbeat = Date.now();
  let clientConnected = false;

  setInterval(() => {
    if (clientConnected && Date.now() - lastHeartbeat > 7000) {
      console.log(pc.yellow('\nBrowser window closed. Plan previewer shutting down.'));
      process.exit(0);
    }
  }, 3000);

  app.post('/api/heartbeat', (req, res) => {
    clientConnected = true;
    lastHeartbeat = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/shutdown', (req, res) => {
    res.json({ ok: true, message: 'Server shutting down' });
    console.log(pc.yellow('\nViewer closed by user. Server shut down cleanly.'));
    setTimeout(() => process.exit(0), 200);
  });

  // GET /api/version - Fast polling for external CLI changes
  app.get('/api/version', (req, res) => {
    res.json({ fileVersion });
  });

  // GET /api/plan - Retrieve plan metadata, session context, and current content
  app.get('/api/plan', (req, res) => {
    try {
      const content = fs.readFileSync(absolutePath, 'utf8');
      const currentStats = fs.statSync(absolutePath);
      res.json({
        success: true,
        filename: path.basename(absolutePath),
        filePath: absolutePath,
        content,
        fileVersion,
        createdAt: createdAt.toISOString(),
        updatedAt: currentStats.mtime.toISOString(),
        callerAgent,
        sessionContext,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/plan - Save live edits back to markdown file
  app.post('/api/plan', (req, res) => {
    try {
      const { content } = req.body;
      if (typeof content !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid content string' });
      }
      fs.writeFileSync(absolutePath, content, 'utf8');
      fileVersion++;
      res.json({ success: true, fileVersion, updatedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/feedback - Process user comments, questions, and approval status
  app.post('/api/feedback', (req, res) => {
    try {
      const { status, comment, questions, content } = req.body;

      if (typeof content === 'string') {
        fs.writeFileSync(absolutePath, content, 'utf8');
      }

      const feedbackData = {
        timestamp: new Date().toISOString(),
        planFile: absolutePath,
        sessionContext,
        callerAgent: callerAgent.id,
        callerName: callerAgent.name,
        status: status || 'submitted',
        comment: comment || '',
        questions: Array.isArray(questions) ? questions : [],
      };

      const dir = path.dirname(absolutePath);
      const feedbackJsonPath = path.join(dir, '.plan-feedback.json');
      fs.writeFileSync(feedbackJsonPath, JSON.stringify(feedbackData, null, 2), 'utf8');

      const feedbackMdPath = path.join(dir, '.plan-feedback.md');
      const mdFeedback = generateFeedbackMarkdown(feedbackData);
      fs.writeFileSync(feedbackMdPath, mdFeedback, 'utf8');

      res.json({ success: true, message: 'Feedback transmitted back to agent successfully' });

      // Ultra token-lean terminal log output for calling agent
      const qCount = feedbackData.questions.length;
      console.log(`\n[PLAN-REVIEW]: status=${status.toUpperCase()} | comment="${comment || 'None'}" | questions=${qCount} | saved=.plan-feedback.json\n`);

      setTimeout(() => {
        process.exit(0);
      }, 3500);

    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const preferredPort = options.port || 3456;
  const server = app.listen(preferredPort, async () => {
    const port = server.address().port;
    const url = `http://localhost:${port}`;
    console.log(pc.bold(pc.cyan('\n🚀 Plan Previewer Active (Live File Sync Enabled)')));
    console.log(`${pc.bold('Target Plan:')} ${absolutePath}`);
    console.log(`${pc.bold('Caller Agent:')} ${pc.magenta(callerAgent.name)} (${callerAgent.reason})`);
    console.log(`${pc.bold('Context:')} ${pc.yellow(sessionContext)}`);
    console.log(`${pc.bold('Viewer URL:')} ${pc.underline(pc.blue(url))}\n`);

    if (options.open !== false) {
      try {
        await open(url);
      } catch (err) {
        console.log(pc.yellow(`Please open ${url} in your browser.`));
      }
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const dynamicServer = app.listen(0, async () => {
        const dynamicPort = dynamicServer.address().port;
        const url = `http://localhost:${dynamicPort}`;
        console.log(pc.bold(pc.cyan(`\n🚀 Plan Previewer Active on port ${dynamicPort}`)));
        if (options.open !== false) {
          await open(url);
        }
      });
    } else {
      console.error(pc.red(`Server error: ${err.message}`));
    }
  });
}

function extractDerivedContext(content, filePath) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match && match[1]) {
    return match[1].trim();
  }
  return `Plan file: ${path.basename(filePath)} in ${path.basename(path.dirname(filePath))}`;
}

function generateFeedbackMarkdown(data) {
  let md = `# Plan Review Feedback\n\n`;
  md += `- **Date:** ${data.timestamp}\n`;
  md += `- **Context / Task:** ${data.sessionContext}\n`;
  md += `- **Plan File:** \`${data.planFile}\` \n`;
  md += `- **Caller Agent:** ${data.callerName} (${data.callerAgent})\n`;
  md += `- **Status:** ${data.status.toUpperCase()}\n\n`;

  if (data.comment) {
    md += `## User Feedback & Comments\n\n${data.comment}\n\n`;
  }

  if (data.questions && data.questions.length > 0) {
    md += `## Questions & Section Annotations\n\n`;
    data.questions.forEach((q, i) => {
      md += `### ${i + 1}. ${q.section || 'General Note'}\n`;
      md += `${q.text}\n\n`;
    });
  }

  return md;
}

function formatStatusPill(status) {
  switch (status) {
    case 'approved':
      return pc.bgGreen(pc.black(' APPROVED '));
    case 'changes_requested':
      return pc.bgRed(pc.white(' CHANGES REQUESTED '));
    case 'questions_asked':
      return pc.bgYellow(pc.black(' QUESTIONS ASKED '));
    default:
      return pc.bgBlue(pc.white(' SUBMITTED '));
  }
}
