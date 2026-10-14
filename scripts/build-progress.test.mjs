import test from 'node:test';
import assert from 'node:assert/strict';
import { RollingTail, progressBar, progressPercent, renderOverview, renderProgress, stageStatus } from './build-progress.mjs';

test('stage numbering and remaining steps', () => {
  assert.deepEqual(stageStatus(2, 3, 10).slice(0, 4).map((stage) => stage.state), ['completed', 'completed', 'current', 'pending']);
  assert.equal(10 - 2, 8);
});

test('progress bar and percentage are bounded', () => {
  assert.equal(progressPercent(5, 10), 50);
  assert.equal(progressBar(5, 10, 40), '[####################--------------------]');
  assert.equal(progressPercent(20, 10), 100);
});

test('interactive progress uses ANSI line control', () => {
  const output = renderProgress({ completed: 2, current: 3, currentStep: 'Checks', nextStep: 'Stash', elapsedSeconds: 12, etaSeconds: 24, interactive: true });
  assert.match(output, /^\x1b\[2K\r/);
  assert.match(output, /03\/10/);
  assert.match(output, /Checks/);
  assert.doesNotMatch(output, /ETA/);
});

test('overview lists every stage in order', () => {
  const overview = renderOverview(['Clean', 'Check', 'Package']);
  assert.equal(overview, 'PLAN\n  01.  Clean\n  02.  Check\n  03.  Package');
});

test('overview highlights the active stage in green', () => {
  const overview = renderOverview(['Clean', 'Check', 'Package'], 120, 2);
  assert.match(overview, /\x1b\[32m  02\.  Check\x1b\[0m/);
});

test('overview places estimates before each stage name', () => {
  const overview = renderOverview(['Clean', 'Check'], 120, null, [5, 120]);
  assert.match(overview, /01\.  ~5s  Clean/);
  assert.match(overview, /02\.  ~2m  Check/);
});

test('interactive progress row is green', () => {
  const output = renderProgress({ completed: 2, current: 3, currentStep: 'Checks', nextStep: 'Stash', interactive: true });
  assert.match(output, /\x1b\[32m.*Checks.*\x1b\[0m/);
});

test('non-interactive progress is readable and has no ANSI', () => {
  const output = renderProgress({ completed: 2, current: 3, currentStep: 'Checks', nextStep: 'Stash', elapsedSeconds: 12, interactive: false });
  assert.doesNotMatch(output, /\x1b\[/);
  assert.doesNotMatch(output, /left|→|next:/);
  assert.doesNotMatch(output, /ETA/);
});

test('rolling failure tail stays bounded', () => {
  const tail = new RollingTail(10);
  tail.push('12345');
  tail.push('67890');
  tail.push('abcde');
  assert.equal(tail.toString(), '67890abcde');
});
