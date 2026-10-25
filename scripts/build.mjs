// Source -> Homegrown-1.0.0.exe, in one command: npm run build.
// Detailed child output is captured in .tmp/build-logs/; the console is a
// compact ten-stage progress view.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_STAGE_ETAS, RollingTail, formatDuration, renderOverview, renderOverviewLine, renderProgress, stageDescription, TOTAL_STAGES } from './build/progress.mjs';
import { renderBuildSummary } from './build/summary.mjs';

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
const START = performance.now();
const BUILD_OUTPUTS = ['dist', 'services/voice-api/dist', 'services/voice-api/build', 'apps/studio/dist', 'desktop/launcher/dist', 'desktop/launcher/build'];
const CLEANUP_RETRIES = 6;
const CLEANUP_RETRY_DELAY_MS = 250;

export const STAGES = [
  'Removing old build files', 'Checking required tools', 'Finding the build environment',
  'Checking the app freezer', 'Running tests and checks', 'Saving local settings safely',
  'Compiling the web app', 'Creating backend.exe', 'Creating the desktop launcher',
  'Staging and packing the release',
];

class BuildError extends Error { constructor(message, details = {}) { super(message); this.details = details; } }
const die = (message, details) => { throw new BuildError(message, details); };
const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
const elapsedSeconds = () => (performance.now() - START) / 1000;
const elapsed = () => { const s = Math.floor(elapsedSeconds()); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };
const interactive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY && !process.env.CI && !process.env.BUILD_NONINTERACTIVE);
const colorSummary = () => interactive() && !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0';

class BuildLogger {
  constructor() { fs.mkdirSync(LOG_DIR, { recursive: true }); const stamp = new Date().toISOString().replace(/[.:]/g, '-'); this.path = path.join(LOG_DIR, `build-${stamp}.log`); fs.writeFileSync(this.path, `HOMEGROWN BUILD DIAGNOSTIC LOG\nstarted: ${new Date().toISOString()}\nstages: ${TOTAL_STAGES}\n`); }
  write(text) { fs.appendFileSync(this.path, text); }
  event(text) { this.write(`\n--- ${new Date().toISOString()} | ${text} ---\n`); }
}

