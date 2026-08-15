import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pc from 'picocolors';
import openBrowser from 'open';
import { detectCallerAgent } from './detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_MARKER_FILE = path.join(process.cwd(), '.plan-previewer-session.json');

function writeActiveSessionMarker(planFilePath, port) {
  try {
    const data = {
      pid: process.pid,
      port,
      planFile: planFilePath,
      startTime: new Date().toISOString(),
    };
    fs.writeFileSync(SESSION_MARKER_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {}
}

function clearActiveSessionMarker() {
  try {
    if (fs.existsSync(SESSION_MARKER_FILE)) {
      fs.unlinkSync(SESSION_MARKER_FILE);
    }
  } catch (err) {}
}

/**
 * Starts the Plan Previewer HTTP Server and opens browser.
 * @param {string} filePath Relative or absolute path to markdown plan file.
 * @param {object} options CLI options (port, open, agent, context, response)
 */
export async function startPlanPreviewer(filePath, options = {}) {
  let currentPlanPath = path.resolve(process.cwd(), filePath);

  if (!fs.existsSync(currentPlanPath)) {
    console.error(pc.red(`Error: Target plan file does not exist at "${currentPlanPath}"`));
    process.exit(1);
  }

  let callerAgent = detectCallerAgent(options);
  const stats = fs.statSync(currentPlanPath);
  const createdAt = stats.birthtime && !isNaN(stats.birthtime.getTime()) ? stats.birthtime : stats.mtime;

  const rawInitialContent = fs.readFileSync(currentPlanPath, 'utf8');
  let sessionContext = options.context || extractDerivedContext(rawInitialContent, currentPlanPath);
  let agentResponses = options.response
    ? [{ text: options.response.trim(), timestamp: new Date().toISOString(), fileVersion: 1 }]
    : [];

  let fileVersion = 1;
  let selfWriteUntil = 0;
  let server = null;
  let activeWatcher = null;
  const activeSockets = new Set();
  let pendingFeedbackWaiters = [];
  let tabOpened = false;

  function trackSockets(srv) {
    if (!srv) return;
    srv.on('connection', (socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
    });
  }

  function writePlanFile(newContent) {
    selfWriteUntil = Date.now() + 300;
    fs.writeFileSync(currentPlanPath, newContent, 'utf8');
  }

  function attachWatcher(targetPath) {
    if (activeWatcher) {
      try { activeWatcher.close(); } catch (e) {}
      activeWatcher = null;
    }
    try {
      activeWatcher = fs.watch(targetPath, () => {
        if (Date.now() < selfWriteUntil) return;
        fileVersion++;
      });
    } catch (err) {}
  }

  attachWatcher(currentPlanPath);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const publicDir = path.join(__dirname, '..', 'public');
  app.use(express.static(publicDir));

  let lastHeartbeat = Date.now();
  let clientConnected = false;
  let exited = false;
  let pendingShutdownTimer = null;
  let idleInterval = null;

  function exitOnce(reason) {
    if (exited) return;
    exited = true;
    if (pendingShutdownTimer) clearTimeout(pendingShutdownTimer);
    if (idleInterval) clearInterval(idleInterval);
    if (activeWatcher) {
      try { activeWatcher.close(); } catch (e) {}
      activeWatcher = null;
    }
    clearActiveSessionMarker();

    const waiters = [...pendingFeedbackWaiters];
    pendingFeedbackWaiters = [];
    waiters.forEach((waiter) => {
      clearTimeout(waiter.timer);
      try { waiter.res.json({ success: true, timeout: true, exit: true }); } catch (e) {}
    });

    if (reason && !options.silent) console.log(reason);

    for (const socket of activeSockets) {
      try { socket.destroy(); } catch (e) {}
    }
    activeSockets.clear();

    if (server) {
      try { server.close(); } catch (e) {}
    }

    if (!options.testMode) {
      setTimeout(() => {
        try { fs.closeSync(1); } catch (e) {}
        try { fs.closeSync(2); } catch (e) {}
        process.exit(0);
      }, 200);
    }
  }

  function scheduleShutdown(reason, delayMs = 1500) {
    if (exited) return;
    if (pendingShutdownTimer) clearTimeout(pendingShutdownTimer);
    pendingShutdownTimer = setTimeout(() => {
      exitOnce(reason);
    }, delayMs);
  }

  function cancelPendingShutdown() {
    if (pendingShutdownTimer) {
      clearTimeout(pendingShutdownTimer);
      pendingShutdownTimer = null;
    }
  }

  app.use((req, res, next) => {
    cancelPendingShutdown();
    next();
  });

  idleInterval = setInterval(() => {
    if (clientConnected && Date.now() - lastHeartbeat > 600000) {
      exitOnce(pc.yellow('\nPlan previewer idle timeout completed. Shutting down.'));
    }
  }, 15000);

  // Status check endpoint for CLI single-instance verification
  app.get('/api/status', (req, res) => {
    res.json({
      success: true,
      running: true,
      port: preferredPort,
      pid: process.pid,
      planFile: currentPlanPath,
      sessionContext,
      callerAgent,
      fileVersion,
      agentResponses,
    });
  });

  // Notify endpoint for CLI callers to update plan file without starting duplicate server
  app.post('/api/notify', (req, res) => {
    const { filePath, context, agent, response, open: shouldOpen } = req.body;
    if (filePath) {
      currentPlanPath = path.resolve(process.cwd(), filePath);
      attachWatcher(currentPlanPath);
    }
    if (context) sessionContext = context;
    if (agent) callerAgent = detectCallerAgent({ agent });
    if (response && typeof response === 'string' && response.trim()) {
      agentResponses.push({
        text: response.trim(),
        timestamp: new Date().toISOString(),
        fileVersion: fileVersion + 1,
      });
    }
    fileVersion++;
    writeActiveSessionMarker(currentPlanPath, preferredPort);

    if (shouldOpen !== false && preferredPort && !tabOpened) {
      tabOpened = true;
      try { openBrowser(`http://localhost:${preferredPort}`); } catch (e) {}
    }

    res.json({ success: true, fileVersion, planFile: currentPlanPath });
  });

  // Long-polling feedback wait endpoint for CLI callers
  app.get('/api/wait-feedback', (req, res) => {
    const planFile = req.query.planFile ? path.resolve(req.query.planFile) : null;
    const waiter = { res, timer: null, planFile };
    const timeoutMs = parseInt(req.query.timeout, 10) * 1000 || 240000;

    waiter.timer = setTimeout(() => {
      const idx = pendingFeedbackWaiters.indexOf(waiter);
      if (idx !== -1) pendingFeedbackWaiters.splice(idx, 1);
      try {
        res.json({ success: true, timeout: true });
      } catch (e) {}
    }, timeoutMs);

    pendingFeedbackWaiters.push(waiter);
  });

  app.post('/api/heartbeat', (req, res) => {
    clientConnected = true;
    lastHeartbeat = Date.now();
    res.json({ ok: true });
  });

  app.post('/api/shutdown', (req, res) => {
    res.json({ ok: true, message: 'Server scheduling shutdown' });
    scheduleShutdown(pc.yellow('\nViewer closed by user. Server shut down cleanly.'), 1500);
  });

  app.get('/api/version', (req, res) => {
    res.json({ fileVersion });
  });

  app.get('/api/plan', (req, res) => {
    try {
      const content = fs.existsSync(currentPlanPath) ? fs.readFileSync(currentPlanPath, 'utf8') : '';
      const currentStats = fs.existsSync(currentPlanPath) ? fs.statSync(currentPlanPath) : { mtime: new Date() };
      res.json({
        success: true,
        filename: path.basename(currentPlanPath),
        filePath: currentPlanPath,
        content,
        fileVersion,
        createdAt: createdAt.toISOString(),
        updatedAt: currentStats.mtime.toISOString(),
        callerAgent,
        sessionContext,
        agentResponses,
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/plan', (req, res) => {
    try {
      const { content } = req.body;
      if (typeof content !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid content string' });
      }
      writePlanFile(content);
      fileVersion++;
      res.json({ success: true, fileVersion, updatedAt: new Date().toISOString() });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/feedback', (req, res) => {
    try {
      const { status, comment, questions, choices, content } = req.body;

      if (typeof content === 'string') {
        writePlanFile(content);
        fileVersion++;
      }

      const feedbackData = {
        timestamp: new Date().toISOString(),
        planFile: currentPlanPath,
        sessionContext,
        callerAgent: callerAgent.id,
        callerName: callerAgent.name,
        status: status || 'submitted',
        comment: comment || '',
        questions: Array.isArray(questions) ? questions : [],
        choices: Array.isArray(choices) ? choices : [],
      };

      const dir = path.dirname(currentPlanPath);
      const feedbackJsonPath = path.join(dir, '.plan-feedback.json');
      fs.writeFileSync(feedbackJsonPath, JSON.stringify(feedbackData, null, 2), 'utf8');

      const feedbackMdPath = path.join(dir, '.plan-feedback.md');
      const mdFeedback = generateFeedbackMarkdown(feedbackData);
      fs.writeFileSync(feedbackMdPath, mdFeedback, 'utf8');

      res.json({ success: true, fileVersion, message: 'Feedback transmitted back to agent successfully' });

      const [matching, remaining] = pendingFeedbackWaiters.reduce(
        (acc, waiter) => {
          acc[!waiter.planFile || waiter.planFile === currentPlanPath ? 0 : 1].push(waiter);
          return acc;
        },
        [[], []]
      );
      pendingFeedbackWaiters = remaining;
      matching.forEach((waiter) => {
        clearTimeout(waiter.timer);
        try {
          waiter.res.json({ success: true, timeout: false, feedback: feedbackData });
        } catch (e) {}
      });

      const qCount = feedbackData.questions.length;
      const cCount = feedbackData.choices.length;
      console.log(`\n[PLAN-REVIEW]: status=${status.toUpperCase()} | comment="${comment || 'None'}" | questions=${qCount} | choices=${cCount} | saved=.plan-feedback.json\n`);

      if (status === 'approved') {
        scheduleShutdown(pc.green('Plan approved by user. Server shutting down.'), 1500);
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  const preferredPort = options.port || 3456;

  return new Promise((resolve, reject) => {
    server = app.listen(preferredPort, async () => {
      trackSockets(server);
      const port = server.address().port;
      const url = `http://localhost:${port}`;
      if (!options.silent) {
        console.log(pc.bold(pc.cyan('\n Plan Previewer Daemon Active')));
        console.log(`${pc.bold('Target Plan:')} ${currentPlanPath}`);
        console.log(`${pc.bold('Caller Agent:')} ${pc.magenta(callerAgent.name)} (${callerAgent.reason})`);
        console.log(`${pc.bold('Viewer URL:')} ${pc.underline(pc.blue(url))}\n`);
      }

      writeActiveSessionMarker(currentPlanPath, port);

      if (options.open !== false) {
        tabOpened = true;
        try {
          await openBrowser(url);
        } catch (err) {
          console.log(pc.yellow(`Please open ${url} in your browser.`));
        }
      }

      resolve({
        server,
        app,
        port,
        close: () => exitOnce('Clean test close'),
      });
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        server = app.listen(0, async () => {
          trackSockets(server);
          const dynamicPort = server.address().port;
          const url = `http://localhost:${dynamicPort}`;
          if (!options.silent) {
            console.log(pc.bold(pc.cyan(`\n Plan Previewer Daemon Active on port ${dynamicPort}`)));
          }
          writeActiveSessionMarker(currentPlanPath, dynamicPort);
          if (options.open !== false) {
            tabOpened = true;
            try { await openBrowser(url); } catch (e) {}
          }
          resolve({
            server,
            app,
            port: dynamicPort,
            close: () => exitOnce('Clean test close'),
          });
        });
      } else {
        if (!options.silent) console.error(pc.red(`Server error: ${err.message}`));
        reject(err);
      }
    });
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

  if (data.choices && data.choices.length > 0) {
    md += `## Design Choices & Selected Options\n\n`;
    data.choices.forEach((c, i) => {
      md += `### ${i + 1}. ${c.title || 'Choice'}\n`;
      if (c.selected) md += `- **Selected Option:** ${c.selected}\n`;
      if (c.answer) md += `- **User Answer:** ${c.answer}\n`;
      md += `\n`;
    });
  }

  if (data.questions && data.questions.length > 0) {
    md += `## Section Questions & Annotations\n\n`;
    data.questions.forEach((q, i) => {
      md += `### Question ${i + 1}\n`;
      if (q.section) md += `> ${q.section}\n\n`;
      md += `**Question:** ${q.text}\n\n`;
    });
  }

  return md;
}
