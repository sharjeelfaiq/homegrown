// Source -> Homegrown-1.0.0.exe, in one command: npm run build.
// Detailed child output is captured in .tmp/build-logs/; the console is a
// compact ten-stage progress view.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { RollingTail, renderOverview, renderProgress, stageDescription, stripAnsi, TOTAL_STAGES } from './build-progress.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atRoot = (...parts) => path.join(ROOT, ...parts);
const VERSION = process.env.VERSION || '1.0.0';
const STAGE_DIR = atRoot('dist', 'Homegrown');
const DIST_DIR = atRoot('dist');
const OUTPUT = path.join(DIST_DIR, `Homegrown-${VERSION}.exe`);
const ENV_LOCAL = atRoot('apps', 'studio', '.env.local');
const ENV_STASH = atRoot('.tmp', 'env.local.stash');
const TMP_DIR = atRoot('.tmp');
const LOG_DIR = atRoot('.tmp', 'build-logs');
const SEVENZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const SFX = 'C:\\Program Files\\7-Zip\\7z.sfx';
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const ENV_LOCAL_DEFAULT = '# Intentionally empty. Supported workflows use same-origin API paths.';
const START = Date.now();

export const STAGES = [
  'Removing old build files', 'Checking required tools', 'Finding the build environment',
  'Checking the app freezer', 'Running tests and checks', 'Saving local settings safely',
  'Compiling the web app', 'Creating backend.exe', 'Creating the desktop launcher',
  'Staging and packing the release',
];

class BuildError extends Error { constructor(message, details = {}) { super(message); this.details = details; } }
const die = (message, details) => { throw new BuildError(message, details); };
const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
const elapsedSeconds = () => (Date.now() - START) / 1000;
const elapsed = () => { const s = Math.floor(elapsedSeconds()); return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };
const interactive = () => Boolean(process.stdout.isTTY && process.stderr.isTTY && !process.env.CI && !process.env.BUILD_NONINTERACTIVE);

class BuildLogger {
  constructor() { fs.mkdirSync(LOG_DIR, { recursive: true }); const stamp = new Date().toISOString().replace(/[.:]/g, '-'); this.path = path.join(LOG_DIR, `build-${stamp}.log`); fs.writeFileSync(this.path, `HOMEGROWN BUILD DIAGNOSTIC LOG\nstarted: ${new Date().toISOString()}\nstages: ${TOTAL_STAGES}\n`); }
  write(text) { fs.appendFileSync(this.path, text); }
  event(text) { this.write(`\n--- ${new Date().toISOString()} | ${text} ---\n`); }
}

class Progress {
  constructor() { this.interactive = interactive(); this.completed = 0; this.current = null; this.ema = []; this.startedAt = Date.now(); this.timer = null; this.overviewShown = false; }
  nextStep() { return this.current == null ? STAGES[0] : STAGES[this.current] || 'none'; }
  width() { return Math.max(60, process.stdout.columns || 80); }
  overview() { if (this.overviewShown) return; process.stdout.write(`${renderOverview(STAGES, this.width())}\n\n`); this.overviewShown = true; }
  draw(spinner = '·') { this.overview(); const currentStep = this.current ? STAGES[this.current - 1] : 'Complete'; const text = renderProgress({ completed: this.completed, current: this.current, currentStep, currentDescription: stageDescription(currentStep), nextStep: this.nextStep(), elapsedSeconds: (Date.now() - this.startedAt) / 1000, interactive: this.interactive, spinner, width: this.width() }); process.stdout.write(text); if (!this.interactive) process.stdout.write('\n'); }
  begin(number) { this.current = number; this.overview(); if (this.interactive) { this.draw(); let i = 0; this.timer = setInterval(() => this.draw(['·', '⠙', '⠹', '⠸', '·'][++i % 5]), 800); } }
  end(number) { if (this.timer) clearInterval(this.timer); this.timer = null; const duration = (Date.now() - this.startedAt) / 1000; this.ema.push(duration / Math.max(1, number)); this.completed = number; this.current = number; if (this.interactive) { this.draw('✓'); } else { process.stdout.write(`${String(number).padStart(2, '0')}/${TOTAL_STAGES}  ✓  ${STAGES[number - 1]} — ${stageDescription(STAGES[number - 1])}  (${Math.round((number / TOTAL_STAGES) * 100)}%)\n`); } if (this.interactive && number === TOTAL_STAGES) process.stdout.write('\n'); this.current = number < TOTAL_STAGES ? number + 1 : null; }
  fail() { if (this.timer) clearInterval(this.timer); this.timer = null; if (this.interactive) { this.draw('!'); process.stdout.write('\n'); } else if (this.current) process.stdout.write(`${String(this.current).padStart(2, '0')}/${TOTAL_STAGES}  ✗  ${STAGES[this.current - 1]}\n`); }
}

