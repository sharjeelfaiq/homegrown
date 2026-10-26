"""Exact decoder-input and PCM parity against the original accumulated path."""
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch

from codec_history_candidate import CodecHistory
from qwen.faster_qwen3_tts import FasterQwen3TTS
from bounded_waveform_candidate import install


def original_decode(pieces, reference, chunk_size, bounded=False):
    """Frozen pre-optimization assembly and sample slicing with fake vocoder."""
    history, inputs, output = [], [], []
    calibrated, previous = None, 0
    candidate = CodecHistory()
    for piece in pieces:
        history.append(piece)
        flat = candidate.append(piece, calibrated is not None) if bounded else torch.cat(history)
        total, new = sum(len(p) for p in history), len(piece)
        if calibrated is None:
            codes = torch.cat((reference, flat)) if reference is not None else flat
            inputs.append(codes.clone())
            audio = fake_pcm(codes)
            if reference is not None:
                cut = int(len(reference) / max(len(codes), 1) * len(audio))
                audio = audio[cut:]
            output.append(audio[previous:])
            previous = len(audio)
            if total >= max(25, chunk_size):
                calibrated = len(audio) / total
        else:
            codes = flat if bounded else flat[max(0, total - new - 25):]
            inputs.append(codes.clone())
            audio = fake_pcm(codes)
            context = len(codes) - new
            output.append(audio[int(round(context * calibrated)):] if context else audio)
    return inputs, output


def fake_pcm(codes):
    # Length deliberately not a whole samples/frame multiple; tests rounding.
    return np.repeat(codes[:, 0].numpy().astype(np.float32), 7)[:-1]


class CodecHistoryTests(unittest.TestCase):
    def test_frozen_legacy_stream_matches_old_decoder_inputs_and_pcm(self):
        for sizes in ([1], [12, 5], [12, 12, 1], [12, 12, 12, 12, 3],
                      [25, 25, 7], [36, 36, 2]):
            for reference_frames in (0, 1, 40, 500):
                with self.subTest(sizes=sizes, reference_frames=reference_frames):
                    flat = torch.arange(sum(sizes) * 2).reshape(-1, 2)
                    pieces = list(flat.split(sizes))
                    reference = torch.full((reference_frames, 2), -5) if reference_frames else None
                    expected_inputs, expected_pcm = original_decode(pieces, reference, sizes[0])
                    candidate_inputs, candidate_pcm = original_decode(pieces, reference, sizes[0], bounded=True)
                    for a, b in zip(candidate_inputs, expected_inputs):
                        self.assertTrue(torch.equal(a, b))
                    for a, b in zip(candidate_pcm, expected_pcm):
                        np.testing.assert_array_equal(a, b)
                    received = []
                    def decode(data):
                        codes = data['audio_codes'][0]
                        received.append(codes.clone())
                        return [fake_pcm(codes)], 24000
                    nested = SimpleNamespace(speech_tokenizer=SimpleNamespace(decode=decode))
                    wrapper = FasterQwen3TTS(SimpleNamespace(sample_rate=24000), None, None, device='cpu')
                    install(wrapper, 'legacy')
                    prepared = (nested, None, None, None, None, None, None, reference)
                    with patch.object(wrapper, '_prepare_generation', return_value=prepared), patch(
                        'qwen.streaming.parity_generate_streaming',
                        return_value=iter((piece, {'steps': i}) for i, piece in enumerate(pieces)),
                    ):
                        actual = list(wrapper.generate_voice_clone_streaming('text', 'English', chunk_size=sizes[0]))
                    self.assertEqual(len(received), len(expected_inputs))
                    for a, b in zip(received, expected_inputs):
                        self.assertTrue(torch.equal(a, b))
                    for (pcm, sr, timing), expected in zip(actual, expected_pcm):
                        np.testing.assert_array_equal(pcm, expected)
                        self.assertEqual(sr, 24000)

    def test_tail_storage_and_total_are_bounded_after_calibration(self):
        history = CodecHistory()
        for i in range(100):
            piece = torch.ones(12, 16, dtype=torch.long)
            assembled = history.append(piece, i >= 3)
            self.assertEqual(history.total_frames, (i + 1) * 12)
            if i >= 3:
                self.assertLessEqual(len(assembled), 37)
                self.assertEqual(history._pieces, [])
                self.assertEqual(history._tail.untyped_storage().nbytes(), 25 * 16 * 8)


if __name__ == '__main__':
    unittest.main()
