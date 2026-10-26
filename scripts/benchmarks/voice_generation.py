"""Offline, isolated voice pipeline benchmark. See voice_generation.md.

Only the standard library is imported until storage has been redirected.
No application startup/lifespan or queue restoration is invoked.
"""
import argparse
from contextlib import ExitStack
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def isolate(output):
    """Must run before importing stores, worker or boot-status owners."""
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_DATASETS_OFFLINE='1')
    os.environ['HOMEGROWN_STORAGE_DIR'] = str(output / 'storage')
    sys.path.insert(0, str(ROOT / 'services/voice-api'))
    sys.path.insert(0, str(ROOT / 'engine'))
    from homegrown_api import config
    config.STORAGE_DIR = output / 'storage'
    for name, relative in [('REF_DIR', 'references'), ('GEN_DIR', 'generated'),
                           ('PRESETS_FILE', 'presets.json'), ('HISTORY_FILE', 'history.json'),
                           ('QUEUE_FILE', 'queue.json')]:
        setattr(config, name, config.STORAGE_DIR / relative)
    config.REF_DIR.mkdir(parents=True, exist_ok=True)
    config.GEN_DIR.mkdir(parents=True, exist_ok=True)
    return config


class BudgetExpired(BaseException):
    pass


class BackendReappeared(BaseException):
    pass


class BackendMonitor:
    """Poll outside the measured inference thread; never stop application jobs."""
    def __init__(self):
        self.interfered = threading.Event()
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self.poll, daemon=True)

    def poll(self):
        while not self.stopped.wait(1):
            if backend_reachable():
                self.interfered.set()
                return

    def close(self):
        self.stopped.set()
        self.thread.join(timeout=1)


class Measurements:
    """Benchmark-only events; nested stages are inclusive, never additive."""
    def __init__(self, torch, deadline, monitor=None):
        self.torch, self.deadline = torch, deadline
        self.monitor = monitor
        self.records = []
        self.tokens = []
        self.token_group_starts = []
        self.final_pcm = None
        self.final_sample_rate = None

    def wrap(self, name, fn):
        def measured(*args, **kwargs):
            if name == 'input_preparation_inclusive':
                self.token_group_starts.append(len(self.tokens))
            if name == 'encoding':
                self.final_pcm, self.final_sample_rate = args[:2]
            start = self.torch.cuda.Event(enable_timing=True)
            end = self.torch.cuda.Event(enable_timing=True)
            start.record()
            wall = time.perf_counter()
            try:
                return fn(*args, **kwargs)
            finally:
                end.record()
                self.records.append((name, time.perf_counter() - wall, start, end))
        return measured

    def stream(self, fn):
        def measured(**kwargs):
            source = fn(**kwargs)
            try:
                while True:
                    if time.monotonic() >= self.deadline:
                        raise BudgetExpired()
                    if self.monitor and self.monitor.interfered.is_set():
                        raise BackendReappeared()
                    try:
                        item = self.wrap('codec_next_inclusive', next)(source)
                    except StopIteration:
                        return
                    self.tokens.append(item[0].detach().clone())
                    yield item
            finally:
                source.close()
        return measured

    def resolve(self):
        self.torch.cuda.synchronize()
        return [{'stage': name, 'wall_s': wall, 'cuda_ms': a.elapsed_time(b)}
                for name, wall, a, b in self.records]


def live_idle(origin):
    try:
        with urllib.request.urlopen(origin + '/api/queue', timeout=3) as response:
            queue = json.load(response)['queue']
    except urllib.error.HTTPError:
        return False  # Reachable, but unable to verify idle (e.g. startup).
    except OSError:
        return None
    return not any(j['status'] in ('queued', 'running', 'canceling') for j in queue)


def backend_reachable():
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=0.5):
            return True
    except urllib.error.HTTPError:
        return True
    except OSError:
        return False


