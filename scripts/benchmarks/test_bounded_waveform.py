from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np
import torch

from experimental_bounded_waveform import bounded_waveform_stream


class BoundedWaveformTests(unittest.TestCase):
    def tokenizer(self, stride=7, deficit=0):
        calls = []
        def decode(data):
            codes = data['audio_codes'][0]
            calls.append(codes.clone())
            audio = np.repeat(codes[:, 0].numpy().astype(np.float32), stride)
            return [audio[:len(audio) - deficit] if deficit else audio], 24000
        return SimpleNamespace(model=SimpleNamespace(decode_upsample_rate=stride,
            decoder=SimpleNamespace(total_upsample=stride)), decode=decode), calls

    def test_sample_counts_cropping_context_transition_and_partial_final_piece(self):
        for sizes in ([1], [12, 1], [12, 12, 12, 12, 3], [25, 25, 2], [36, 36, 1]):
            for ref_len in (0, 1, 24, 25, 40, 500):
                with self.subTest(sizes=sizes, reference=ref_len):
                    tokenizer, calls = self.tokenizer()
                    generated = torch.arange(sum(sizes)).reshape(-1, 1).repeat(1, 16)
                    pieces = list(generated.split(sizes))
                    reference = torch.full((ref_len, 16), -10) if ref_len else None
                    source = iter((p, {'piece': i}) for i, p in enumerate(pieces))
                    output = list(bounded_waveform_stream(source, tokenizer, reference, sizes[0]))
                    self.assertEqual(len(output), len(sizes))
                    for index, ((audio, sr, timing), piece) in enumerate(zip(output, pieces)):
                        np.testing.assert_array_equal(audio, np.repeat(piece[:, 0].numpy(), 7))
                        self.assertEqual(sr, 24000)
                        self.assertEqual(timing, {'piece': index})
                        previous = generated[:sum(sizes[:index])]
                        all_previous = torch.cat((reference, previous)) if reference is not None else previous
                        expected = torch.cat((all_previous[-25:], piece))
                        self.assertTrue(torch.equal(expected, calls[index]))
                        self.assertLessEqual(len(calls[index]), 25 + len(piece))

    def test_short_or_excess_decoder_output_is_rejected_without_corrupt_audio(self):
        for deficit in (1, -1):
            tokenizer, _ = self.tokenizer()
            original = tokenizer.decode
            def decode(data):
                audio, sr = original(data)
                return [audio[0][:-1] if deficit == 1 else np.append(audio[0], 0)], sr
            tokenizer.decode = decode
            stream = bounded_waveform_stream(iter([(torch.ones(1, 16), {})]), tokenizer, None)
            with self.assertRaisesRegex(RuntimeError, 'Refusing to drop or fabricate'):
                next(stream)

    def test_unverified_stride_fails_and_closes_source(self):
        tokenizer, _ = self.tokenizer()
        tokenizer.model.decoder.total_upsample = 8
        source = Mock()
        with self.assertRaisesRegex(RuntimeError, 'sample stride'):
            next(bounded_waveform_stream(source, tokenizer, None))
        source.close.assert_called_once()

    def test_cancellation_closes_source_without_decoding_another_piece(self):
        tokenizer, calls = self.tokenizer()
        closed = []
        def source():
            try:
                yield torch.ones(12, 16), {}
                self.fail('Canceled stream requested another codec piece')
            finally:
                closed.append(True)
        with patch('torch.cuda.Event', side_effect=AssertionError('No timing in ordinary decoding')):
            stream = bounded_waveform_stream(source(), tokenizer, None)
            next(stream)
            stream.close()
        self.assertEqual(closed, [True])
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
