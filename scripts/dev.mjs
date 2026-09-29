// Start the whole app for local development, in one command.
//
//   npm run dev
//
// Backend on 127.0.0.1:8000, Vite dev server on :5173, both stopped together
// with Ctrl-C. This is deployment mode 1 of the four in CLAUDE.md.
//
// Reachable from other devices on the network: Vite binds every interface and
// proxies /api, /audio and /refs to the backend, so a phone's API calls arrive
// same-origin and come back here. Nothing to configure on the visiting device.
// The backend itself stays on loopback; the proxy reaches it from this host, so
// a wildcard bind there would buy nothing. The address to type is printed below.
//
// No --reload on uvicorn, deliberately. Loading the model takes tens of seconds
// to minutes; a watcher that restarts the process on every backend edit would
// pay that cost each time. Restart this script by hand when you change backend
// code.
//
// Output from both processes is prefixed and streamed to this terminal by
// concurrently. Nothing is written to a log file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import concurrently from 'concurrently';

// Same convention as scripts/*.py: locate the repository from this file rather
// than from the caller's working directory, so `npm run dev` works from anywhere.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORTS = [5173, 8000];

const bold = (s) => process.stdout.write(`\n\x1b[1m==> ${s}\x1b[0m\n`);
const warn = (s) => process.stdout.write(`\x1b[33m    warning: ${s}\x1b[0m\n`);
function die(message) {
  process.stderr.write(`\n\x1b[31mdev: ${message}\x1b[0m\n`);
  process.exit(1);
}

const atRoot = (...parts) => path.join(ROOT, ...parts);
const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
const isDir = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;

// ---- preflight --------------------------------------------------------------
// Each of these fails later in a way that does not name its own cause, so they
// are checked up front rather than left to surface as a stack trace or a
// silently broken API call.
bold('Preflight');

let python = atRoot('.venv', 'Scripts', 'python.exe');
if (!isFile(python)) python = atRoot('.venv', 'bin', 'python');
if (!isFile(python)) {
  die('no virtualenv interpreter. Follow README.md: First-time setup (create .venv and install Python dependencies).');
}

const backendEnvPath = atRoot('services', 'voice-api', '.env');
if (!isFile(backendEnvPath)) {
  die('services/voice-api/.env is missing. Copy services/voice-api/.env.example and set MODEL_PATH; see README.md: First-time setup.');
}
const backendEnv = fs.readFileSync(backendEnvPath, 'utf8');
if (!/^MODEL_PATH=.+/m.test(backendEnv)) {
  die('services/voice-api/.env has no MODEL_PATH. Set it to your downloaded model folder; see README.md: First-time setup.');
}

// ALLOWED_ORIGINS only matters for requests a browser sends straight to the
// backend. Through the dev proxy they arrive from Vite instead, server-side,
// and CORS never applies.
if (!/^ALLOWED_ORIGINS=.*127\.0\.0\.1:5173/m.test(backendEnv)) {
  warn('services/voice-api/.env ALLOWED_ORIGINS does not list http://127.0.0.1:5173 --');
  warn('harmless while the dev proxy is in use, but not if something bypasses it.');
}

if (!isDir(atRoot('apps', 'studio', 'node_modules'))) {
  die('apps/studio/node_modules is missing. Run: npm install --prefix apps/studio');
}

console.log('    venv, services/voice-api/.env and node_modules all present.');

// apps/studio/dist only matters here as a footgun: the backend registers its SPA
// catch-all when dist exists, so :8000 will serve a *built* copy of the app
// that is not the one you are editing. Say so rather than let it confuse.
if (isDir(atRoot('apps', 'studio', 'dist'))) {
  warn('apps/studio/dist exists -- :8000 serves that stale build. Edit against :5173.');
}

// ---- start ------------------------------------------------------------------
// 127.0.0.1, not 0.0.0.0, even though reaching this from other devices is a goal
// of this script. Nothing off-host talks to :8000 -- Vite proxies to it from
// here -- so a wildcard bind would buy nothing and cost a second Windows
// Defender Firewall prompt, this one on python.exe. Clicking Cancel on one of
// those writes a permanent Block rule for that exe path, which nothing in the
// app can undo. One prompt (Node, for :5173) is enough.
bold('Backend   http://127.0.0.1:8000   (loading the model, this takes a while)');
bold('Frontend  http://localhost:5173');

