"""CPU-only replay of captured tokens through old/new decoder-input assembly."""
import argparse
import json
from pathlib import Path


def replay(pieces, torch):
    from codec_history_candidate import CodecHistory
    candidate = CodecHistory()
    old, calibrated, checked = [], False, 0
    for piece in pieces:
        old.append(piece)
        accumulated = torch.cat(old)
        expected = accumulated if not calibrated else accumulated[max(0, len(accumulated) - len(piece) - 25):]
        actual = candidate.append(piece, calibrated)
        if not torch.equal(expected, actual):
            raise AssertionError('Decoder inputs differ')
        checked += 1
        # Calibration depends on token count, not on decoder output values.
        calibrated = calibrated or candidate.total_frames >= max(25, len(pieces[0]))
    return checked


def groups(run, tokens):
    # New reports store explicit group starts. For early captures, reconstruct
    # them from the preparation/vocoder stage order (one vocoder call per piece).
    starts = run.get('token_group_starts')
    if starts is None:
        starts, cursor = [], 0
        for stage in run['stages']:
            if stage['stage'] == 'input_preparation_inclusive':
                starts.append(cursor)
            elif stage['stage'] == 'vocoder':
                cursor += 1
        if cursor != len(tokens):
            raise ValueError('Incomplete capture cannot reconstruct chunk boundaries')
    return [tokens[a:b] for a, b in zip(starts, starts[1:] + [len(tokens)]) if b > a]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path)
    args = parser.parse_args()
    import torch
    import numpy as np
    import soundfile as sf
    results = {'device': 'cpu', 'listening_assessed': False, 'cases': []}
    reports = [json.loads((p / 'report.json').read_text()) for p in (args.baseline, args.candidate)]
    for run in reports[0]['runs']:
        case = run['case']
        match = next((r for r in reports[1]['runs'] if r['case'] == case), None)
        if not match or not run['complete'] or not match['complete']:
            continue
        captures = [torch.load(p / f'{case}-codec.pt', map_location='cpu', weights_only=True)
                    for p in (args.baseline, args.candidate)]
        checked = [sum(replay(group, torch) for group in groups(r, t))
                   for r, t in zip((run, match), captures)]
        same_tokens = len(captures[0]) == len(captures[1]) and all(
            torch.equal(a, b) for a, b in zip(*captures))
        audio = [sf.read(p / f'{case}-listening.mp3', dtype='float32')[0]
                 for p in (args.baseline, args.candidate)]
        results['cases'].append(dict(case=case, decoder_inputs_exact=True,
            checked_piece_counts=checked, sampled_tokens_identical=same_tokens,
            decoded_mp3_pcm_identical=bool(np.array_equal(*audio)),
            output_samples=[len(a) for a in audio],
            max_adjacent_sample_step=[float(np.max(np.abs(np.diff(a, axis=0)))) for a in audio],
            peak_amplitude=[float(np.max(np.abs(a))) for a in audio],
            rms=[float(np.sqrt(np.mean(a ** 2))) for a in audio]))
    results['reference_context'] = 'Unchanged common prefix during calibration; generated inputs replayed exactly. Fake-decoder tests separately cover reference prefixes and PCM slicing.'
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
