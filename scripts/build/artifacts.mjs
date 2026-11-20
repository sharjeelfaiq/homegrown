import fs from 'node:fs';
import path from 'node:path';

const isFile = (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() ?? false;

export function ensureBackendExecutable(distDir, buildDir) {
  const frozenExe = path.join(distDir, 'backend.exe');
  if (isFile(frozenExe)) return false;

  const builtExe = path.join(buildDir, 'backend.exe');
  if (!isFile(builtExe)) {
    throw new Error('PyInstaller reported success, but backend.exe is missing from both build and dist output. Check the build log and Windows Security history.');
  }
  try {
    fs.copyFileSync(builtExe, frozenExe);
  } catch (error) {
    throw new Error('PyInstaller reported success, but backend.exe could not be restored to dist. Check Windows file locks and Security history.', { cause: error });
  }
  if (!isFile(frozenExe)) {
    throw new Error('backend.exe disappeared from dist after copying it from PyInstaller output. Check Windows Security history.');
  }
  return true;
}
