"""Summarize paired manifests without printing private text."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import statistics


def summarize(directory):
    report = json.loads((directory / 'report.json').read_text())
    warm = [r for r in report['runs'] if r['case'].startswith('warm-') and r['complete']]
    result = {'phase': report['phase'], 'load_s': report['load_s'],
              'runs': [{k: r.get(k) for k in ['case', 'complete', 'processing_s', 'duration_s',
                       'rtf', 'retries', 'generated_tokens', 'peak_allocated_bytes',
                       'peak_reserved_bytes', 'finite', 'clipping_fraction']} for r in report['runs']]}
    result['complete_warm_runs'] = len(warm)
    result['interference'] = report.get('interference')
    validity = directory / 'validity.json'
    result['validity'] = json.loads(validity.read_text()) if validity.exists() else None
    if warm:
        for field in ['processing_s', 'duration_s', 'rtf', 'peak_allocated_bytes', 'peak_reserved_bytes']:
            values = [r[field] for r in warm]
            result[field] = dict(median=statistics.median(values), min=min(values), max=max(values))
        stages = defaultdict(list)
        for run in warm:
            totals = defaultdict(float)
            for stage in run['stages']:
                totals[stage['stage']] += stage['wall_s']
            for stage, total in totals.items():
                stages[stage].append(total)
        result['inclusive_stage_wall_s_medians_do_not_sum'] = {
            name: statistics.median(values) for name, values in stages.items()}
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('candidate', type=Path, nargs='?')
    args = parser.parse_args()
    baseline = summarize(args.baseline)
    results = {'baseline': baseline}
    if args.candidate:
        if json.loads((args.baseline / 'manifest.json').read_text()) != json.loads((args.candidate / 'manifest.json').read_text()):
            raise ValueError('Manifests differ; comparison refused')
        candidate = summarize(args.candidate)
        results['candidate'] = candidate
        results['comparison_eligible'] = all(
            phase['complete_warm_runs'] >= 3 and not phase['interference']
            and not (phase['validity'] and not phase['validity']['valid_comparison'])
            for phase in (baseline, candidate)
        )
        results['speedup_claim_supported'] = False
        if 'processing_s' in candidate and 'processing_s' in baseline:
            results['observed_median_change_percent_not_speedup'] = 100 * (
                candidate['processing_s']['median'] / baseline['processing_s']['median'] - 1)
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
