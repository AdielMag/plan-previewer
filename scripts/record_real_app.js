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
    fs.writeFileSync(samplePlanPath, `# Add rate limiting to the API gateway

**Goal:** Prevent a single client from overwhelming downstream services by enforcing per-route request limits at the gateway.

## Context

- Auth middleware already exists at \`gateway/middleware/auth.go\` — limiter will sit just before it in the chain.

## Plan

### 1. Token bucket middleware

- [x] Add \`RateLimiter\` middleware in \`gateway/middleware/ratelimit.go\`
- [ ] Support per-route limits via config (\`routes.yaml\`)
- [ ] Return \`429\` with a \`Retry-After\` header on rejection

### 2. Observability

- [ ] Emit a \`gateway.ratelimit.rejected\` metric, tagged by route
- [ ] Add a panel to the gateway Grafana dashboard
`, 'utf8');
  }

  if (fs.existsSync(framesDir)) {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
  fs.mkdirSync(framesDir, { recursive: true });

  console.log('🚀 Starting Plan Previewer server...');
  startPlanPreviewer(samplePlanPath, {
    port: 3456,
    open: false,
    context: 'Add rate limiting to the API gateway',
    agent: 'claude'
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log('🌐 Launching Google Chrome in 1080p High Resolution...');
  const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 }
  });

  const page = await browser.newPage();
  await page.goto('http://localhost:3456', { waitUntil: 'networkidle0' });

  let frameIdx = 0;
  async function captureFrames(count = 15) {
    for (let i = 0; i < count; i++) {
      const framePath = path.join(framesDir, `frame_${String(frameIdx).padStart(4, '0')}.png`);
      await page.screenshot({ path: framePath, type: 'png' });
      frameIdx++;
      await new Promise((r) => setTimeout(r, 65));
    }
  }

  console.log('📸 1080p Frame set 1: Initial plan preview rendering...');
  await captureFrames(20);

  console.log('📸 1080p Frame set 2: Highlighting text in document...');
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
        clientX: 600,
        clientY: 360
      });
      document.getElementById('docScrollArea').dispatchEvent(event);
    }
  });
  await captureFrames(15);

  console.log('📸 1080p Frame set 3: Typing question into floating popover...');
  await page.type('#popoverInput', 'Should we add Redis fallback counter for replicas?');
  await captureFrames(12);

  console.log('📸 1080p Frame set 4: Submitting question to add sidebar card...');
  await page.click('#btnPopoverAsk');
  await captureFrames(18);

  console.log('📸 1080p Frame set 5: Typing overall comment in footer...');
  await page.type('#footerComment', 'Plan looks solid and well structured!');
  await captureFrames(12);

  console.log('📸 1080p Frame set 6: Hovering & clicking Approve Plan button...');
  await page.click('#btnApprovePlan');

  console.log('📸 1080p Frame set 7: Holding on Feedback Sent Modal (50 frames / ~3.3s)...');
  await captureFrames(50);

  // Close browser immediately without trailing frames
  await browser.close();

  console.log(`✅ Captured ${frameIdx} high resolution frames in ${framesDir}`);

  const docsDir = path.resolve(process.cwd(), 'docs');
  fs.mkdirSync(docsDir, { recursive: true });

  const mp4Path = path.join(docsDir, 'plan_previewer_demo_v3.mp4');
  const gifPath = path.join(docsDir, 'plan_previewer_demo_v3.gif');

  console.log('🎬 Compiling 1080p HD video walkthrough (plan_previewer_demo_v3.mp4)...');
  const ffmpegMp4 = `ffmpeg -y -r 15 -i "${framesDir}\\frame_%04d.png" -c:v libx264 -crf 18 -pix_fmt yuv420p "${mp4Path}"`;
  execSync(ffmpegMp4, { stdio: 'inherit' });

  console.log('🖼️ Compiling High Resolution animated GIF (plan_previewer_demo_v3.gif)...');
  const ffmpegGif = `ffmpeg -y -r 15 -i "${framesDir}\\frame_%04d.png" -vf "scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" "${gifPath}"`;
  execSync(ffmpegGif, { stdio: 'inherit' });

  console.log(`✨ DONE! Real 1080p video created at:\n  - ${mp4Path}\n  - ${gifPath}`);
  process.exit(0);
}

recordRealApp().catch((err) => {
  console.error('Error recording real app:', err);
  process.exit(1);
});