const { result, commands } = concurrently(
  [
    {
      name: 'backend',
      prefixColor: 'blue',
      cwd: atRoot('services', 'voice-api'),
      command: `"${python}" -m uvicorn main:app --host 127.0.0.1 --port 8000`,
    },
    {
      name: 'studio',
      prefixColor: 'green',
      cwd: atRoot('apps', 'studio'),
      command: 'npm run dev',
    },
  ],
  {
    // Either process dying tears the other down, rather than leaving half the
    // stack running and looking healthy.
    killOthersOn: ['success', 'failure'],
    killSignal: 'SIGTERM',
  },
);

// The address to type on a phone or another laptop. Filtered, not listed: this
// machine also carries a Hyper-V vEthernet 172.28.x.x that no other device can
// reach, and printing both invites picking the wrong one.
const lanAddress = Object.entries(os.networkInterfaces())
  .filter(([name]) => !/vEthernet|Loopback/i.test(name))
  .flatMap(([, addrs]) => addrs ?? [])
  .find((a) => a.family === 'IPv4' && !a.internal)?.address;
if (lanAddress) {
  bold(`On your network   http://${lanAddress}:5173`);
  console.log('    Anyone who can reach that address has the whole app -- there is no sign-in.');
  console.log('    Windows may ask to allow Node.js through the firewall; allow it.');
}

// ---- readiness --------------------------------------------------------------
// The frontend is usable in under a second; the backend is not. Without this,
// the first thing you see is the app's "model not ready" state and no
// indication of whether that is normal or a failed load.
let readinessTimer = null;
async function pollHealth() {
  readinessTimer = null;
  let body;
  try {
    const res = await fetch('http://127.0.0.1:8000/api/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) body = await res.json();
  } catch {
    // Not up yet, or still loading the model. Both are normal here.
  }
  if (body?.model_loaded === true) {
    const device = body.device ?? 'unknown';
    process.stdout.write(`\n\x1b[1m==> model ready on ${device} -- open http://localhost:5173\x1b[0m\n`);
    if (device === 'cpu') {
      process.stdout.write('\x1b[33m    CPU fallback: generation will take many minutes per chunk.\x1b[0m\n');
    }
    return;
  }
  // unref so this poller alone never holds the process open.
  readinessTimer = setTimeout(pollHealth, 2000).unref();
}
pollHealth();

const backend = commands.find((c) => c.name === 'backend');
backend.close.subscribe(() => {
  if (readinessTimer) clearTimeout(readinessTimer);
  process.stdout.write('\n\x1b[31m==> backend exited -- see the [backend] output above\x1b[0m\n');
});

// ---- shutdown ---------------------------------------------------------------
// Killing the concurrently command alone is not enough on Windows: `npm run dev`
// is a cmd shim that spawns node as a separate process, so killing the shim
// orphans the server and leaves :5173 bound. A sweep of both ports takes the
// whole tree. Ctrl-C in a console already delivers CTRL_C_EVENT to the process
// group, so this is a backstop, not the primary path -- but it is the backstop
// that stops :5173 surviving a teardown.
function sweepPorts() {
  if (process.platform !== 'win32') return;
  let table;
  try {
    table = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
  } catch {
    return;
  }
  const pids = new Set();
  for (const line of table.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5 || cols[3] !== 'LISTENING') continue;
    const port = Number(cols[1].split(':').pop());
    if (!PORTS.includes(port)) continue;
    const pid = Number(cols[4]);
    if (pid > 0 && pid !== process.pid) pids.add(pid);
  }
  for (const pid of pids) {
    try {
      // Single slash: spawned straight from Node, not through Git Bash, which is
      // why the old dev.sh had to write these as //F //T //PID.
      execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } catch {
      // Already gone between the netstat and the kill. Nothing to do.
    }
  }
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (readinessTimer) clearTimeout(readinessTimer);
  bold('stopping');
  for (const command of commands) {
    try {
      command.kill();
    } catch {
      // Already exited.
    }
  }
  // Give the direct children a moment to die before sweeping, so the sweep only
  // has to deal with genuine orphans.
  setTimeout(() => {
    sweepPorts();
    process.exit(code);
  }, 500);
}

process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

result.then(
  () => shutdown(0),
  () => {
    bold('one process exited -- shutting the other down');
    shutdown(1);
  },
);
