import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBuildSummary } from './summary.mjs';

test('success summary is compact, aligned, and uncolored when color is disabled', () => {
  const output = renderBuildSummary({
    status: 'success',
    duration: '27m 07s',
    fields: [
      { label: 'Installer', value: 'D:\\code\\websites\\homegrown\\dist\\Homegrown-1.0.0.exe', accent: true },
      { label: 'Size', value: '1.7 GB' },
    ],
  });

  assert.equal(output, [
    'BUILD SUCCEEDED',
    '-'.repeat(44),
    '  Duration   27m 07s',
    '  Installer  D:\\code\\websites\\homegrown\\dist\\Homegrown-1.0.0.exe',
    '  Size       1.7 GB',
    '-'.repeat(44),
    '',
  ].join('\n'));
  assert.doesNotMatch(output, /\x1b\[/);
});

test('installer path links to its directory only when terminal hyperlinks are enabled', () => {
  const installer = 'D:\\code\\websites\\homegrown\\dist\\Homegrown-1.0.0.exe';
  const directoryUrl = 'file:///D:/code/websites/homegrown/dist/';
  const linked = renderBuildSummary({
    status: 'success',
    duration: '01m 02s',
    hyperlinks: true,
    fields: [{ label: 'Installer', value: installer, href: directoryUrl }],
  });
  assert.ok(linked.includes(`\x1b]8;;${directoryUrl}\x1b\\${installer}\x1b]8;;\x1b\\`));

  const plain = renderBuildSummary({
    status: 'success',
    duration: '01m 02s',
    fields: [{ label: 'Installer', value: installer, href: directoryUrl }],
  });
  assert.ok(plain.includes(installer));
  assert.doesNotMatch(plain, /\x1b\]8;;/);
});

test('failure summary colors the heading and log path when color is enabled', () => {
  const output = renderBuildSummary({
    status: 'failure',
    duration: '14m 18s',
    color: true,
    fields: [
      { label: 'Stage', value: '08/10 - Creating backend.exe' },
      { label: 'Issue', value: 'Build command exited with code 1.' },
      { label: 'Log', value: '.tmp/build-logs/build.log', accent: true },
    ],
  });

  assert.match(output, /\x1b\[31mBUILD FAILED\x1b\[0m/);
  assert.match(output, /\x1b\[90m-{44}\x1b\[0m/);
  assert.match(output, /\x1b\[36m\.tmp\/build-logs\/build\.log\x1b\[0m/);
  assert.match(output, /  Duration  /);
  assert.match(output, /  Stage     /);
});

test('cancelled builds have a distinct heading', () => {
  const output = renderBuildSummary({ status: 'cancelled', duration: '01m 02s', fields: [] });
  assert.match(output, /^BUILD CANCELLED\n/);
});
