"""Stream unchanged generated PCM without decoding discarded reference blocks.

The autoregressive prompt and vocoder block alignment are untouched.
No timing events or explicit synchronization belong in this module.
"""
import numpy as np
import torch
import inspect


def decoder_stride(tokenizer):
    model = getattr(tokenizer, 'model', None)
    stride = getattr(model, 'decode_upsample_rate', None)
    decoder = getattr(model, 'decoder', None)
    upsample = getattr(decoder, 'total_upsample', None)
    if stride is None or upsample is None or int(stride) != stride or int(upsample) != stride or stride <= 0:
        raise RuntimeError('Cannot verify waveform decoder sample stride')
    return int(stride)


@torch.inference_mode()
def prefix_skipping_waveform_stream(source, tokenizer, reference, chunk_size=12):
    """Skip discarded prefix blocks while preserving legacy vocoder inputs.

    Calibration retains the original internal block alignment and float slicing.
    Only blocks wholly before the samples that would be yielded are omitted.
    Subsequent decoding uses the unchanged 25-frame generated-audio context.
    """
    try:
        stride = decoder_stride(tokenizer)
        decoder = tokenizer.model.decoder
        try:
            parameters = inspect.signature(decoder.chunked_decode).parameters
            block_size = int(parameters['chunk_size'].default)
            left_context = int(parameters['left_context_size'].default)
        except (KeyError, ValueError, TypeError, OverflowError) as exc:
            raise RuntimeError('Cannot verify vocoder block/context sizes') from exc
        if block_size <= 0 or left_context != 25:
            raise RuntimeError('Unsupported vocoder block/context sizes')
        context_frames = 25
        calibration_frames = max(context_frames, chunk_size)
        history, tail = [], None
        previous = total_generated = 0
        samples_per_frame = None
        for piece, timing in source:
            n_new = piece.shape[0]
            if n_new <= 0:
                raise RuntimeError('Empty codec piece cannot produce streaming audio')
            total_generated += n_new
            if samples_per_frame is None:
                history.append(piece)
                generated = torch.cat(history, dim=0)
                codes = torch.cat((reference.to(piece.device), generated), dim=0) if reference is not None else generated
                total_frames = codes.shape[0]
                total_samples = total_frames * stride
                cut = int(reference.shape[0] / max(total_frames, 1) * total_samples) if reference is not None else 0
                first_sample = cut + previous
                # Preserve the original 100-frame (or configured cap) grid.
                first_block = first_sample // (block_size * stride) * block_size
                audio_parts = []
                for start in range(first_block, total_frames, block_size):
                    end = min(start + block_size, total_frames)
                    context = min(left_context, start)
                    window = codes[start - context:end]
                    values = decoder(torch.clamp(window.unsqueeze(0).to(tokenizer.device), min=0).transpose(1, 2))
                    audio = values.flatten()
                    if audio.numel() != window.shape[0] * stride:
                        raise RuntimeError('Vocoder block length violates verified stride contract')
                    offset = context * stride + max(0, first_sample - start * stride)
                    audio_parts.append(audio[offset:])
                if audio_parts:
                    values = audio_parts[0] if len(audio_parts) == 1 else torch.cat(audio_parts)
                    # One transfer per yield even when it spans internal blocks.
                    new_audio = values.to(torch.float32).detach().cpu().numpy()
                else:
                    new_audio = np.zeros(0, dtype=np.float32)
                previous = total_samples - cut
                sr = int(tokenizer.model.get_output_sample_rate())
                tail = generated[-context_frames:].clone()
                if total_generated >= calibration_frames:
                    samples_per_frame = previous / total_generated
                    history.clear()
            else:
                window = torch.cat((tail, piece), dim=0)
                n_context = window.shape[0] - n_new
                audio_list, sr = tokenizer.decode({'audio_codes': window.unsqueeze(0)})
                audio = audio_list[0]
                if hasattr(audio, 'cpu'):
                    audio = audio.flatten().cpu().numpy()
                else:
                    audio = np.asarray(audio).reshape(-1)
                if len(audio) != window.shape[0] * stride:
                    raise RuntimeError('Waveform decoder length violates verified stride contract')
                new_audio = audio[int(round(n_context * samples_per_frame)):]
                tail = window[-context_frames:].clone()
            yield new_audio, sr, timing
    finally:
        close = getattr(source, 'close', None)
        if close is not None:
            close()