class Progress {
  constructor(buildLogger) {
    this.logger = buildLogger;
    this.interactive = interactive();
    this.completed = 0;
    this.current = null;
    this.startedAt = performance.now();
    this.timer = null;
    this.overviewShown = false;
    this.dashboardShown = false;
    this.activeStageRendered = null;
    this.nonInteractiveProgressWidth = 0;
    this.timings = Array.from({ length: TOTAL_STAGES }, (_, index) => ({ durationSeconds: null, etaSeconds: DEFAULT_STAGE_ETAS[index] }));
  }
  nextStep() { return this.current == null ? STAGES[0] : STAGES[this.current] || 'none'; }
  width() { return Math.max(40, Math.min(120, process.stdout.columns || 80)); }
  overview(active = this.current) { if (this.overviewShown) return; const highlighted = this.interactive ? active : null; process.stdout.write(`${renderOverview(STAGES, this.width(), highlighted, this.timings)}\n\n`); this.overviewShown = true; }
  refreshActiveStage() {
    if (!this.interactive || !this.dashboardShown || this.activeStageRendered === this.current) return;
    const width = this.width();
    const progressRows = width < 105 ? 2 : 1;
    const bottomToStage = (stage) => TOTAL_STAGES + 1 + progressRows - 1 - (stage - 1);
    const update = (stage, active) => `\x1b[s\x1b[${bottomToStage(stage)}A\x1b[2K\r${renderOverviewLine(STAGES[stage - 1], stage - 1, width, active, this.timings[stage - 1])}\x1b[u`;
    let output = '';
    if (this.activeStageRendered) output += update(this.activeStageRendered, null);
    if (this.current) output += update(this.current, this.current);
    process.stdout.write(output);
    this.activeStageRendered = this.current;
  }
  draw(spinner = '·') {
    const currentStep = this.current ? STAGES[this.current - 1] : 'Complete';
    const text = renderProgress({ completed: this.completed, current: this.current, currentStep, currentDescription: stageDescription(currentStep), nextStep: this.nextStep(), elapsedSeconds: (performance.now() - this.startedAt) / 1000, interactive: this.interactive, spinner, width: this.width(), redraw: false });
    if (!this.interactive) {
      this.overview();
      this.nonInteractiveProgressWidth = Math.max(this.nonInteractiveProgressWidth, text.length);
      process.stdout.write(`\r${text.padEnd(this.nonInteractiveProgressWidth)}`);
      return;
    }
    this.refreshActiveStage();
    const prefix = this.dashboardShown
      ? (this.width() < 105 ? '\x1b[1A' : '\x1b[2K\r')
      : `${renderOverview(STAGES, this.width(), this.current, this.timings)}\n\n`;
    process.stdout.write(`${prefix}${text}`);
    this.dashboardShown = true;
    this.activeStageRendered = this.current;
  }
  begin(number) {
    this.current = number;
    const timing = this.timings[number - 1];
    timing.startedAt = performance.now();
    timing.startedAtIso = new Date().toISOString();
    const hasMeasuredDuration = Number.isFinite(timing.durationSeconds);
    const preStage = hasMeasuredDuration ? formatDuration(timing.durationSeconds) : formatDuration(timing.etaSeconds);
    this.logger?.event(JSON.stringify({ event: 'stage-start', stage: number, stageName: STAGES[number - 1], preStageEta: preStage, etaSource: hasMeasuredDuration ? 'measured' : 'baseline', cumulativeElapsedSeconds: (timing.startedAt - this.startedAt) / 1000 }));
    if (!this.interactive) { this.overview(); this.draw(); }
    if (this.interactive) { this.draw(); let i = 0; this.timer = setInterval(() => this.draw(['·', '⠙', '⠹', '⠸', '·'][++i % 5]), 800); }
  }
  end(number) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const timing = this.timings[number - 1];
    const completedAt = performance.now();
    timing.completedAt = completedAt;
    timing.completedAtIso = new Date().toISOString();
    timing.durationSeconds = (completedAt - timing.startedAt) / 1000;
    timing.cumulativeElapsedSeconds = (completedAt - this.startedAt) / 1000;
    this.logger?.event(JSON.stringify({ event: 'stage-complete', stage: number, stageName: STAGES[number - 1], durationSeconds: timing.durationSeconds, cumulativeElapsedSeconds: timing.cumulativeElapsedSeconds }));
    this.completed = number;
    this.current = number;
    this.draw('✓');
    if (number === TOTAL_STAGES) process.stdout.write('\n');
    this.current = number < TOTAL_STAGES ? number + 1 : null;
  }
  fail() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) {
      const timing = this.timings[this.current - 1];
      const failedAt = performance.now();
      timing.durationSeconds = (failedAt - timing.startedAt) / 1000;
      timing.cumulativeElapsedSeconds = (failedAt - this.startedAt) / 1000;
      timing.completedAt = failedAt;
      timing.completedAtIso = new Date().toISOString();
      this.logger?.event(JSON.stringify({ event: 'stage-failed', stage: this.current, stageName: STAGES[this.current - 1], durationSeconds: timing.durationSeconds, cumulativeElapsedSeconds: timing.cumulativeElapsedSeconds }));
    }
    if (this.interactive) { this.draw('!'); process.stdout.write('\n'); } else if (this.current) { this.draw('!'); process.stdout.write('\n'); }
  }
  summary() { return this.timings.map((timing, index) => ({ stage: index + 1, stageName: STAGES[index], startedAt: timing.startedAtIso ?? null, completedAt: timing.completedAtIso ?? null, durationSeconds: timing.durationSeconds, cumulativeElapsedSeconds: timing.cumulativeElapsedSeconds ?? null, preStageEta: formatDuration(Number.isFinite(timing.durationSeconds) ? timing.durationSeconds : timing.etaSeconds), etaSource: Number.isFinite(timing.durationSeconds) ? 'measured' : 'baseline' })); }
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

function removeBuildOutputs() {
  for (const output of BUILD_OUTPUTS) {
    const target = atRoot(...output.split('/'));
    try {
      fs.rmSync(target, {
        recursive: true,
        force: true,
        maxRetries: CLEANUP_RETRIES,
        retryDelay: CLEANUP_RETRY_DELAY_MS,
      });
    } catch (error) {
      if (['EACCES', 'EBUSY', 'EPERM'].includes(error?.code)) {
        throw new BuildError(
          `Could not remove old build output ${output} (${error.code}). Close Homegrown and any process using files in that folder, then check its permissions and retry.`,
          { path: output, code: error.code },
        );
      }
      throw error;
    }
  }
}

