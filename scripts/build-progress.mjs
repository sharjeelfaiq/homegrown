const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export const TOTAL_STAGES = 10;

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return 'calculating...';
  const whole = Math.round(seconds);
  if (whole < 60) return `00:${String(whole).padStart(2, '0')}s`;
  if (whole < 3600) return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}m`;
  return `${String(Math.floor(whole / 3600)).padStart(2, '0')}:${String(Math.floor(whole / 60) % 60).padStart(2, '0')}h`;
}

export function stageStatus(completed, current, total = TOTAL_STAGES) {
  const complete = Math.max(0, Math.min(completed, total));
  const active = current == null ? null : Math.max(1, Math.min(current, total));
  return Array.from({ length: total }, (_, index) => {
    const number = index + 1;
    return { number, state: number <= complete ? 'completed' : number === active ? 'current' : 'pending' };
  });
}

export function stageDescription(stage) {
  return ({
    'Cleaning Artifacts': 'Removing old build files',
    'Checking Prerequisites': 'Checking required tools',
    'Preparing Python': 'Finding the build environment',
    'Preparing PyInstaller': 'Checking the app freezer',
    'Running Validation': 'Running tests and checks',
    'Stashing Environment': 'Saving local settings safely',
    'Building Studio': 'Compiling the web app',
    'Freezing Backend': 'Creating backend.exe',
    'Building Launcher': 'Creating the desktop launcher',
    'Packaging Release': 'Staging and packing the release',
  }[stage] || 'Working on this step');
}

export function progressPercent(completed, total = TOTAL_STAGES) {
  return Math.round((Math.max(0, Math.min(completed, total)) / total) * 100);
}

export function progressBar(completed, total = TOTAL_STAGES, width = 40) {
  const filled = Math.round((Math.max(0, Math.min(completed, total)) / total) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]`;
}

export function renderOverview(stages, width = 120) {
  const labels = stages;
  return ['PLAN', ...labels.map((stage, index) => `  • ${String(index + 1).padStart(2, '0')}  ${stage}`)].join('\n');
}

export function renderProgress({ completed, current, currentStep, currentDescription, nextStep, elapsedSeconds = 0, total = TOTAL_STAGES, interactive = false, spinner = '·', width = 120 }) {
  const percent = progressPercent(completed, total);
  const markers = stageStatus(completed, current, total)
    .map(({ number, state }) => state === 'completed' ? '✓' : state === 'current' ? spinner : '·')
    .join('');
  const compact = width < 105;
  const compactName = (name) => ({
    'Clean previous build artifacts': 'Clean',
    'Check prerequisites': 'Prereqs',
    'Check Python environment': 'Python',
    'Check PyInstaller': 'PyInstaller',
    'Run validation, tests, and lint': 'Validate',
    'Stash .env.local': 'Stash env',
    'Build the Studio frontend': 'Studio',
    'Freeze backend.exe': 'Backend',
    'Build launcher splash and Homegrown.exe': 'Launcher',
    'Stage, validate, package, and report': 'Package',
    'Cleaning Artifacts': 'Cleaning Artifacts',
    'Checking Prerequisites': 'Checking Prereqs',
    'Preparing Python': 'Preparing Python',
    'Preparing PyInstaller': 'Preparing PyInstaller',
    'Running Validation': 'Running Validation',
    'Stashing Environment': 'Stashing Environment',
    'Building Studio': 'Building Studio',
    'Freezing Backend': 'Freezing Backend',
    'Building Launcher': 'Building Launcher',
    'Packaging Release': 'Packaging Release',
  }[name] || name || 'Complete');
  const activeLabel = compactName(currentStep);
  const description = currentDescription || stageDescription(currentStep);
  const line = compact
    ? `${formatDuration(elapsedSeconds)}  ${progressBar(completed, total, 20)} ${String(percent).padStart(3)}% ${String(current ?? total).padStart(2, '0')}/${total} ${description}`
    : `${formatDuration(elapsedSeconds)}  │  ${markers}  ${progressBar(completed, total)}  ${String(percent).padStart(3)}%  │  ${activeLabel} — ${description}`;
  if (!interactive) return line;
  return `\x1b[2K\r${line}`;
}

export class RollingTail {
  constructor(maxBytes = 12_000) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.bytes = 0;
  }

  push(value) {
    const text = String(value);
    this.chunks.push(text);
    this.bytes += Buffer.byteLength(text);
    while (this.bytes > this.maxBytes && this.chunks.length > 1) {
      this.bytes -= Buffer.byteLength(this.chunks.shift());
    }
  }

  toString() {
    return this.chunks.join('').slice(-this.maxBytes);
  }
}

export function stripAnsi(value) {
  return String(value).replace(ANSI_RE, '');
}
