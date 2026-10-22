const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export const TOTAL_STAGES = 10;

// Baseline measured by the successful third build on 2026-10-14. These are
// used only before the current run has measured a stage; current-run timings
// always take precedence in the overview and summary.
export const DEFAULT_STAGE_ETAS = [
  0.0176597, 0.2952146, 0.0003896, 0.2049711, 6.5972247,
  0.0003075, 14.0956665, 1062.2195449, 31.3754633, 1902.2743388,
];

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
  return stage || 'Working on this step';
}

export function progressPercent(completed, total = TOTAL_STAGES) {
  return Math.round((Math.max(0, Math.min(completed, total)) / total) * 100);
}

export function progressBar(completed, total = TOTAL_STAGES, width = 40) {
  const filled = Math.round((Math.max(0, Math.min(completed, total)) / total) * width);
  return `[${'#'.repeat(filled)}${'-'.repeat(Math.max(0, width - filled))}]`;
}

const ANSI_GREEN = '\x1b[32m';
const ANSI_RESET = '\x1b[0m';

export function renderOverview(stages, width = 120, active = null, timings = []) {
  const labels = stages.map((stage) => typeof stage === 'string' ? stage : stage?.name || 'Working on this step');
  return labels.map((stage, index) => renderOverviewLine(stage, index, width, active, timings[index])).join('\n');
}

export function renderOverviewLine(stage, index, width = 120, active = null, timing = undefined) {
  const duration = typeof timing === 'number' ? timing : timing?.durationSeconds ?? timing?.etaSeconds ?? timing?.duration;
  const eta = Number.isFinite(duration) ? formatDuration(duration) : 'measuring';
  const prefix = `  (${eta}) ${String(index + 1).padStart(2, '0')}. `;
  const available = Math.max(1, width - prefix.length);
  const label = stage.length > available ? `${stage.slice(0, Math.max(1, available - 1))}…` : stage;
  const line = `${prefix}${label}`;
  return index + 1 === active ? `${ANSI_GREEN}${line}${ANSI_RESET}` : line;
}

export function renderProgress({ completed, current, currentStep, currentDescription, nextStep, elapsedSeconds = 0, total = TOTAL_STAGES, interactive = false, spinner = '·', width = 120, redraw = false }) {
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
    ? `${formatDuration(elapsedSeconds)}  ${progressBar(completed, total, 20)} ${String(percent).padStart(3)}% ${String(current ?? total).padStart(2, '0')}/${total}`
    : `${formatDuration(elapsedSeconds)}  │  ${markers}  ${progressBar(completed, total)}  ${String(percent).padStart(3)}%  │  ${String(current ?? total).padStart(2, '0')}/${total}  ${activeLabel} — ${description}`;
  if (!interactive) return line;
  const greenLine = `${ANSI_GREEN}${line}${ANSI_RESET}`;
  if (!compact) return `\x1b[2K\r${greenLine}`;
  const prefix = redraw ? '\x1b[1A' : '';
  return `${prefix}\x1b[2K\r${greenLine}\n\x1b[2K\r  ${description}`;
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
