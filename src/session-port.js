import fs from 'fs';
import path from 'path';
import net from 'net';
import http from 'http';

/**
 * Normalizes a plan file path for cross-platform comparison.
 * On Windows, path comparisons are case-insensitive.
 */
export function normalizePlanPath(p) {
  if (!p) return '';
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Checks if two paths point to the same plan file.
 */
export function isSamePlanPath(path1, path2) {
  if (!path1 || !path2) return false;
  return normalizePlanPath(path1) === normalizePlanPath(path2);
}

/**
 * Generates the session marker file path for a specific plan file.
 * Placed in the plan's directory so it's co-located with the plan and .plan-feedback.json.
 */
export function getSessionMarkerPath(planFilePath) {
  const resolved = path.resolve(planFilePath);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved);
  return path.join(dir, `.plan-previewer-${base}.session.json`);
}

/**
 * Reads the active session marker for a plan file if it exists.
 */
export function readSessionMarker(planFilePath) {
  try {
    const specificPath = getSessionMarkerPath(planFilePath);
    if (fs.existsSync(specificPath)) {
      const data = JSON.parse(fs.readFileSync(specificPath, 'utf8'));
      if (data && data.port) return data;
    }
    // Fallback to legacy marker path in directory
    const legacyPath = path.join(path.dirname(path.resolve(planFilePath)), '.plan-previewer-session.json');
    if (fs.existsSync(legacyPath)) {
      const data = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
      if (data && data.port && data.planFile && isSamePlanPath(data.planFile, planFilePath)) {
        return data;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Writes the active session marker file for a plan file.
 */
export function writeSessionMarker(planFilePath, port, pid = process.pid) {
  try {
    const markerPath = getSessionMarkerPath(planFilePath);
    const data = {
      pid,
      port,
      planFile: path.resolve(planFilePath),
      startTime: new Date().toISOString(),
    };
    fs.writeFileSync(markerPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

/**
 * Clears the session marker file for a plan file upon shutdown.
 */
export function clearSessionMarker(planFilePath) {
  try {
    const markerPath = getSessionMarkerPath(planFilePath);
    if (fs.existsSync(markerPath)) {
      fs.unlinkSync(markerPath);
    }
    const legacyPath = path.join(path.dirname(path.resolve(planFilePath)), '.plan-previewer-session.json');
    if (fs.existsSync(legacyPath)) {
      try {
        const legacyData = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
        if (legacyData.planFile && isSamePlanPath(legacyData.planFile, planFilePath)) {
          fs.unlinkSync(legacyPath);
        }
      } catch (e) {}
    }
  } catch (e) {}
}

/**
 * Checks if a TCP port is free to bind on localhost.
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    if (!port || port <= 0) return resolve(true);
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Probes an HTTP port to see if a plan-previewer server is running on it,
 * and if so, whether it is serving the target plan file.
 */
export function probeServerForPlan(port, targetPlanPath, timeoutMs = 600) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://localhost:${port}/api/status`,
      { agent: false, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data && data.running === true) {
              const matches = targetPlanPath ? isSamePlanPath(data.planFile, targetPlanPath) : true;
              resolve({ running: true, matches, port, planFile: data.planFile, data });
              return;
            }
          } catch (e) {}
          resolve({ running: false, matches: false, port });
        });
      }
    );
    req.on('error', () => resolve({ running: false, matches: false, port }));
    req.on('timeout', () => { req.destroy(); resolve({ running: false, matches: false, port }); });
  });
}

/**
 * Finds the appropriate port for a session:
 * 1. If explicitPort is given, checks if it's running or free.
 * 2. Checks marker file for this plan.
 * 3. Scans port range (default: 3456..3499) for an existing server serving this plan.
 * 4. If no server for this plan is found, scans for the first completely free port.
 */
export async function findSessionPort(targetPlanPath, explicitPort = null, portRange = { start: 3456, end: 3499 }) {
  const resolvedPath = path.resolve(targetPlanPath);

  // Explicit port override via CLI flag
  if (explicitPort) {
    const probe = await probeServerForPlan(explicitPort, resolvedPath);
    if (probe.running && probe.matches) {
      return { port: explicitPort, isRunning: true, existing: true };
    }
    const free = await isPortFree(explicitPort);
    return { port: explicitPort, isRunning: false, existing: false, isFree: free };
  }

  // 1. Check marker file
  const marker = readSessionMarker(resolvedPath);
  if (marker && marker.port) {
    const probe = await probeServerForPlan(marker.port, resolvedPath);
    if (probe.running && probe.matches) {
      return { port: marker.port, isRunning: true, existing: true };
    }
  }

  // 2. Scan for existing running server matching this plan file
  for (let p = portRange.start; p <= portRange.end; p++) {
    const probe = await probeServerForPlan(p, resolvedPath, 300);
    if (probe.running && probe.matches) {
      return { port: p, isRunning: true, existing: true };
    }
  }

  // 3. Find first completely free port in the range
  for (let p = portRange.start; p <= portRange.end; p++) {
    const probe = await probeServerForPlan(p, resolvedPath, 150);
    if (!probe.running) {
      const free = await isPortFree(p);
      if (free) {
        return { port: p, isRunning: false, existing: false };
      }
    }
  }

  // Fallback to 0 (dynamic port)
  return { port: 0, isRunning: false, existing: false };
}