let logger;
let progress;
function commandText(command, args) { return [command, ...args].join(' '); }

function run(command, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const commandLine = commandText(command, args);
  logger?.event(`RUN ${commandLine}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...spawnOptions });
    const tail = new RollingTail();
    let settled = false;
    const record = (stream, chunk) => {
      const text = chunk.toString().replace(/\r\n/g, '\n');
      const timestamp = new Date().toISOString();
      const labelled = text.split('\n').map((line) => line ? `${timestamp} ${stream.padEnd(6)} │ ${line}\n` : '').join('');
      logger?.write(labelled); tail.push(labelled);
    };
    child.stdout?.on('data', (chunk) => record('stdout', chunk));
    child.stderr?.on('data', (chunk) => record('stderr', chunk));
    child.on('error', (error) => { if (settled) return; settled = true; const details = { command: commandLine, error: error.message, tail: tail.toString() }; if (allowFailure) resolve(false); else reject(new BuildError(`${command} could not be started: ${error.message}`, details)); });
    child.on('close', (code, signal) => { if (settled) return; settled = true; const details = { command: commandLine, code, signal, tail: tail.toString() }; if (code === 0) return resolve(true); if (allowFailure) return resolve(false); reject(new BuildError(`${commandLine} exited with ${code ?? signal}`, details)); });
  });
}

const withoutInheritedNpmConfig = (env) => Object.fromEntries(Object.entries(env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')));
const runNpm = (args, options = {}) => {
  if (process.platform !== 'win32') return run(NPM, args, { ...options, env: withoutInheritedNpmConfig(options.env ?? process.env) });
  // Avoid shell:true: recent Node versions warn on every nested npm call and
  // the warning destroys the compact progress layout. cmd.exe still handles
  // the Windows npm.cmd shim without changing the command arguments.
  const command = process.env.ComSpec || 'cmd.exe';
  return run(command, ['/d', '/s', '/c', [NPM, ...args].join(' ')], { ...options, env: withoutInheritedNpmConfig(options.env ?? process.env) });
};

function restoreEnvLocal() {
  if (isFile(ENV_STASH)) { fs.mkdirSync(path.dirname(ENV_LOCAL), { recursive: true }); fs.renameSync(ENV_STASH, ENV_LOCAL); }
  else if (!isFile(ENV_LOCAL)) { fs.mkdirSync(path.dirname(ENV_LOCAL), { recursive: true }); fs.writeFileSync(ENV_LOCAL, `${ENV_LOCAL_DEFAULT}\n`); }
}
function registerExitHandlers() { process.on('exit', restoreEnvLocal); for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130)); }
async function stage(number, action) {
  progress.begin(number);
  try { await action(); progress.end(number); }
  catch (error) {
    progress.fail();
    if (error && typeof error === 'object') error.details = { ...(error.details || {}), stage: number, stageName: STAGES[number - 1] };
    throw error;
  }
}

async function main() {
  logger = new BuildLogger(); progress = new Progress(); registerExitHandlers();
  await stage(1, async () => { for (const dir of ['dist', 'services/voice-api/dist', 'services/voice-api/build', 'apps/studio/dist', 'desktop/launcher/dist', 'desktop/launcher/build']) fs.rmSync(atRoot(...dir.split('/')), { recursive: true, force: true }); });
  await stage(2, async () => {
    if (!await run('python', ['--version'], { allowFailure: true })) die('python is not on PATH.');
    if (!await runNpm(['--version'], { allowFailure: true })) die('npm is not on PATH.');
    if (!isFile(SEVENZIP)) die(`7-Zip not found at ${SEVENZIP}. Install with: winget install 7zip.7zip`);
    if (!isFile(SFX)) die(`7z.sfx not found at ${SFX}. It ships with the full 7-Zip install, not the reduced one.`);
    if (!isFile(atRoot('services', 'voice-api', 'backend.spec'))) die('services/voice-api/backend.spec is missing -- is this the repo root?');
    if (!isFile(atRoot('desktop', 'launcher', 'launcher.spec'))) die('desktop/launcher/launcher.spec is missing.');
  });
  let PY;
  await stage(3, async () => { PY = atRoot('.venv', 'Scripts', 'python.exe'); if (!isFile(PY)) PY = atRoot('.venv', 'bin', 'python'); if (!isFile(PY)) die('no virtualenv interpreter. Follow README.md: First-time setup.'); });
  await stage(4, async () => { if (!await run(PY, ['-c', 'import PyInstaller'], { allowFailure: true })) await run(PY, ['-m', 'pip', 'install', '--quiet', 'pyinstaller']); });
  await stage(5, async () => {
    for (const check of ['check_design_tokens.py', 'check_contrast.py', 'check_palette.py', 'check_orphan_css.py', 'check_desktop_port.py']) await run('python', [path.join('scripts', check)]);
    const studio = atRoot('apps', 'studio'); await runNpm(['install', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: studio }); await runNpm(['run', 'test'], { cwd: studio }); await runNpm(['run', 'lint'], { cwd: studio }); await run('python', [path.join('scripts', 'build_splash.py'), '--check']);
  });
  await stage(6, async () => { fs.mkdirSync(TMP_DIR, { recursive: true }); if (isFile(ENV_LOCAL)) fs.renameSync(ENV_LOCAL, ENV_STASH); });
  const studio = atRoot('apps', 'studio'); await stage(7, () => runNpm(['run', 'build'], { cwd: studio }));
  const freezeEnv = { ...process.env, TMP: TMP_DIR, TEMP: TMP_DIR }; await stage(8, () => run(PY, ['-m', 'PyInstaller', 'backend.spec', '--clean', '--noconfirm'], { cwd: atRoot('services', 'voice-api'), env: freezeEnv }));
  await stage(9, async () => { await run('python', [path.join('scripts', 'build_splash.py')]); await run(PY, ['-m', 'PyInstaller', 'launcher.spec', '--clean', '--noconfirm'], { cwd: atRoot('desktop', 'launcher'), env: freezeEnv }); });
  await stage(10, async () => {
    fs.rmSync(STAGE_DIR, { recursive: true, force: true }); fs.mkdirSync(STAGE_DIR, { recursive: true });
    fs.copyFileSync(atRoot('desktop', 'launcher', 'dist', 'Homegrown.exe'), path.join(STAGE_DIR, 'Homegrown.exe')); fs.cpSync(atRoot('services', 'voice-api', 'dist', 'backend'), path.join(STAGE_DIR, 'backend'), { recursive: true });
    for (const dir of [['storage', 'references'], ['storage', 'generated'], ['models']]) fs.mkdirSync(path.join(STAGE_DIR, ...dir), { recursive: true });
    if (isFile(path.join(STAGE_DIR, 'backend', '.env'))) die(`${path.relative(ROOT, STAGE_DIR)}/backend/.env exists. It carries an absolute MODEL_PATH that exists on no other machine. Delete it and re-run.`);
    if (fs.readdirSync(path.join(STAGE_DIR, 'models')).length > 0) die(`${path.relative(ROOT, STAGE_DIR)}/models is not empty. It must ship empty -- the app downloads the model on first run.`);
    if (!isFile(path.join(STAGE_DIR, 'Homegrown.exe'))) die('launcher exe missing from the staged tree.'); if (!isFile(path.join(STAGE_DIR, 'backend', 'backend.exe'))) die('backend.exe missing from the staged tree.');
    const archive = path.join(DIST_DIR, 'app.7z'); fs.rmSync(archive, { force: true }); fs.rmSync(OUTPUT, { force: true }); await run(SEVENZIP, ['a', '-t7z', '-m0=lzma2', '-mx5', '-mmt=on', 'app.7z', 'Homegrown'], { cwd: DIST_DIR });
    fs.copyFileSync(SFX, OUTPUT); await pipeline(fs.createReadStream(archive), fs.createWriteStream(OUTPUT, { flags: 'a' })); fs.rmSync(archive, { force: true }); if (!isFile(OUTPUT)) die(`packing produced no ${path.relative(ROOT, OUTPUT)}`);
  });
  const bytes = fs.statSync(OUTPUT).size; const hash = crypto.createHash('sha256'); await pipeline(fs.createReadStream(OUTPUT), hash); process.stdout.write(`\n${OUTPUT}\nsize    ${(bytes / 1024 ** 3).toFixed(1)}G\nsha256  ${hash.digest('hex')}\nbuilt   ${elapsed()}\n`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main().catch((error) => { progress?.fail(); const details = error?.details || {}; process.stderr.write(`\nBUILD FAILED: ${error instanceof BuildError ? error.message : error?.stack ?? String(error)}\n`); if (details.stage) process.stderr.write(`stage: ${details.stage}/${TOTAL_STAGES} ${details.stageName}\n`); if (details.command) process.stderr.write(`command: ${details.command}\n`); if (details.code != null || details.signal) process.stderr.write(`exit: ${details.code ?? details.signal}\n`); if (logger) process.stderr.write(`log: ${path.relative(ROOT, logger.path)}\n`); const tail = stripAnsi(details.tail || '').trim(); if (tail) process.stderr.write(`last output:\n${tail}\n`); process.exitCode = 1; });

export { BuildError, Progress, run };
