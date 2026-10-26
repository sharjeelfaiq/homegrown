"""GPU waveform replay inside the owning benchmark's lock, model and budget."""
import json
import time
from unittest.mock import patch


class ReplayDeferred(Exception):
    pass


def replay(tts, legacy_stream, baseline, output, deadline, monitor, candidate_decoder='bounded'):
    import numpy as np
    import soundfile as sf
    import torch
    import qwen.streaming as streaming
    from qwen.waveform_stream import prefix_skipping_waveform_stream, decoder_stride
    from experimental_bounded_waveform import bounded_waveform_stream
    from replay_codec_history import groups

    report = dict(complete=False, candidate_decoder=candidate_decoder, length_probes=[], cases=[], listening_assessed=False)
    baseline_report = json.loads((baseline / 'report.json').read_text())
    def save():
        (output / 'waveform-replay.json').write_text(json.dumps(report, indent=2))
    def check():
        if time.monotonic() >= deadline:
            raise ReplayDeferred('budget-expired')
        if monitor.interfered.is_set():
            raise ReplayDeferred('backend-reappeared')
    tokenizer = tts.speech_tokenizer
    stride = decoder_stride(tokenizer)

    def decode_group(pieces, reference, bounded):
        calls, events, result = [], [], []
        block_calls, block_events, block_inputs = [], [], []
        original_decode = tokenizer.decode
        original_forward = tokenizer.model.decoder.forward
        def measured_forward(codes, *args, **kwargs):
            check()
            a, b = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
            a.record()
            start = time.perf_counter()
            values = original_forward(codes, *args, **kwargs)
            b.record()
            block_calls.append(dict(input_frames=int(codes.shape[-1]), output_samples=values.numel(),
                                    wall_s=time.perf_counter() - start))
            block_events.append((a, b))
            block_inputs.append(codes.detach().clone())
            return values
        def measured_decode(data):
            check()
            a, b = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
            a.record()
            start = time.perf_counter()
            decoded = original_decode(data)
            b.record()
            calls.append(dict(input_frames=int(data['audio_codes'].shape[1]),
                              output_samples=len(decoded[0][0]), wall_s=time.perf_counter() - start))
            events.append((a, b))
            return decoded
        source = lambda **kwargs: iter((piece, {}) for piece in pieces)
        torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize()
        start = time.perf_counter()
        with patch.object(tokenizer, 'decode', measured_decode), patch.object(
            tokenizer.model.decoder, 'forward', measured_forward,
        ):
            if bounded:
                function = prefix_skipping_waveform_stream if candidate_decoder == 'prefix-skip' else bounded_waveform_stream
                stream = function(source(), tokenizer, reference)
                try:
                    result = [audio.copy() for audio, _, _ in stream]
                finally:
                    stream.close()
            else:
                nested = tts.model.model
                prepared = (nested, nested.talker, nested.config.talker_config,
                            None, None, None, None, reference)
                with patch.object(tts, '_prepare_generation', return_value=prepared), patch.object(
                    streaming, 'fast_generate_streaming', source,
                ):
                    stream = legacy_stream(text='replayed tokens', language='English')
                    try:
                        result = [audio.copy() for audio, _, _ in stream]
                    finally:
                        stream.close()
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - start
        for call, (a, b) in zip(calls, events):
            call['cuda_ms'] = a.elapsed_time(b)
        for call, (a, b) in zip(block_calls, block_events):
            call['cuda_ms'] = a.elapsed_time(b)
        return result, dict(wall_s=elapsed, calls=calls, blocks=block_calls,
            _block_inputs=[t.cpu() for t in block_inputs],
            peak_allocated_bytes=torch.cuda.max_memory_allocated(),
            peak_reserved_bytes=torch.cuda.max_memory_reserved())

    try:
        first_tokens = torch.load(baseline / 'first-codec.pt', map_location='cpu', weights_only=True)
        # Include short, odd, context-boundary and internal launch-boundary lengths.
        fixture = torch.cat(first_tokens).to(tts.device)
        for length in (1, 2, 3, 12, 13, 24, 25, 26, 36, 37, 100, 101, 125):
            check()
            torch.cuda.synchronize()
            start = time.perf_counter()
            audio, sr = tokenizer.decode({'audio_codes': fixture[:length].unsqueeze(0)})
            torch.cuda.synchronize()
            report['length_probes'].append(dict(frames=length, samples=len(audio[0]),
                expected=length * stride, sample_rate=sr, wall_s=time.perf_counter() - start))
            save()
            if len(audio[0]) != length * stride:
                raise RuntimeError('Installed decoder does not satisfy the proposed stride contract')

        for case in ('first', 'warm-1'):
            run = next((r for r in baseline_report['runs'] if r['case'] == case and r['complete']), None)
            if run is None:
                continue
            tokens = torch.load(baseline / f'{case}-codec.pt', map_location='cpu', weights_only=True)
            references = torch.load(baseline / f'{case}-references.pt', map_location='cpu', weights_only=True)
            token_groups = groups(run, tokens)
            if len(token_groups) != len(references):
                raise RuntimeError('Reference/captured-token group counts differ')
            stitched = {'legacy': [], 'bounded': []}
            for index, (pieces, reference) in enumerate(zip(token_groups, references)):
                check()
                pieces = [p.to(tts.device) for p in pieces]
                reference = reference.to(tts.device) if reference is not None else None
                results = {}
                # Alternate order between chunks; each pair uses identical tokens.
                for bounded in ((False, True) if index % 2 == 0 else (True, False)):
                    check()
                    name = 'bounded' if bounded else 'legacy'
                    audio, timing = decode_group(pieces, reference, bounded)
                    pcm = np.concatenate(audio)
                    seams = np.cumsum([len(a) for a in audio])[:-1]
                    results[name] = dict(**timing, samples=len(pcm),
                        piece_samples=[len(a) for a in audio], finite=bool(np.isfinite(pcm).all()),
                        clipping_fraction=float(np.mean(np.abs(pcm) >= 1)),
                        peak=float(np.max(np.abs(pcm))), rms=float(np.sqrt(np.mean(pcm ** 2))),
                        boundary_steps=[float(abs(pcm[s] - pcm[s - 1])) for s in seams],
                        boundary_positions=seams.tolist())
                    stitched[name].append(pcm)
                    sf.write(output / f'replay-{case}-{index}-{name}.wav', pcm, 24000, subtype='FLOAT')
                    results[name]['_pieces'] = audio
                old = results['legacy'].pop('_pieces')
                new = results['bounded'].pop('_pieces')
                old_inputs = results['legacy'].pop('_block_inputs')
                new_inputs = results['bounded'].pop('_block_inputs')
                cursor, matching = 0, True
                for codes in new_inputs:
                    while cursor < len(old_inputs) and not torch.equal(old_inputs[cursor], codes):
                        cursor += 1
                    if cursor == len(old_inputs):
                        matching = False
                        break
                    cursor += 1
                results['new_block_inputs_are_legacy_subsequence'] = matching
                results['piece_comparisons'] = [dict(index=i, equal_samples=len(a) == len(b),
                    exact=bool(np.array_equal(a, b)),
                    rms_difference=float(np.sqrt(np.mean((a[:min(len(a), len(b))] - b[:min(len(a), len(b))]) ** 2))))
                    for i, (a, b) in enumerate(zip(old, new))]
                # A bounded speaker-consistency proxy for the changed onset,
                # using existing weights, not an additional downloaded model.
                extract = getattr(tts.model.model, 'extract_speaker_embedding', None)
                if extract is not None:
                    embeddings = []
                    for audio in (old, new):
                        check()
                        onset = np.concatenate(audio[:3]).astype(np.float32)
                        with torch.inference_mode():
                            embeddings.append(extract(onset, 24000).float().flatten())
                    torch.cuda.synchronize()
                    results['onset_speaker_cosine'] = float(torch.nn.functional.cosine_similarity(
                        embeddings[0], embeddings[1], dim=0).item())
                report['cases'].append(dict(case=case, chunk=index, **results))
                save()
            from homegrown_api.audio.stitcher import stitch_audio
            for name, audio in stitched.items():
                sf.write(output / f'replay-{case}-{name}.wav', stitch_audio(audio, 24000),
                         24000, subtype='FLOAT')
        report['complete'] = True
    except ReplayDeferred as exc:
        report['deferred'] = str(exc)
    finally:
        save()
    return report
