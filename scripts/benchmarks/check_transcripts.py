"""Optional CPU-only ASR check using an already cached model; never downloads."""
import argparse
import json
import os
from pathlib import Path
import re


def word_error_rate(expected, actual):
    words = lambda text: re.findall(r"\w+", text.lower())
    reference, hypothesis = words(expected), words(actual)
    previous = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        current = [i]
        for j, right in enumerate(hypothesis, 1):
            current.append(min(previous[j] + 1, current[-1] + 1,
                               previous[j - 1] + (left != right)))
        previous = current
    return previous[-1] / max(1, len(reference))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', type=Path)
    parser.add_argument('--model', default='base')
    args = parser.parse_args()
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device='cpu', compute_type='int8',
                         local_files_only=True, cpu_threads=2, num_workers=1)
    private = json.loads((args.phase / 'inputs/input.json').read_text(encoding='utf-8'))
    report = json.loads((args.phase / 'report.json').read_text())
    results, transcripts = [], {}
    for run in report['runs']:
        if not run['complete'] or run['case'] == 'single-chunk':
            continue
        path = args.phase / f"{run['case']}-listening.mp3"
        segments, info = model.transcribe(str(path), condition_on_previous_text=False,
                                         vad_filter=True, beam_size=5)
        text = ' '.join(s.text.strip() for s in segments).strip()
        transcripts[run['case']] = text
        results.append(dict(case=run['case'], language=info.language,
                            transcript_chars=len(text), wer=word_error_rate(private['text'], text)))
    # Never print private script/transcripts to terminal or tracked reports.
    (args.phase / 'offline-transcripts.json').write_text(json.dumps(transcripts), encoding='utf-8')
    result = dict(device='cpu', model=args.model, compute_type='int8', cases=results,
                  caveat='ASR discrepancies are not proof of acoustic defects; human listening is still required')
    (args.phase / 'transcript-check.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
