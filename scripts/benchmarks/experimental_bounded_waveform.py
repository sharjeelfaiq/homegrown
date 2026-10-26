"""Rejected 25-frame-from-start candidate; changes calibration waveforms."""
import numpy as np
import torch

from qwen.waveform_stream import decoder_stride


def bounded_waveform_stream(source, tokenizer, reference, chunk_size=12, context_frames=25):
    try:
        stride = decoder_stride(tokenizer)
        tail = reference[-context_frames:] if reference is not None else None
        for piece, timing in source:
            n_new = piece.shape[0]
            if n_new <= 0:
                raise RuntimeError('Empty codec piece cannot produce streaming audio')
            if tail is None or tail.shape[0] == 0:
                codes, n_context = piece, 0
            else:
                tail = tail.to(piece.device)
                n_context = tail.shape[0]
                codes = torch.cat((tail, piece), dim=0)
            audio_list, sr = tokenizer.decode({'audio_codes': codes.unsqueeze(0)})
            audio = audio_list[0]
            if hasattr(audio, 'cpu'):
                audio = audio.flatten().cpu().numpy()
            else:
                audio = np.asarray(audio).reshape(-1)
            expected = codes.shape[0] * stride
            if len(audio) != expected:
                raise RuntimeError(
                    f'Waveform decoder returned {len(audio)} samples for {codes.shape[0]} frames; '
                    f'expected {expected}. Refusing to drop or fabricate samples.'
                )
            tail = codes[-context_frames:].clone()
            yield audio[n_context * stride:], sr, timing
    finally:
        close = getattr(source, 'close', None)
        if close is not None:
            close()
