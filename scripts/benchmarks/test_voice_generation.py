"""Benchmark safety tests run without loading a model or touching CUDA."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

SCRIPT = Path(__file__).with_name('voice_generation.py')
ROOT = SCRIPT.parents[2]


class BenchmarkTests(unittest.TestCase):
    def test_interference_closes_capture_without_requesting_another_piece(self):
        spec = importlib.util.spec_from_file_location('voice_benchmark', SCRIPT)
        benchmark = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(benchmark)
        monitor = SimpleNamespace(interfered=threading.Event())
        measured = benchmark.Measurements(None, time.monotonic() + 60, monitor)
        measured.wrap = lambda _name, fn: fn
        piece = Mock()
        piece.detach.return_value.clone.return_value = piece
        closed = []
        def source(**kwargs):
            try:
                yield piece, {}
                self.fail('Interference must close the source before another yield')
            finally:
                closed.append(True)
        stream = measured.stream(source)()
        next(stream)
        monitor.interfered.set()
        with self.assertRaises(benchmark.BackendReappeared):
            next(stream)
        self.assertEqual(closed, [True])

    def test_rejects_budget_beyond_phase_authorization_without_importing_model(self):
        result = subprocess.run([sys.executable, '-S', str(SCRIPT), '--phase', 'baseline',
                                 '--output', '.tmp/voice-speed/unused', '--budget-seconds', '601'],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('1..600 seconds', result.stderr)

    def test_suppression_mask_parity_including_eos_and_small_vocabularies(self):
        import torch
        from candidate_diagnostics import suppression_mask
        for vocab_size in (0, 1, 16, 1024, 1025, 3072):
            for eos in (-1, 0, vocab_size // 2, vocab_size - 1, vocab_size):
                with self.subTest(vocab_size=vocab_size, eos=eos):
                    expected = torch.zeros(vocab_size, dtype=torch.bool)
                    for index in range(max(0, vocab_size - 1024), vocab_size):
                        if index != eos:
                            expected[index] = True
                    self.assertTrue(torch.equal(expected, suppression_mask(torch, vocab_size, eos, 'cpu')))

    def test_import_is_dependency_free_and_has_no_cuda_timing_calls(self):
        code = """
import importlib.util, sys
spec = importlib.util.spec_from_file_location('benchmark', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert 'torch' not in sys.modules
assert 'homegrown_api.config' not in sys.modules
"""
        subprocess.run([sys.executable, '-S', '-c', code, str(SCRIPT)], check=True)

    def test_isolation_precedes_owner_imports_and_persistence(self):
        with tempfile.TemporaryDirectory() as directory:
            code = """
import importlib.util, sys
from pathlib import Path
spec = importlib.util.spec_from_file_location('benchmark', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
output = Path(sys.argv[2])
config = module.isolate(output)
from homegrown_api.persistence import stores
from homegrown_api import boot_status
assert config.STORAGE_DIR == output / 'storage'
assert all(config.STORAGE_DIR in p.parents for p in [config.QUEUE_FILE, config.HISTORY_FILE, config.GEN_DIR, config.REF_DIR])
stores._save_json(config.HISTORY_FILE, [{'test': True}])
boot_status.write(config.STORAGE_DIR, 'ready')
assert (config.STORAGE_DIR / 'boot_status.json').is_file()
assert 'homegrown_api.lifespan' not in sys.modules
assert 'torch' not in sys.modules
"""
            subprocess.run([sys.executable, '-c', code, str(SCRIPT), directory], check=True, cwd=ROOT)
            self.assertEqual(json.loads((Path(directory) / 'storage/history.json').read_text()), [{'test': True}])

    def test_no_cuda_events_in_ordinary_cache_or_history_code(self):
        for name in ('prompt_cache.py', 'faster_qwen3_tts.py', 'waveform_stream.py'):
            source = (ROOT / 'engine/qwen' / name).read_text(encoding='utf-8')
            self.assertNotIn('cuda.Event', source)


if __name__ == '__main__':
    unittest.main()
