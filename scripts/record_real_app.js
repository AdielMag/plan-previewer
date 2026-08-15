import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { startPlanPreviewer } from '../src/server.js';

async function recordRealApp() {
  const samplePlanPath = path.resolve(process.cwd(), 'scratch', 'sample_plan.md');
  const framesDir = path.resolve(process.cwd(), 'scratch', 'real_frames');
  
  if (!fs.existsSync(samplePlanPath)) {
    fs.mkdirSync(path.dirname(samplePlanPath), { recursive: true });
  }

  const samplePlanContent = `# Rate Limiting Architecture for API Gateway

> [!NOTE]
> This plan implements distributed rate limiting at the gateway layer to protect downstream microservices from traffic spikes while guaranteeing low latency.

## Architecture Overview

\`\`\`mermaid
graph LR
    Client[API Clients] --> Gateway[API Gateway]
    Gateway --> Limiter{Token Bucket Check}
    Limiter -->|Allowed| Services[Internal Services]
    Limiter -->|Exceeded| 429[429 Too Many Requests]
\`\`\`

> [!CHOICE] Rate Limiting Algorithm Strategy
> **Question**: Which algorithm best balances burst handling with memory efficiency?
> - (x) **Option A**: Token Bucket (Allows controlled burst traffic while enforcing long-term rate) [Recommended]
> - ( ) **Option B**: Sliding Window Counter (Smoother traffic distribution, slightly higher memory)
> - ( ) **Option C**: Fixed Window (Minimal CPU & memory overhead, potential edge-burst issues)

> [!QUESTION] Cluster Replication Requirement
> **Question**: Should rate limits be synchronized globally across multi-region edge gateways or evaluated per region?

## Implementation Plan

### 1. Core Middleware [HIGH RISK]
- [x] Add rate limiter middleware in \`gateway/middleware/ratelimit.go\` [MODIFY]
- [ ] Implement Redis token bucket script with Lua for atomic decrements [NEW]
- [ ] Return \`429\` with \`Retry-After\` and \`X-RateLimit-Remaining\` headers

### 2. Observability & Dashboard [LOW RISK]
- [ ] Emit \`gateway.ratelimit.rejected\` metric tagged by client ID
- [ ] Add rate limiting panel to the Grafana dashboard
`;

  fs.writeFileSync(samplePlanPath, samplePlanContent, 'utf8');

  if (fs.existsSync(framesDir)) {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(framesDir, { recursive: true });

  console.log('Starting Plan Previewer server on port 3456...');
  const runner = await startPlanPreviewer(samplePlanPath, {
    port: 3456,
    open: false,
    silent: true,
    context: 'Rate Limiting Architecture for API Gateway',
    agent: 'pi',
    response: 'Configured Token Bucket algorithm and added distributed Redis Lua script.'
  });

  await new Promise((resolve) => setTimeout(resolve, 800));

  console.log('Launching Google Chrome in 1080p High Resolution...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1.5 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3456', { waitUntil: 'networkidle0' });

  let frameIdx = 0;
  async function captureFrames(count = 15, delayMs = 65) {
    for (let i = 0; i < count; i++) {
      const framePath = path.join(framesDir, `frame_${String(frameIdx).padStart(4, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });
      frameIdx++;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  console.log('Frame set 1: Initial plan preview with Choice Cards and Mermaid diagram...');
  await captureFrames(24);

  console.log('Frame set 2: Selecting Option A on the interactive Choice Card...');
  await page.click('.choice-option-item');
  await captureFrames(20);

  console.log('Frame set 3: Demonstrating Width Switcher (Wide 75% -> Full Width)...');
  await page.click('.width-btn[data-width="full"]');
  await captureFrames(16);
  await page.click('.width-btn[data-width="wide"]');
  await captureFrames(14);

  console.log('Frame set 4: Selecting text in document to open floating annotation popover...');
  await page.evaluate(() => {
    const el = document.querySelector('.md-body p');
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      
      const event = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
        clientX: 620,
        clientY: 380
      });
      document.getElementById('docScrollArea').dispatchEvent(event);
    }
  });
  await captureFrames(14);

  console.log('Frame set 5: Typing annotation question in floating popover...');
  await page.type('#popoverInput', 'Should we include local memory cache fallback if Redis latency spikes?');
  await captureFrames(12);

  console.log('Frame set 6: Submitting annotation note to Activity feed...');
  await page.evaluate(() => {
    const btn = document.getElementById('btnPopoverAsk');
    if (btn) btn.click();
  });
  await captureFrames(18);

  console.log('Frame set 7: Typing overall comments in footer bar...');
  await page.type('#footerComment', 'Architecture looks excellent. Approved to proceed!');
  await captureFrames(12);

  console.log('Frame set 8: Clicking Approve Plan button...');
  await page.evaluate(() => {
    const btn = document.getElementById('btnApprovePlan');
    if (btn) btn.click();
  });

  console.log('Frame set 9: Holding on Plan Approved Modal...');
  await captureFrames(36);

  await browser.close();
  if (runner && runner.close) runner.close();

  console.log(`Captured ${frameIdx} high-resolution frames in ${framesDir}`);

  const docsDir = path.resolve(process.cwd(), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const mp4Path = path.join(docsDir, 'plan_previewer_demo_v3.mp4');
  const gifPath = path.join(docsDir, 'plan_previewer_demo_v3.gif');

  console.log('Compiling 1080p HD video walkthrough (plan_previewer_demo_v3.mp4)...');
  const ffmpegMp4 = `ffmpeg -y -r 15 -i "${framesDir}\\frame_%04d.png" -c:v libx264 -crf 18 -pix_fmt yuv420p "${mp4Path}"`;
  execSync(ffmpegMp4, { stdio: 'inherit' });

  console.log('Compiling High Resolution animated GIF (plan_previewer_demo_v3.gif)...');
  const ffmpegGif = `ffmpeg -y -r 15 -i "${framesDir}\\frame_%04d.png" -vf "scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gifPath}"`;
  execSync(ffmpegGif, { stdio: 'inherit' });

  console.log(`DONE! Updated demo assets created at:\n  - ${mp4Path}\n  - ${gifPath}`);
  process.exit(0);
}

recordRealApp().catch((err) => {
  console.error('Error recording real app:', err);
  process.exit(1);
});
