// Source -> Homegrown-1.0.0.exe, in one command.
//
//   npm run build
//
// Runs everything documented in docs/BUILD.md. Expect ~45 minutes and ~10 GB
// free on this drive.
//
// apps/studio/.env.local is stashed before the Studio build and restored from a
// process-exit handler, so it survives a failure, Ctrl-C, or clean build.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// Same convention as scripts/*.py: locate the repository from this file rather
// than from the caller's working directory.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const atRoot = (...parts) => path.join(ROOT, ...parts);

const VERSION = process.env.VERSION || '1.0.0';
const STAGE_DIR = atRoot('dist', 'Homegrown');
const DIST_DIR = atRoot('dist');
const OUTPUT = path.join(DIST_DIR, `Homegrown-${VERSION}.exe`);
const ENV_LOCAL = atRoot('apps', 'studio', '.env.local');
const ENV_STASH = atRoot('.tmp', 'env.local.stash');
const TMP_DIR = atRoot('.tmp');
const SEVENZIP = 'C:\\Program Files\\7-Zip\\7z.exe';
const SFX = 'C:\\Program Files\\7-Zip\\7z.sfx';
// npm is a .cmd shim on Windows, and since Node 18.20/20.12 spawning a .cmd
// without a shell fails with EINVAL. Every npm call therefore goes through
// runNpm, which supplies the shell; the arguments below contain no spaces, so
// nothing needs quoting.
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// When npm runs a script it exports its whole resolved config as npm_config_*,
// and a nested npm inherits it. That is how a *global* ~/.npmrc `allow-scripts`
// reaches a project-scoped `npm install`, which npm 11 rejects outright with
// EALLOWSCRIPTS -- a failure the old build.sh never saw, because bash is not
// npm. Strip the lot for nested calls: the child npm re-reads the same .npmrc
// files itself, so no real configuration is lost.
const withoutInheritedNpmConfig = (env) =>
  Object.fromEntries(Object.entries(env).filter(([key]) => !key.toLowerCase().startsWith('npm_config_')));

const runNpm = (args, options = {}) =>
  run(NPM, args, {
    shell: process.platform === 'win32',
    ...options,
    env: withoutInheritedNpmConfig(options.env ?? process.env),
  });

// A fresh local environment file intentionally contains no overrides.
const ENV_LOCAL_DEFAULT = '# Intentionally empty. Supported workflows use same-origin API paths.';

const START = Date.now();
const elapsed = () => {
  const s = Math.floor((Date.now() - START) / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
};
const step = (s) => process.stdout.write(`\n\x1b[1m==> ${s}\x1b[0m  (+${elapsed()})\n`);

class BuildError extends Error {}
const die = (message) => {
  throw new BuildError(message);
};

const isFile = (p) => fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;

// Every external command goes through here: inherited stdio so PyInstaller and
// npm stay readable live, and a non-zero exit is a hard stop rather than a
// warning that the next step then trips over.
function run(command, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const res = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: ROOT,
    ...spawnOptions,
  });
  if (res.error) {
    if (allowFailure) return false;
    die(`${command} could not be started: ${res.error.message}`);
  }
  if (res.status !== 0) {
    if (allowFailure) return false;
    die(`${command} ${args.join(' ')} exited with ${res.status ?? res.signal}`);
  }
  return true;
}

// ---- env restore ------------------------------------------------------------
// Registered before anything is moved, and fires on every exit path: success,
// failure, or interrupt.
function restoreEnvLocal() {
  if (isFile(ENV_STASH)) {
    fs.mkdirSync(path.dirname(ENV_LOCAL), { recursive: true });
    fs.renameSync(ENV_STASH, ENV_LOCAL);
    process.stdout.write(`\n[env] restored ${path.relative(ROOT, ENV_LOCAL)}\n`);
  } else if (!isFile(ENV_LOCAL)) {
    // Nothing was stashed and nothing is there -- fresh clone, or a previous
    // build deleted it and never put it back. Leave the tree usable either way.
    fs.mkdirSync(path.dirname(ENV_LOCAL), { recursive: true });
    fs.writeFileSync(ENV_LOCAL, `${ENV_LOCAL_DEFAULT}\n`);
    process.stdout.write(`\n[env] created ${path.relative(ROOT, ENV_LOCAL)} with the default dev value\n`);
  }
}

// npm scripts have no `trap`, so the bash EXIT trap becomes these. Everything
// restoreEnvLocal does is synchronous, which is what makes it valid inside an
// 'exit' handler.
process.on('exit', restoreEnvLocal);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    process.stdout.write(`\n\x1b[33mBUILD INTERRUPTED (${signal})\x1b[0m\n`);
    process.exit(130);
  });
}

