"""Check frozen path resolution without running PyInstaller or downloading models."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class FrozenPathTests(unittest.TestCase):
    def test_packaged_paths_and_storage_overrides(self):
        service = Path(__file__).resolve().parents[1]
        program = '''
import sys
from pathlib import Path
import dotenv
dotenv.load_dotenv = lambda *args, **kwargs: None
root = Path(sys.argv[1])
sys.frozen = True
sys.executable = str(root / 'backend' / 'backend.exe')
sys._MEIPASS = str(root / 'backend' / '_internal')
from homegrown_api import config
assert config.STORAGE_DIR == Path(sys.argv[2]), config.STORAGE_DIR
assert config.FRONTEND_DIST == Path(sys._MEIPASS) / 'frontend_dist'
'''
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for overrides, expected in [
                ({}, root / 'storage'),
                ({'VOICECLONE_STORAGE_DIR': str(root / 'legacy')}, root / 'legacy'),
                ({'HOMEGROWN_STORAGE_DIR': str(root / 'custom')}, root / 'custom'),
            ]:
                env = {k: v for k, v in os.environ.items() if k not in {'HOMEGROWN_STORAGE_DIR', 'VOICECLONE_STORAGE_DIR'}}
                env.update(overrides)
                result = subprocess.run(
                    [sys.executable, '-c', program, str(root), str(expected)],
                    cwd=service, env=env, capture_output=True, text=True,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
