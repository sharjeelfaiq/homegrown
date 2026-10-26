from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np
import torch

from bounded_waveform_candidate import install
from qwen import FasterQwen3TTS


class CandidateWrapperTests(unittest.TestCase):
    def test_preserves_full_conditioning_and_sampling_options(self):
        reference = torch.ones(500, 16, dtype=torch.long)
        tokenizer = SimpleNamespace(model=SimpleNamespace(decode_upsample_rate=7,
            decoder=SimpleNamespace(total_upsample=7)),
            decode=lambda data: ([np.zeros(data['audio_codes'].shape[1] * 7)], 24000))
        wrapper = FasterQwen3TTS(SimpleNamespace(sample_rate=24000), None, None, device='cpu')
        prepared = (SimpleNamespace(speech_tokenizer=tokenizer), 'talker', 'config',
                    'tie', 'tam', 'tth', 'tpe', reference)
        install(wrapper)
        with patch.object(wrapper, '_prepare_generation', return_value=prepared) as prepare, patch(
            'qwen.streaming.parity_generate_streaming',
            return_value=iter([(torch.ones(12, 16, dtype=torch.long), {})]),
        ) as source:
            output = list(wrapper.generate_voice_clone_streaming('script', 'English',
                ref_audio='unchanged.wav', ref_text='full reference transcript',
                max_new_tokens=258, temperature=0.5, top_p=0.85, top_k=30,
                do_sample=False, repetition_penalty=1.1, instruct='instruction'))
        self.assertEqual(len(output), 1)
        self.assertEqual(len(output[0][0]), 12 * 7)
        self.assertEqual(prepare.call_args.kwargs, dict(text='script', language='English',
            ref_audio='unchanged.wav', ref_text='full reference transcript',
            xvec_only=False, append_silence=True, voice_clone_prompt=None,
            instruct='instruction', non_streaming_mode=False))
        options = source.call_args.kwargs
        self.assertEqual(options['max_new_tokens'], 258)
        self.assertEqual(options['chunk_size'], 12)
        self.assertEqual(options['temperature'], 0.5)
        self.assertEqual(options['top_p'], 0.85)
        self.assertEqual(options['top_k'], 30)
        self.assertFalse(options['do_sample'])
        self.assertEqual(options['repetition_penalty'], 1.1)
        self.assertEqual(reference.shape[0], 500)


if __name__ == '__main__':
    unittest.main()
