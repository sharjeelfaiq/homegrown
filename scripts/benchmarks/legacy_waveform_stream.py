"""Frozen accumulated/calibrated vocoder path for reproducible comparisons.

Extracted from the committed FasterQwen3TTS streaming clone implementation.
Do not simplify its proportional slicing or calibration arithmetic: these are
part of the baseline, including any rounding behavior.
"""
import torch


def legacy_waveform_stream(source, tokenizer, reference, chunk_size=12):
    context_frames = 25
    min_calibration_frames = max(context_frames, chunk_size)
    all_codes = []
    previous = 0
    samples_per_frame = None
    try:
        for piece, timing in source:
            all_codes.append(piece)
            n_new = piece.shape[0]
            flat = torch.cat(all_codes, dim=0)
            n_total = flat.shape[0]
            if samples_per_frame is None:
                if reference is not None:
                    codes = torch.cat((reference.to(flat.device), flat), dim=0)
                else:
                    codes = flat
                audio_list, sr = tokenizer.decode({'audio_codes': codes.unsqueeze(0)})
                audio = audio_list[0]
                if hasattr(audio, 'cpu'):
                    audio = audio.flatten().cpu().numpy()
                else:
                    audio = audio.flatten() if hasattr(audio, 'flatten') else audio
                if reference is not None:
                    ref_len = reference.shape[0]
                    total_len = codes.shape[0]
                    cut = int(ref_len / max(total_len, 1) * len(audio))
                    generated = audio[cut:]
                else:
                    generated = audio
                new_audio = generated[previous:]
                previous = len(generated)
                if n_total >= min_calibration_frames:
                    samples_per_frame = len(generated) / n_total
            else:
                start = max(0, n_total - n_new - context_frames)
                window = flat[start:]
                n_context = window.shape[0] - n_new
                audio_list, sr = tokenizer.decode({'audio_codes': window.unsqueeze(0)})
                audio = audio_list[0]
                if hasattr(audio, 'cpu'):
                    audio = audio.flatten().cpu().numpy()
                else:
                    audio = audio.flatten() if hasattr(audio, 'flatten') else audio
                if n_context > 0:
                    new_audio = audio[int(round(n_context * samples_per_frame)):]
                else:
                    new_audio = audio
            yield new_audio, sr, timing
    finally:
        close = getattr(source, 'close', None)
        if close is not None:
            close()