async function main() {
  // ---- clean previous build outputs -----------------------------------------
  // Scoped to generated outputs from this project.
  step('Cleaning previous build artifacts');
  for (const dir of [
    'dist',
    'services/voice-api/dist',
    'services/voice-api/build',
    'apps/studio/dist',
    'desktop/launcher/dist',
    'desktop/launcher/build',
  ]) {
    fs.rmSync(atRoot(...dir.split('/')), { recursive: true, force: true });
  }

  // ---- 0. prerequisites ------------------------------------------------------
  step('Checking prerequisites');
  if (!run('python', ['--version'], { stdio: 'ignore', allowFailure: true })) {
    die('python is not on PATH.');
  }
  if (!runNpm(['--version'], { stdio: 'ignore', allowFailure: true })) {
    die('npm is not on PATH.');
  }
  if (!isFile(SEVENZIP)) die(`7-Zip not found at ${SEVENZIP}. Install with: winget install 7zip.7zip`);
  if (!isFile(SFX)) die(`7z.sfx not found at ${SFX}. It ships with the full 7-Zip install, not the reduced one.`);
  if (!isFile(atRoot('services', 'voice-api', 'backend.spec'))) {
    die('services/voice-api/backend.spec is missing -- is this the repo root?');
  }
  if (!isFile(atRoot('desktop', 'launcher', 'launcher.spec'))) {
    die('desktop/launcher/launcher.spec is missing.');
  }
  console.log('  python, npm, 7-Zip and both PyInstaller specs present.');

  // ---- 1. Python environment -------------------------------------------------
  step('Checking Python environment');
  let PY = atRoot('.venv', 'Scripts', 'python.exe');
  if (!isFile(PY)) PY = atRoot('.venv', 'bin', 'python');
  if (!isFile(PY)) die('no virtualenv interpreter. Follow README.md: First-time setup.');

  // ---- 2. pyinstaller --------------------------------------------------------
  step('PyInstaller');
  if (run(PY, ['-c', 'import PyInstaller'], { stdio: 'ignore', allowFailure: true })) {
    console.log('  already installed.');
  } else {
    console.log('  installing (build tool -- deliberately not in requirements.txt)...');
    run(PY, ['-m', 'pip', 'install', '--quiet', 'pyinstaller']);
  }

  // ---- 3. pre-build gates ----------------------------------------------------
  // Cheap, and they run before the 20-minute freeze rather than after it.
  step('Pre-build checks');
  for (const check of [
    'check_design_tokens.py',
    'check_contrast.py',
    'check_palette.py',
    'check_orphan_css.py',
    'check_desktop_port.py',
  ]) {
    run('python', [path.join('scripts', check)]);
  }
  const studio = atRoot('apps', 'studio');
  runNpm(['install', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: studio });
  runNpm(['run', 'test'], { cwd: studio });
  runNpm(['run', 'lint'], { cwd: studio });
  // After npm install, because it needs the Tailwind CLI from apps/studio/node_modules.
  run('python', [path.join('scripts', 'build_splash.py'), '--check']);

  // ---- 4. stash the dev env file --------------------------------------------
  step(`Stashing ${path.relative(ROOT, ENV_LOCAL)}`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  if (isFile(ENV_LOCAL)) {
    fs.renameSync(ENV_LOCAL, ENV_STASH);
    console.log('  stashed; will be restored when this script exits.');
  } else {
    console.log('  not present; the exit handler will create it with the default dev value at the end.');
  }

  // ---- 5. frontend -----------------------------------------------------------
  // backend.spec hard-fails without apps/studio/dist, so this precedes the freeze.
  step('Building the frontend');
  runNpm(['run', 'build'], { cwd: studio });

  // ---- 6. freeze -------------------------------------------------------------
  // TMP/TEMP land on this drive on purpose: PyInstaller pushes several GB through
  // temp and will exhaust a small system drive.
  const freezeEnv = { ...process.env, TMP: TMP_DIR, TEMP: TMP_DIR };
  step('Freezing backend.exe (this is the long one, ~15-20 min)');
  run(PY, ['-m', 'PyInstaller', 'backend.spec', '--clean', '--noconfirm'], {
    cwd: atRoot('services', 'voice-api'),
    env: freezeEnv,
  });

  // The splash is Tailwind, compiled ahead of time and inlined into
  // launcher/_splash.py, which launcher.py imports. It cannot use the Play CDN
  // the landing page uses: this screen has to paint with no backend and often no
  // network, which is exactly when a CDN is unavailable. Regenerated here rather
  // than trusted, so the exe can never ship stale CSS -- the --check above only
  // catches a stale commit, not a source edited since.
  step('Compiling the launcher splash');
  run('python', [path.join('scripts', 'build_splash.py')]);

  step('Freezing Homegrown.exe (launcher)');
  run(PY, ['-m', 'PyInstaller', 'launcher.spec', '--clean', '--noconfirm'], {
    cwd: atRoot('desktop', 'launcher'),
    env: freezeEnv,
  });

  // ---- 7. stage --------------------------------------------------------------
  step('Staging the install layout');
  fs.rmSync(STAGE_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGE_DIR, { recursive: true });
  fs.copyFileSync(atRoot('desktop', 'launcher', 'dist', 'Homegrown.exe'), path.join(STAGE_DIR, 'Homegrown.exe'));
  fs.cpSync(atRoot('services', 'voice-api', 'dist', 'backend'), path.join(STAGE_DIR, 'backend'), {
    recursive: true,
  });
  for (const dir of [['storage', 'references'], ['storage', 'generated'], ['models']]) {
    fs.mkdirSync(path.join(STAGE_DIR, ...dir), { recursive: true });
  }
  console.log(`  staged at ${path.relative(ROOT, STAGE_DIR)}`);

  // ---- 8. portability gate ---------------------------------------------------
  // A hard failure, not a reminder: both of these ship a machine-specific build to
  // someone else, and neither is obvious once the .exe is packed.
  step('Portability gate');
  if (isFile(path.join(STAGE_DIR, 'backend', '.env'))) {
    die(`${path.relative(ROOT, STAGE_DIR)}/backend/.env exists. It carries an absolute MODEL_PATH that exists on no other machine. Delete it and re-run.`);
  }
  if (fs.readdirSync(path.join(STAGE_DIR, 'models')).length > 0) {
    die(`${path.relative(ROOT, STAGE_DIR)}/models is not empty. It must ship empty -- the app downloads the model on first run.`);
  }
  if (!isFile(path.join(STAGE_DIR, 'Homegrown.exe'))) die('launcher exe missing from the staged tree.');
  if (!isFile(path.join(STAGE_DIR, 'backend', 'backend.exe'))) die('backend.exe missing from the staged tree.');
  console.log('  no .env shipped, models/ empty, both executables present.');

  // ---- 9. pack ---------------------------------------------------------------
  // -mx5 not -mx9: the payload is mostly incompressible CUDA DLLs, so maximum
  // compression costs far more time for a couple of percent.
  step('Packing the self-extractor (~10 min)');
  const archive = path.join(DIST_DIR, 'app.7z');
  fs.rmSync(archive, { force: true });
  fs.rmSync(OUTPUT, { force: true });
  run(SEVENZIP, ['a', '-t7z', '-m0=lzma2', '-mx5', '-mmt=on', 'app.7z', 'Homegrown'], {
    cwd: DIST_DIR,
    stdio: 'ignore',
  });
  // Binary concatenation, streamed. Never a shell redirect -- PowerShell's `>`
  // rewrites binaries as text -- and never readFileSync, since app.7z is GBs.
  fs.copyFileSync(SFX, OUTPUT);
  await pipeline(fs.createReadStream(archive), fs.createWriteStream(OUTPUT, { flags: 'a' }));
  fs.rmSync(archive, { force: true });
  if (!isFile(OUTPUT)) die(`packing produced no ${path.relative(ROOT, OUTPUT)}`);

  // ---- 10. report ------------------------------------------------------------
  step('Done');
  const bytes = fs.statSync(OUTPUT).size;
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(OUTPUT), hash);
  process.stdout.write(`\n  \x1b[1m${OUTPUT}\x1b[0m\n`);
  process.stdout.write(`  size    ${(bytes / 1024 ** 3).toFixed(1)}G\n`);
  process.stdout.write(`  sha256  ${hash.digest('hex')}\n`);
  process.stdout.write(`  built   ${elapsed()}\n`);

  process.stdout.write(`
  Not verified by this script -- it needs a human:

    ./dist/Homegrown/Homegrown.exe

  Expect a browser loader within ~2s, storage/boot_status.json and
  storage/backend.log appearing, and a redirect to the app once the model
  loads. Confirm the listener is on every interface:

    netstat -ano | findstr :8731     # 0.0.0.0:8731

  THE FIREWALL PROMPT IS THE DANGEROUS MOMENT. backend.exe now binds 0.0.0.0,
  so Windows Defender Firewall asks on first run -- and choosing Cancel writes
  a permanent Block rule for that exe path which nothing in the app can undo.
  Pre-authorise it BEFORE the first launch, from an elevated prompt, and the
  prompt never appears:

    netsh advfirewall firewall add rule name="Homegrown" dir=in ^
      action=allow program="C:\\Homegrown\\backend\\backend.exe" ^
      protocol=TCP localport=8731 enable=yes profile=private

  And note what the wildcard bind exposes: this app has no general
  authentication (auth.py returns a constant user). Voice and completed
  voiceover deletion requires the admin password; other API actions, including
  voice creation, are unauthenticated. Trusted networks only.

  If you publish this build, update the landing page's download link, size text
  and SHA-256 together. A stale checksum is worse than none.
`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof BuildError ? error.message : (error?.stack ?? String(error));
  process.stderr.write(`\n\x1b[31mBUILD FAILED: ${message}\x1b[0m\n`);
  process.exit(1);
}
