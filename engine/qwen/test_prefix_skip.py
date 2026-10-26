from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch

from qwen.waveform_stream import prefix_skipping_waveform_stream
from qwen import FasterQwen3TTS


class FakeDecoder(torch.nn.Module):
    total_upsample = 7

    def __init__(self):
        super().__init__()
        self.calls = []

    def forward(self, codes):
        self.calls.append(codes.clone())
        values = codes[:, 0, :].float() + torch.arange(codes.shape[-1]) / 8
        return values.repeat_interleave(7, dim=-1).unsqueeze(1)

    def chunked_decode(self, codes, chunk_size=100, left_context_size=25):
        pieces = []
        for start in range(0, codes.shape[-1], chunk_size):
            end = min(start + chunk_size, codes.shape[-1])
            context = min(left_context_size, start)
            audio = self(codes[..., start - context:end])
            pieces.append(audio[..., context * self.total_upsample:])
        return torch.cat(pieces, dim=-1)


def tokenizer_fixture():
    decoder = FakeDecoder()
    def decode(data):
        codes = torch.clamp(data['audio_codes'], min=0)
        audio = decoder.chunked_decode(codes.transpose(1, 2))[0, 0].numpy()
        return [audio], 24000
    return SimpleNamespace(device='cpu', decode=decode, model=SimpleNamespace(
        decode_upsample_rate=7, decoder=decoder, get_output_sample_rate=lambda: 24000)), decoder


class PrefixSkipTests(unittest.TestCase):
    def test_public_clone_stream_preserves_prompt_and_sampling(self):
        tokenizer, decoder = tokenizer_fixture()
        wrapper = FasterQwen3TTS(SimpleNamespace(sample_rate=24000), None, None, device='cpu')
        reference = torch.ones(507, 16, dtype=torch.long)
        prepared = (SimpleNamespace(speech_tokenizer=tokenizer), None, None, None, None, None, None, reference)
        with patch.object(wrapper, '_prepare_generation', return_value=prepared) as prepare, patch(
            'qwen.streaming.parity_generate_streaming',
            return_value=iter([(torch.ones(12, 16, dtype=torch.long), {}) for _ in range(2)]),
        ) as source:
            output = list(wrapper.generate_voice_clone_streaming('script', 'English',
                ref_audio='unchanged.wav', ref_text='Complete reference transcript',
                max_new_tokens=258, temperature=0.5, top_p=0.85, top_k=30))
        self.assertEqual(prepare.call_args.kwargs['ref_audio'], 'unchanged.wav')
        self.assertEqual(prepare.call_args.kwargs['ref_text'], 'Complete reference transcript')
        self.assertEqual(source.call_args.kwargs['max_new_tokens'], 258)
        self.assertEqual(source.call_args.kwargs['temperature'], 0.5)
        self.assertEqual(source.call_args.kwargs['top_p'], 0.85)
        self.assertEqual(source.call_args.kwargs['top_k'], 30)
        self.assertEqual([c.shape[-1] for c in decoder.calls], [44, 56])
        self.assertEqual([len(a) for a, _, _ in output], [84, 84])
        self.assertEqual(reference.shape[0], 507)

    def test_exact_legacy_pcm_and_decoder_block_inputs_across_boundaries(self):
        # Frozen baseline implementation, independent of the production helper.
        import sys
        from pathlib import Path
        with patch.object(sys, 'path', [
            str(Path(__file__).resolve().parents[2] / 'scripts/benchmarks'), *sys.path,
        ]):
            from legacy_waveform_stream import legacy_waveform_stream
        for sizes in ([1], [12, 1], [12, 12, 12, 12, 3], [25, 25, 7], [101, 101, 3]):
            for ref_len in (0, 1, 24, 25, 99, 100, 101, 199, 500, 507):
                with self.subTest(sizes=sizes, reference=ref_len):
                    tokenizer, decoder = tokenizer_fixture()
                    generated = (torch.arange(sum(sizes)) + 1000).reshape(-1, 1).repeat(1, 16)
                    reference = (torch.arange(ref_len) + 1).reshape(-1, 1).repeat(1, 16) if ref_len else None
                    pieces = list(generated.split(sizes))
                    source = lambda: iter((p, {'i': i}) for i, p in enumerate(pieces))
                    old = list(legacy_waveform_stream(source(), tokenizer, reference, sizes[0]))
                    old_inputs = decoder.calls[:]
                    decoder.calls.clear()
                    with patch('torch.cuda.Event', side_effect=AssertionError('No ordinary CUDA timing')), patch(
                        'torch.cuda.synchronize', side_effect=AssertionError('No new synchronization'),
                    ):
                        new = list(prefix_skipping_waveform_stream(source(), tokenizer, reference, sizes[0]))
                    self.assertEqual(len(old), len(new))
                    for (a, sr, timing), (b, new_sr, new_timing) in zip(old, new):
                        np.testing.assert_array_equal(a, b)
                        self.assertEqual((sr, timing), (new_sr, new_timing))
                    cursor = 0
                    for codes in decoder.calls:
                        self.assertLessEqual(codes.shape[-1], 125)
                        while cursor < len(old_inputs) and not torch.equal(codes, old_inputs[cursor]):
                            cursor += 1
                        self.assertLess(cursor, len(old_inputs))
                        cursor += 1
                    if ref_len >= 199:
                        self.assertLess(len(decoder.calls), len(old_inputs))

    def test_cancellation_closes_source_and_suppresses_further_decode(self):
        tokenizer, decoder = tokenizer_fixture()
        closed = []
        def source():
            try:
                yield torch.ones(12, 16, dtype=torch.long), {}
                self.fail('Cancellation requested another piece')
            finally:
                closed.append(True)
        stream = prefix_skipping_waveform_stream(source(), tokenizer, torch.ones(507, 16, dtype=torch.long))
        next(stream)
        calls = len(decoder.calls)
        stream.close()
        self.assertEqual(closed, [True])
        self.assertEqual(len(decoder.calls), calls)

    def test_invalid_direct_block_length_is_rejected(self):
        tokenizer, decoder = tokenizer_fixture()
        original = decoder.forward
        decoder.forward = lambda codes: original(codes)[..., :-1]
        with self.assertRaisesRegex(RuntimeError, 'block length'):
            next(prefix_skipping_waveform_stream(iter([(torch.ones(12, 16, dtype=torch.long), {})]),
                                                tokenizer, torch.ones(507, 16, dtype=torch.long)))


if __name__ == '__main__':
    unittest.main()