def freeze_inputs(output, baseline):
    inputs = output / 'inputs'
    inputs.mkdir()
    if baseline:
        source = baseline / 'inputs'
        for path in source.iterdir():
            shutil.copy2(path, inputs / path.name)
        manifest = json.loads((baseline / 'manifest.json').read_text())
        for name, expected in manifest['input_hashes'].items():
            if digest(inputs / name) != expected:
                raise ValueError('Baseline inputs changed')
        return manifest
    storage = ROOT / 'services/voice-api/storage'
    history = json.loads((storage / 'history.json').read_text(encoding='utf-8'))
    presets = json.loads((storage / 'presets.json').read_text(encoding='utf-8'))
    from homegrown_api.persistence.media_paths import resolve_stored_media_path
    import soundfile as sf
    for entry in history:
        if len(entry.get('text', '')) != 479:
            continue
        preset = next((p for p in presets if p['id'] == entry['preset_id']), None)
        if preset is None:
            continue
        reference = resolve_stored_media_path(preset['audio_path'], storage)
        if abs(sf.info(reference).duration - 40) > 0.1:
            continue
        reference_name = 'reference' + reference.suffix
        shutil.copy2(reference, inputs / reference_name)
        private = dict(text=entry['text'], ref_text=preset['ref_text'],
                       language=entry['language'], style=entry['style'], stability=entry['stability'],
                       reference=reference_name)
        (inputs / 'input.json').write_text(json.dumps(private), encoding='utf-8')
        return dict(input_hashes={p.name: digest(p) for p in inputs.iterdir()},
                    reference_duration_s=sf.info(reference).duration, script_chars=479,
                    seeds=[1729, 1730, 1731, 1732, 1733])
    raise ValueError('No matching 479-character history script with a 40-second reference')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['baseline', 'candidate'], required=True)
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--budget-seconds', type=int, default=600)
    args = parser.parse_args()
    if not 1 <= args.budget_seconds <= 600:
        parser.error('Each phase must use 1..600 seconds (20 minutes total approved)')
    if (args.phase == 'candidate') != bool(args.baseline):
        parser.error('Candidate requires --baseline; baseline must omit it')
    output = args.output.resolve()
    allowed = (ROOT / '.tmp/voice-speed').resolve()
    if allowed not in output.parents or output.exists():
        parser.error('Use a fresh output directory under .tmp/voice-speed')
    # Refuse concurrent inference even if the live application is idle.
    if backend_reachable():
        parser.error('Backend is reachable; stop it only after confirming its live queue is idle')
    allowed.mkdir(parents=True, exist_ok=True)
    lock = allowed / 'benchmark.lock'
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        parser.error('Another benchmark owns benchmark.lock; investigate before removing it')
    os.close(fd)
    monitor = BackendMonitor()
    monitor.thread.start()
    try:
        output.mkdir()
        config = isolate(output)
        if not Path(config.MODEL_PATH).is_dir():
            raise ValueError('Local model directory is required; downloads are forbidden')
        manifest = freeze_inputs(output, args.baseline)
        model_hashes = {str(p.relative_to(config.MODEL_PATH)): digest(p)
                        for p in sorted(Path(config.MODEL_PATH).rglob('*'))
                        if p.is_file() and p.suffix in ('.json', '.safetensors')}
        if args.baseline and manifest['model_hashes'] != model_hashes:
            raise ValueError('Model/configuration differs from baseline')
        manifest['model_hashes'] = model_hashes
        private = json.loads((output / 'inputs/input.json').read_text(encoding='utf-8'))
        reference = config.REF_DIR / private['reference']
        shutil.copy2(output / 'inputs' / private['reference'], reference)
        from homegrown_api.generation import budget, model, text_chunker, worker
        from homegrown_api.persistence import stores
        import qwen.streaming as streaming
        import torch
        import numpy as np
        import soundfile as sf
        preset = dict(id='benchmark', name='benchmark', user_id='local-user',
                      audio_path='references/' + reference.name, ref_text=private['ref_text'])
        stores._presets = [preset]
        facts = budget._seq_budget(preset)
        chunks = text_chunker.chunk_text(private['text'], facts.chunk_chars)
        settings = dict(chunk_hashes=[hashlib.sha256(c.encode()).hexdigest() for c in chunks],
                        chunk_chars=[len(c) for c in chunks],
                        token_caps=[budget._chunk_token_cap(facts, c) for c in chunks],
                        sampling=config.STABILITY_PARAMS[private['stability']],
                        style=private['style'], language=private['language'],
                        max_seq_len=config.MAX_SEQ_LEN, dtype='bfloat16', attention='sdpa')
        from qwen import FasterQwen3TTS
        settings['stream_defaults'] = {
            name: parameter.default for name, parameter in
            inspect.signature(FasterQwen3TTS.generate_voice_clone_streaming).parameters.items()
            if parameter.default is not inspect.Parameter.empty
        }
        if args.baseline and manifest['settings'] != settings:
            raise ValueError('Generation settings/chunking differ from baseline')
        manifest['settings'] = settings
        (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
        source_hashes = {str(p.relative_to(ROOT)): digest(p) for p in
                         [*sorted((ROOT / 'engine/qwen').glob('*.py')), Path(__file__)]}
        report = dict(phase=args.phase, source_hashes=source_hashes,
                      platform=platform.platform(), python=sys.version,
                      versions={n: importlib.metadata.version(n) for n in
                                ['torch', 'transformers', 'qwen-tts', 'numpy', 'soundfile']},
                      nvidia_smi=subprocess.run(['nvidia-smi'], capture_output=True, text=True).stdout,
                      torch_cuda=torch.version.cuda, runs=[], stage_semantics='Inclusive nested timings; never sum. Existing stream timing dictionaries include consumer pauses and are not aggregated.',
                      queue_wait_s=0, listening_assessed=False)
        def save():
            (output / 'report.json').write_text(json.dumps(report, indent=2))
        deadline = time.monotonic() + args.budget_seconds
        start = time.perf_counter()
        if monitor.interfered.is_set():
            report['interference'] = 'Backend reappeared before loading; benchmark deferred'
            report['load_s'] = None
            save()
            return
        model.probe_device()
        if model._device != 'cuda':
            raise ValueError('CUDA required for comparable benchmark')
        model.load_model()
        torch.cuda.synchronize()
        report['load_s'] = time.perf_counter() - start
        report['gpu'] = torch.cuda.get_device_name()
        save()
        if monitor.interfered.is_set():
            report['interference'] = 'Backend reappeared during loading; benchmark deferred'
            save()
            return
        if args.phase == 'candidate' and time.monotonic() < deadline:
            from candidate_diagnostics import run as diagnostics
            report['independent_microbenchmarks'] = diagnostics(torch)
            save()
        for index, case in enumerate(['first', 'warm-1', 'warm-2', 'warm-3', 'single-chunk']):
            if time.monotonic() >= deadline:
                break
            if monitor.interfered.is_set():
                report['interference'] = 'Backend reappeared; benchmark deferred without canceling application jobs'
                break
            seed = manifest['seeds'][index]
            torch.manual_seed(seed)
            np.random.seed(seed)
            torch.cuda.reset_peak_memory_stats()
            measurements = Measurements(torch, deadline, monitor)
            tts = model._tts
            before_cache = len(tts._voice_prompt_cache)
            job_id = case
            selected = chunks[:1] if case == 'single-chunk' else chunks
            worker._jobs[job_id] = dict(preset_id='benchmark', preset_name='benchmark',
                user_id='local-user', text=' '.join(selected), language=private['language'],
                style=private['style'], stability=private['stability'], chunks=selected,
                total_chunks=len(selected), chunks_done=0, status='queued',
                submitted_at=time.time(), started_at=None, finished_at=None)
            run = dict(case=case, seed=seed, warmed_up=tts._warmed_up,
                       cache_entries_before=before_cache, complete=False)
            report['runs'].append(run)
            torch.cuda.synchronize()
            start = time.perf_counter()
            try:
                with ExitStack() as stack:
                    targets = [(tts, '_prepare_generation', 'input_preparation_inclusive'),
                               (tts, '_warmup', 'graph_capture'),
                               (tts, '_resolve_voice_clone_prompt_from_reference', 'prompt_resolution'),
                               (tts.model, 'create_voice_clone_prompt', 'prompt_creation_cache_miss'),
                               (tts, '_build_talker_inputs_local', 'input_assembly'),
                               (tts.model.model.talker, 'forward', 'prefill'),
                               (tts.speech_tokenizer, 'decode', 'vocoder'),
                               (worker.audio_stitcher, 'trim_edge_silence', 'trimming'),
                               (worker.audio_stitcher, 'stitch_audio', 'stitching_inclusive'),
                               (worker.audio_convert, 'write_mp3', 'encoding'),
                               (stores, '_save_json', 'persistence'),
                               (torch.Tensor, 'cpu', 'transfer_to_cpu')]
                    for owner, attr, label in targets:
                        stack.enter_context(patch.object(owner, attr, measurements.wrap(label, getattr(owner, attr))))
                    stack.enter_context(patch.object(streaming, 'fast_generate_streaming',
                                                    measurements.stream(streaming.fast_generate_streaming)))
                    worker._process_job(job_id)
                run['complete'] = worker._jobs[job_id]['status'] == 'done'
                run['status'] = worker._jobs[job_id]['status']
            except BudgetExpired:
                run['status'] = 'budget-expired'
            except BackendReappeared:
                run['status'] = 'backend-reappeared'
                report['interference'] = 'Backend reappeared; comparison invalid'
            finally:
                run['stages'] = measurements.resolve()
                run['processing_s'] = time.perf_counter() - start
                run['peak_allocated_bytes'] = torch.cuda.max_memory_allocated()
                run['peak_reserved_bytes'] = torch.cuda.max_memory_reserved()
                run['generated_tokens'] = sum(t.shape[0] for t in measurements.tokens)
                run['token_group_starts'] = measurements.token_group_starts
                run['attempts'] = sum(r['stage'] == 'input_preparation_inclusive' for r in run['stages'])
                run['retries'] = max(0, run['attempts'] - len(selected))
                run['prompt_cache_misses'] = sum(r['stage'] == 'prompt_creation_cache_miss' for r in run['stages'])
                run['prompt_cache_hits'] = sum(r['stage'] == 'prompt_resolution' for r in run['stages']) - run['prompt_cache_misses']
                job = worker._jobs[job_id]
                run['queue_wait_s'] = max(0, job['started_at'] - job['submitted_at']) if job['started_at'] else None
                if measurements.tokens:
                    torch.save([t.cpu() for t in measurements.tokens], output / f'{case}-codec.pt')
                if run['complete']:
                    entry = stores._history[0]
                    audio_path = config.GEN_DIR / Path(entry['audio_url']).name
                    audio, sr = sf.read(audio_path, dtype='float32')
                    run.update(output_samples=len(audio), duration_s=len(audio) / sr,
                               rtf=run['processing_s'] / (len(audio) / sr),
                               finite=bool(np.isfinite(audio).all()),
                               clipping_fraction=float(np.mean(np.abs(audio) >= 1)))
                    shutil.copy2(audio_path, output / f'{case}-listening.mp3')
                    if measurements.final_pcm is not None:
                        sf.write(output / f'{case}-listening.wav', measurements.final_pcm,
                                 measurements.final_sample_rate, subtype='FLOAT')
                save()
            if report.get('interference'):
                break
        report['budget_exhausted'] = time.monotonic() >= deadline
        save()
        print(str(output / 'report.json'))
    finally:
        monitor.close()
        lock.unlink()


if __name__ == '__main__':
    main()
