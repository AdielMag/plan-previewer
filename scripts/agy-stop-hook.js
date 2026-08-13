import fs from 'fs';
import os from 'os';
import path from 'path';

const ACTIVE_SESSION_MARKER = path.join(os.homedir(), '.plan-previewer', 'active-session.json');

async function main() {
  // Drain stdin (Antigravity sends the Stop payload here); we don't need its
  // contents since the feedback file location comes from our own marker, not
  // from the reported workspacePaths (which don't reliably match where the
  // plan file / .plan-feedback.json actually live).
  for await (const _chunk of process.stdin) {
    // no-op
  }

  if (!fs.existsSync(ACTIVE_SESSION_MARKER)) {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }

  let marker;
  try {
    marker = JSON.parse(fs.readFileSync(ACTIVE_SESSION_MARKER, 'utf8'));
  } catch (e) {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }

  const feedbackFile = marker.feedbackJsonPath;
  if (!feedbackFile) {
    console.log(JSON.stringify({ decision: 'allow' }));
    return;
  }

  let initialMtime = 0;
  if (fs.existsSync(feedbackFile)) {
    initialMtime = fs.statSync(feedbackFile).mtimeMs;
    try {
      const fbData = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
      if (fbData.status === 'approved' || fbData._processed) {
        console.log(JSON.stringify({ decision: 'allow' }));
        return;
      }

      // Feedback was ALREADY submitted by the user (changes_requested /
      // questions_asked) before this Stop even fired - resume immediately.
      if (
        fbData.status === 'changes_requested' ||
        fbData.status === 'questions_asked' ||
        fbData.status === 'submitted'
      ) {
        fbData._processed = true;
        fs.writeFileSync(feedbackFile, JSON.stringify(fbData, null, 2), 'utf8');
        console.log(
          JSON.stringify({
            decision: 'continue',
            reason: `User submitted plan review feedback: status=${fbData.status.toUpperCase()}. Comment: "${fbData.comment || 'None'}". Please inspect .plan-feedback.json and act on it immediately.`,
          })
        );
        return;
      }
    } catch (e) {}
  }

  const startTime = Date.now();
  const timeoutMs = 240 * 1000;

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));

    if (fs.existsSync(feedbackFile)) {
      const currentMtime = fs.statSync(feedbackFile).mtimeMs;
      if (currentMtime > initialMtime) {
        try {
          const fbData = JSON.parse(fs.readFileSync(feedbackFile, 'utf8'));
          if (fbData.status !== 'waiting' && !fbData._processed) {
            fbData._processed = true;
            fs.writeFileSync(feedbackFile, JSON.stringify(fbData, null, 2), 'utf8');

            console.log(
              JSON.stringify({
                decision: 'continue',
                reason: `User submitted plan review feedback: status=${fbData.status.toUpperCase()}. Comment: "${fbData.comment || 'None'}". Please inspect .plan-feedback.json and act on it immediately.`,
              })
            );
            return;
          }
        } catch (e) {}
      }
    }
  }

  console.log(JSON.stringify({ decision: 'allow' }));
}

main().catch(() => {
  console.log(JSON.stringify({ decision: 'allow' }));
});
