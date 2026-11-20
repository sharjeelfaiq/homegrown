import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ensureBackendExecutable } from './artifacts.mjs';

test('restores a missing frozen executable from PyInstaller output', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homegrown-artifact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const buildDir = path.join(root, 'build');
  const distDir = path.join(root, 'dist');
  fs.mkdirSync(buildDir);
  fs.mkdirSync(distDir);
  fs.writeFileSync(path.join(buildDir, 'backend.exe'), 'frozen executable');

  assert.equal(ensureBackendExecutable(distDir, buildDir), true);
  assert.equal(fs.readFileSync(path.join(distDir, 'backend.exe'), 'utf8'), 'frozen executable');
  assert.equal(ensureBackendExecutable(distDir, buildDir), false);
});

test('fails clearly when PyInstaller produced no executable', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'homegrown-artifact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  assert.throws(
    () => ensureBackendExecutable(path.join(root, 'dist'), path.join(root, 'build')),
    /missing from both build and dist output/,
  );
});
