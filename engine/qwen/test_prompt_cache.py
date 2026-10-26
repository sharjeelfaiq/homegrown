import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import torch

from qwen.faster_qwen3_tts import FasterQwen3TTS
from qwen.prompt_cache import PromptCache, reference_key, tensor_storage_bytes


class PromptCacheTests(unittest.TestCase):
    def test_lru_and_storage_limits(self):
        cache = PromptCache(max_entries=2, max_bytes=24)
        values = [torch.zeros(3) for _ in range(4)]
        cache.put('a', values[0])
        cache.put('b', values[1])
        self.assertIs(cache.get('a'), values[0])
        cache.put('c', values[2])
        self.assertIsNone(cache.get('b'))
        self.assertEqual(cache.retained_bytes, 24)
        cache.put('oversized', torch.zeros(7))
        self.assertEqual(len(cache), 2)
        self.assertIsNone(cache.get('oversized'))
        cache.put('a', torch.zeros(1))
        self.assertEqual(cache.retained_bytes, 16)
        cache.put('d', values[3])
        self.assertIsNone(cache.get('c'))
        self.assertEqual(cache.retained_bytes, 16)

    def test_views_count_whole_storage_once(self):
        full = torch.zeros(100)
        self.assertEqual(tensor_storage_bytes({'a': full[:1], 'b': [full[5:6], full]}), 400)
        cache = PromptCache(max_bytes=4)
        cache.put('view', full[:1])
        self.assertEqual(len(cache), 0)

    def test_reference_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ref.wav'
            path.write_bytes(b'one')
            def key(**overrides):
                args = dict(transcript='abc', xvec_only=False, append_silence=True,
                            batch_size=1, device='cpu', dtype=torch.float32)
                args.update(overrides)
                return reference_key(path, **args)
            original = key()
            for changes in [dict(transcript='xyz'), dict(xvec_only=True),
                            dict(append_silence=False), dict(batch_size=2),
                            dict(device='cuda'), dict(dtype=torch.bfloat16)]:
                self.assertNotEqual(original, key(**changes))
            stat = path.stat()
            replacement = path.with_suffix('.new')
            replacement.write_bytes(b'two')
            os.utime(replacement, ns=(stat.st_atime_ns, stat.st_mtime_ns + 10000000))
            replacement.replace(path)
            self.assertNotEqual(original, key())
            path.unlink()
            self.assertIsNone(key())

    def wrapper(self):
        base = SimpleNamespace(sample_rate=24000)
        base.create_voice_clone_prompt = Mock(return_value=[SimpleNamespace(ref_spk_embedding=torch.ones(3))])
        return FasterQwen3TTS(base, None, None, device='cpu', dtype=torch.float32)

    def test_hits_and_independent_instances(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ref.wav'
            path.write_bytes(b'a')
            a, b = self.wrapper(), self.wrapper()
            def resolve(wrapper, text='abc', batch=1):
                return wrapper._resolve_voice_clone_prompt_from_reference([None] * batch, path, text, True, False)
            first = resolve(a)
            self.assertIs(first[0], resolve(a)[0])
            self.assertEqual(a.model.create_voice_clone_prompt.call_count, 1)
            resolve(a, 'xyz')
            resolve(a, 'abc', 2)
            self.assertEqual(a.model.create_voice_clone_prompt.call_count, 3)
            resolve(b)
            self.assertEqual(b.model.create_voice_clone_prompt.call_count, 1)
            path.unlink()
            resolve(a)
            resolve(a)
            self.assertEqual(a.model.create_voice_clone_prompt.call_count, 5)

    def test_file_change_during_creation_is_not_cached(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ref.wav'
            path.write_bytes(b'a')
            wrapper = self.wrapper()
            def create(**kwargs):
                path.write_bytes(path.read_bytes() + b'b')
                return [SimpleNamespace(ref_spk_embedding=torch.ones(3))]
            wrapper.model.create_voice_clone_prompt.side_effect = create
            for _ in range(2):
                wrapper._resolve_voice_clone_prompt_from_reference([None], path, '', True, False)
            self.assertEqual(len(wrapper._voice_prompt_cache), 0)

    def test_icl_hit_mode_change_and_oversized_prompt_bypass(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ref.wav'
            path.write_bytes(b'a')
            wrapper = self.wrapper()
            wrapper.model.create_voice_clone_prompt.return_value = [SimpleNamespace(
                ref_text='reference', ref_spk_embedding=torch.ones(3),
            )]
            wrapper.model._prompt_items_to_voice_clone_prompt = Mock(return_value={
                'ref_code': [torch.ones(25, 16)], 'icl_mode': [True],
            })
            wrapper.model._build_ref_text = lambda text: text
            wrapper.model._tokenize_texts = lambda texts: [torch.ones(4, dtype=torch.long)]
            def resolve(silence=True):
                return wrapper._resolve_voice_clone_prompt_from_reference(
                    [None], path, 'reference', False, silence,
                )
            with patch.object(wrapper, '_load_ref_audio_with_silence', return_value=('audio', 24000)):
                first = resolve()
                self.assertTrue(first[2])
                self.assertIs(first[0], resolve()[0])
                self.assertEqual(wrapper.model.create_voice_clone_prompt.call_count, 1)
                resolve(False)
                self.assertEqual(wrapper.model.create_voice_clone_prompt.call_count, 2)
                wrapper._voice_prompt_cache = PromptCache(max_bytes=4)
                resolve()
                resolve()
                self.assertEqual(len(wrapper._voice_prompt_cache), 0)
                self.assertEqual(wrapper.model.create_voice_clone_prompt.call_count, 4)


if __name__ == '__main__':
    unittest.main()