function registerExitHandlers() {
  process.on('exit', restoreEnvLocal);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    progress?.fail();
    if (logger && progress) logger.event(`TIMING_SUMMARY ${JSON.stringify(progress.summary())}`);
    const logPath = logger ? path.relative(ROOT, logger.path).split(path.sep).join('/') : 'unavailable';
    process.stderr.write(`\n${renderBuildSummary({
      status: 'cancelled',
      duration: elapsed(),
      fields: [{ label: 'Log', value: logPath, accent: Boolean(logger) }],
      color: colorSummary(),
    })}`);
    process.exit(130);
  });
}
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
  logger = new BuildLogger(); progress = new Progress(logger); registerExitHandlers();
  await stage(1, removeBuildOutputs);
  await stage(2, async () => {
    if (!await run('python', ['--version'], { allowFailure: true })) die('python is not on PATH.');
    if (!await runNpm(['--version'], { allowFailure: true })) die('npm is not on PATH.');
    if (!isFile(SEVENZIP)) die(`7-Zip not found at ${SEVENZIP}. Install with: winget install 7zip.7zip`);
    if (!isFile(SFX)) die(`7z.sfx not found at ${SFX}. It ships with the full 7-Zip install, not the reduced one.`);
    if (!isFile(atRoot('services', 'voice-api', 'backend.spec'))) die('services/voice-api/backend.spec is missing -- is this the repo root?');
    if (!isFile(atRoot('desktop', 'launcher', 'launcher.spec'))) die('desktop/launcher/launcher.spec is missing.');
  });
  let PY;
  await stage(3, async () => {
    PY = atRoot('.venv', 'Scripts', 'python.exe');
    if (!isFile(PY)) PY = atRoot('.venv', 'bin', 'python');
    if (!isFile(PY)) die('no virtualenv interpreter. Follow README.md: First-time setup.');
    // Windows venv launchers can remain after their base Python is removed.
    // Probe before treating an import failure as a missing build dependency.
    try { await run(PY, ['-c', 'import sys; print(sys.executable)']); }
    catch (error) {
      throw new BuildError('The .venv interpreter cannot run. Its base Python may have been removed or the environment moved. Restore that Python installation or recreate .venv and reinstall services/voice-api/requirements.txt. See README.md: Repairing a broken Python environment.', error.details);
    }
  });
  await stage(4, async () => { if (!await run(PY, ['-c', 'import PyInstaller'], { allowFailure: true })) await run(PY, ['-m', 'pip', 'install', '--quiet', 'pyinstaller']); });
  await stage(5, async () => {
    for (const check of ['check_design_tokens.py', 'check_contrast.py', 'check_palette.py', 'check_orphan_css.py', 'check_desktop_port.py']) await run('python', [path.join('scripts', 'checks', check)]);
    const studio = atRoot('apps', 'studio'); await runNpm(['install', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: studio }); await runNpm(['run', 'test'], { cwd: studio }); await runNpm(['run', 'lint'], { cwd: studio }); await run('python', [path.join('scripts', 'build', 'build_splash.py'), '--check']);
  });
  await stage(6, async () => { fs.mkdirSync(TMP_DIR, { recursive: true }); if (isFile(ENV_LOCAL)) fs.renameSync(ENV_LOCAL, ENV_STASH); });
  const studio = atRoot('apps', 'studio'); await stage(7, () => runNpm(['run', 'build'], { cwd: studio }));
  const freezeEnv = { ...process.env, TMP: TMP_DIR, TEMP: TMP_DIR }; await stage(8, () => run(PY, ['-m', 'PyInstaller', 'backend.spec', '--clean', '--noconfirm'], { cwd: atRoot('services', 'voice-api'), env: freezeEnv }));
  await stage(9, async () => { await run('python', [path.join('scripts', 'build', 'build_splash.py')]); await run(PY, ['-m', 'PyInstaller', 'launcher.spec', '--clean', '--noconfirm'], { cwd: atRoot('desktop', 'launcher'), env: freezeEnv }); });
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
  const bytes = fs.statSync(OUTPUT).size;
  const timingSummary = progress.summary();
  logger.event(`TIMING_SUMMARY ${JSON.stringify(timingSummary)}`);
  const installerPath = path.resolve(OUTPUT);
  const installerDirectoryUrl = pathToFileURL(`${DIST_DIR}${path.sep}`).href;
  process.stdout.write(`\n${renderBuildSummary({
    status: 'success',
    duration: elapsed(),
    fields: [
      { label: 'Installer', value: installerPath, accent: true, href: installerDirectoryUrl },
      { label: 'Size', value: `${(bytes / 1024 ** 3).toFixed(1)} GB` },
    ],
    color: colorSummary(),
    hyperlinks: interactive(),
  })}`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main().catch((error) => {
  const details = error?.details || {};
  if (!details.stage) progress?.fail();
  if (logger && progress) logger.event(`TIMING_SUMMARY ${JSON.stringify(progress.summary())}`);

  const errorMessage = error instanceof Error ? error.message : String(error);
  const genericCommandFailure = details.command && (
    errorMessage === `${details.command} exited with ${details.code ?? details.signal}` ||
    errorMessage.startsWith(`${details.command} could not be started:`)
  );
  const message = genericCommandFailure
    ? `A build command failed${details.code != null ? ` with exit code ${details.code}` : details.signal ? ` (${details.signal})` : ''}.`
    : errorMessage.replace(/\s+/g, ' ').slice(0, 280);
  const stageNumber = details.stage ?? progress?.current;
  const stage = stageNumber
    ? `${String(stageNumber).padStart(2, '0')}/${TOTAL_STAGES} - ${details.stageName ?? STAGES[stageNumber - 1]}`
    : 'Finalizing build output';
  const logPath = logger ? path.relative(ROOT, logger.path).split(path.sep).join('/') : 'unavailable';
  process.stderr.write(`\n${renderBuildSummary({
    status: 'failure',
    duration: elapsed(),
    fields: [
      { label: 'Stage', value: stage },
      { label: 'Issue', value: message },
      { label: 'Log', value: logPath, accent: Boolean(logger) },
    ],
    color: colorSummary(),
  })}`);
  process.exitCode = 1;
});

export { BuildError, Progress, run };
