"""Regression coverage for package boundaries, routes and shared queue state."""
import io
import json
import tempfile
import threading
import unittest
from contextlib import ExitStack
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from homegrown_api import config
from homegrown_api.app import app
from homegrown_api.generation import budget, model, worker
from homegrown_api.persistence import stores


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        for name, value in {
            'STORAGE_DIR': self.root,
            'REF_DIR': self.root / 'references',
            'GEN_DIR': self.root / 'generated',
            'QUEUE_FILE': self.root / 'queue.json',
            'PRESETS_FILE': self.root / 'presets.json',
            'HISTORY_FILE': self.root / 'history.json',
        }.items():
            self.stack.enter_context(patch.object(config, name, value))
        config.REF_DIR.mkdir()
        config.GEN_DIR.mkdir()
        for module, name, value in [
            (worker, '_jobs', {}), (worker, '_pending_job_ids', []),
            (worker, '_current_running_job_id', None),
            (worker, '_history_revision', 0),
            (config, 'ADMIN_PASSWORD', 'test-admin-password'),
            (worker, '_queue_event', threading.Event()),
            (worker, '_stop_event', threading.Event()),
            (stores, '_presets', []), (stores, '_history', []),
            (model, '_tts', None), (model, '_gpu_fault', None),
        ]:
            self.stack.enter_context(patch.object(module, name, value))
        # Do not enter TestClient's lifespan: these HTTP tests must not load a model.
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def ready_voice(self):
        fake = SimpleNamespace(sample_rate=24000)
        fake.model = SimpleNamespace(model=SimpleNamespace(config=SimpleNamespace(
            talker_config=SimpleNamespace(codec_language_id={'english': 0, 'german': 1})
        )))
        model._tts = fake
        reference = config.REF_DIR / 'voice.mp3'
        reference.write_bytes(b'fixture')
        stores._presets.append({
            'id': 'voice', 'name': 'Voice', 'user_id': 'local-user', 'language': 'English',
            'audio_path': 'references/voice.mp3', 'ref_text': 'Reference speech.',
        })
        self.stack.enter_context(patch.object(budget, '_seq_budget', return_value=budget._Budget(200, 700, 1)))
        return fake

    def submit(self, text='A script to generate.', language='English'):
        response = self.client.post('/api/generate', json={
            'preset_id': 'voice', 'text': text, 'language': language,
        })
        self.assertEqual(response.status_code, 202, response.text)
        return response.json()['job_id']

    def delete_all(self, path, password='test-admin-password'):
        headers = {} if password is None else {'X-Homegrown-Admin-Password': password}
        return self.client.delete(path, headers=headers)

    def test_all_existing_api_routes_remain_registered(self):
        expected = {
            '/api/download/{filename}': {'get'}, '/api/health': {'get'},
            '/api/languages': {'get'}, '/api/estimate': {'post'},
            '/api/presets': {'get', 'post', 'delete'},
            '/api/presets/{preset_id}': {'patch', 'delete'},
            '/api/presets/{preset_id}/download': {'get'},
            '/api/history': {'get', 'delete'}, '/api/history/zip': {'post'},
            '/api/history/{entry_id}': {'delete'}, '/api/generate': {'post'},
            '/api/jobs/{job_id}': {'get'}, '/api/queue': {'get'},
            '/api/queue/{job_id}/script': {'get'},
            '/api/queue/{job_id}/cancel': {'post'},
            '/api/queue/{job_id}/retry': {'post'},
            '/api/queue/{job_id}': {'delete'}, '/api/queue/reorder': {'post'},
        }
        paths = app.openapi()['paths']
        actual = {p: set(methods) for p, methods in paths.items() if p.startswith('/api/')}
        self.assertEqual(actual, expected)

    def test_health_reports_the_loaded_model_without_exposing_its_path(self):
        loaded_model = SimpleNamespace(
            tts_model_type='base',
            config=SimpleNamespace(_name_or_path=None),
        )
        model._tts = SimpleNamespace(
            sample_rate=24000,
            model=SimpleNamespace(model=loaded_model),
        )
        with patch.object(
            config,
            'MODEL_PATH',
            r'D:\models_cache\models--Qwen--Qwen3-TTS-12Hz-0.6B-Base\snapshots\5d83992436eae1d760afd27aff78a71d676296fc',
        ):
            response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['voice_model'], 'Qwen/Qwen3-TTS-12Hz-0.6B-Base')
        self.assertIsNone(response.json()['custom_voice_model'])
        self.assertNotIn('models_cache', response.text)

        loaded_model.tts_model_type = 'custom_voice'
        response = self.client.get('/api/health')
        self.assertEqual(response.json()['custom_voice_model'], 'Qwen/Qwen3-TTS-12Hz-0.6B-Base')

    def test_presets_list_supports_search_and_bounded_pagination(self):
        (config.REF_DIR / 'voice.mp3').write_bytes(b'audio')
        names = ['Alpha', 'Bravo', 'Alpine', 'Charlie', 'ALTO']
        stores._presets.extend({
            'id': f'voice-{index}', 'name': name, 'user_id': 'local-user',
            'language': 'English', 'audio_path': 'references/voice.mp3',
            'ref_text': '',
        } for index, name in enumerate(names))
        stores._presets.append({
            'id': 'unowned', 'name': 'Albatross', 'user_id': 'someone-else',
            'language': 'English', 'audio_path': 'references/voice.mp3',
            'ref_text': '',
        })
        stores._presets.append({
            'id': 'builtin', 'name': 'Legacy speaker', 'user_id': 'local-user',
            'is_builtin': True, 'language': 'English', 'audio_path': 'references/voice.mp3',
            'ref_text': '',
        })

        full = self.client.get('/api/presets').json()
        self.assertEqual([preset['name'] for preset in full['presets']], names)
        self.assertEqual(full['total'], 5)
        self.assertNotIn('Legacy speaker', [preset['name'] for preset in full['presets']])
        self.assertNotIn('is_builtin', full['presets'][0])

        page = self.client.get('/api/presets', params={'limit': 2, 'offset': 1}).json()
        self.assertEqual([preset['name'] for preset in page['presets']], ['Bravo', 'Alpine'])
        self.assertEqual(page['total'], 5)

        matching = self.client.get('/api/presets', params={'q': '  al ', 'limit': 2, 'offset': 1}).json()
        self.assertEqual([preset['name'] for preset in matching['presets']], ['Alpine', 'ALTO'])
        self.assertEqual(matching['total'], 3)
        self.assertEqual(self.client.get('/api/presets', params={'q': 'missing'}).json()['total'], 0)
        self.assertEqual(self.client.get('/api/presets', params={'limit': 200}).json()['presets'].__len__(), 5)
        self.assertEqual(self.client.get('/api/presets', params={'limit': 1, 'offset': 1000}).json()['presets'], [])
        self.assertEqual(self.client.get('/api/presets', params={'q': 'legacy'}).json()['total'], 0)

    def test_preset_completed_voiceover_counts_are_global_and_refresh_after_deletion(self):
        (config.REF_DIR / 'voice.mp3').write_bytes(b'audio')
        stores._presets.extend({
            'id': preset_id, 'name': preset_id, 'user_id': 'local-user',
            'language': 'English', 'audio_path': 'references/voice.mp3', 'ref_text': '',
        } for preset_id in ('many', 'none'))
        stores._history.extend([
            {'id': f'history-{index}', 'user_id': 'local-user', 'preset_id': 'many', 'audio_url': ''}
            for index in range(3)
        ])
        # Other users' rows and live queue jobs are not completed records owned
        # by this voice and must never affect the aggregate.
        stores._history.append({'id': 'other', 'user_id': 'someone-else', 'preset_id': 'many'})
        with patch.object(budget, '_ref_facts', return_value=SimpleNamespace(
            ref_seconds=None, budget=SimpleNamespace(chunk_chars=200),
        )):
            full = self.client.get('/api/presets').json()['presets']
            self.assertEqual({voice['id']: voice['completed_voiceovers'] for voice in full}, {'many': 3, 'none': 0})
            # The count is aggregate data, unaffected by list paging or search.
            page = self.client.get('/api/presets', params={'q': 'many', 'limit': 1, 'offset': 0}).json()
            self.assertEqual(page['presets'][0]['completed_voiceovers'], 3)
            self.assertEqual(page['total'], 1)
            self.client.get('/api/history', params={'limit': 1, 'offset': 1, 'preset_id': 'none'})
            self.assertEqual(self.client.get('/api/presets', params={'q': 'many'}).json()['presets'][0]['completed_voiceovers'], 3)
            self.assertEqual(self.client.delete('/api/history/history-0').status_code, 200)
            refreshed = self.client.get('/api/presets', params={'q': 'many'}).json()['presets'][0]
            self.assertEqual(refreshed['completed_voiceovers'], 2)
            self.assertEqual(self.delete_all('/api/history').status_code, 200)
            refreshed = self.client.get('/api/presets', params={'q': 'many'}).json()['presets'][0]
            self.assertEqual(refreshed['completed_voiceovers'], 0)

    def test_legacy_builtin_cannot_be_used_for_generation_or_managed_as_a_voice(self):
        self.ready_voice()
        stores._presets.append({
            'id': 'builtin', 'name': 'Legacy speaker', 'user_id': 'local-user',
            'is_builtin': True, 'language': 'English', 'audio_path': 'references/voice.mp3',
            'ref_text': '',
        })
        payload = {'preset_id': 'builtin', 'text': 'A script.', 'language': 'English'}
        response = self.client.post('/api/generate', json=payload)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['detail'], 'Selected voice is unavailable. Choose a voice before generating.')
        self.assertEqual(self.client.patch('/api/presets/builtin', json={'name': 'Changed'}).status_code, 404)
        self.assertEqual(self.client.delete('/api/presets/builtin').status_code, 404)
        self.assertEqual(self.client.get('/api/presets/builtin/download').status_code, 404)

    def test_history_marks_legacy_builtin_without_rewriting_historical_entry(self):
        stores._presets.append({'id': 'builtin', 'name': 'Legacy speaker', 'user_id': 'local-user', 'is_builtin': True})
        historical = {'id': 'old', 'user_id': 'local-user', 'preset_id': 'builtin', 'preset_name': 'Legacy speaker', 'text': 'Old script.'}
        stores._history.append(historical.copy())
        response = self.client.get('/api/history')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['history'][0]['preset_is_builtin'])
        self.assertEqual(stores._history[0], historical)

    def test_bulk_history_covers_all_pages_and_preserves_shared_and_unowned_media(self):
        shared = config.GEN_DIR / 'shared.wav'
        shared.write_bytes(b'audio')
        for i in range(105):
            media = config.GEN_DIR / f'{i}.wav'
            media.write_bytes(b'audio')
            media.with_suffix('.mp3').write_bytes(b'cached')
            stores._history.append({'id': str(i), 'user_id': 'local-user', 'audio_url': f'/audio/{i}.wav'})
        stores._history.extend([
            {'id': 'shared-mine', 'user_id': 'local-user', 'audio_url': '/audio/shared.wav'},
            {'id': 'shared-other', 'user_id': 'other', 'audio_url': '/audio/shared.wav'},
            {'id': 'unsafe', 'user_id': 'local-user', 'audio_url': '/audio/../protected.txt'},
        ])
        protected = self.root / 'protected.txt'
        protected.write_bytes(b'keep')
        stores._presets.append({'id': 'builtin-shared', 'user_id': 'local-user', 'is_builtin': True, 'audio_path': 'generated/0.wav'})
        response = self.delete_all('/api/history')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(response.json()['deleted_ids']), 107)
        self.assertEqual(response.json()['cleanup_failed'], [])
        self.assertEqual([h['id'] for h in stores._history], ['shared-other'])
        self.assertEqual(json.loads(config.HISTORY_FILE.read_text()), stores._history)
        self.assertEqual(set(config.GEN_DIR.iterdir()), {shared, config.GEN_DIR / '0.wav'})
        self.assertTrue(protected.exists())
        self.assertEqual(self.delete_all('/api/history').json()['deleted_ids'], [])

    def test_bulk_presets_preserves_builtins_shared_media_and_history(self):
        for name in ('shared.wav', 'uploaded.wav'):
            (config.REF_DIR / name).write_bytes(b'audio')
        unrelated = self.root / 'settings.json'
        unrelated.write_bytes(b'keep')
        stores._presets.extend([
            {'id': 'builtin', 'user_id': 'local-user', 'is_builtin': True, 'audio_path': 'references/shared.wav'},
            {'id': 'shared', 'user_id': 'local-user', 'audio_path': 'references/shared.wav'},
            {'id': 'uploaded', 'user_id': 'local-user', 'audio_path': 'references/uploaded.wav'},
            {'id': 'other', 'user_id': 'other', 'audio_path': 'references/shared.wav'},
            {'id': 'outside-refs', 'user_id': 'local-user', 'audio_path': 'settings.json'},
        ])
        stores._history.append({'id': 'keep', 'user_id': 'local-user', 'text': 'Saved transcript'})
        result = self.delete_all('/api/presets')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(set(result.json()['deleted_ids']), {'shared', 'uploaded', 'outside-refs'})
        self.assertEqual([p['id'] for p in stores._presets], ['builtin', 'other'])
        self.assertTrue((config.REF_DIR / 'shared.wav').exists())
        self.assertFalse((config.REF_DIR / 'uploaded.wav').exists())
        self.assertEqual(unrelated.read_bytes(), b'keep')
        self.assertEqual(stores._history[0]['text'], 'Saved transcript')

    def test_bulk_deletion_refuses_active_work_without_mutation(self):
        self.ready_voice()
        job_id = self.submit()
        for status in ('queued', 'running', 'canceling'):
            worker._jobs[job_id]['status'] = status
            for path in ('/api/history', '/api/presets'):
                self.assertEqual(self.delete_all(path).status_code, 409)
                self.assertEqual(stores._presets[0]['id'], 'voice')
        worker._jobs[job_id]['status'] = 'canceled'
        with stores.reference_upload():
            self.assertEqual(self.delete_all('/api/presets').status_code, 409)
        self.assertEqual(self.delete_all('/api/presets').status_code, 200)

    def test_bulk_cleanup_failure_is_reported_and_store_failure_preserves_records(self):
        audio = config.GEN_DIR / 'locked.mp3'
        audio.write_bytes(b'audio')
        entry = {'id': 'locked', 'user_id': 'local-user', 'audio_url': '/audio/locked.mp3'}
        stores._history.append(entry)
        with patch.object(stores, '_save_json', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.delete_all('/api/history')
        self.assertEqual(stores._history, [entry])
        self.assertTrue(audio.exists())
        original_unlink = Path.unlink
        def locked_unlink(path, *args, **kwargs):
            if path == audio:
                raise PermissionError('locked')
            return original_unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', autospec=True, side_effect=locked_unlink):
            result = self.delete_all('/api/history')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), {'deleted_ids': ['locked'], 'cleanup_failed': ['locked.mp3']})
        self.assertEqual(stores._history, [])
        self.assertTrue(audio.exists())

    def test_bulk_clear_rejects_submissions_already_in_preflight(self):
        self.ready_voice()
        for collection in ('history', 'presets'):
            with self.subTest(collection=collection):
                entered = threading.Event()
                release = threading.Event()
                def preflight(_preset):
                    entered.set()
                    if not release.wait(5):
                        raise RuntimeError('Preflight test timed out')
                    return budget._Budget(200, 700, 1)
                with patch.object(budget, '_seq_budget', side_effect=preflight), ThreadPoolExecutor(max_workers=1) as pool:
                    submission = pool.submit(self.client.post, '/api/generate', json={
                        'preset_id': 'voice', 'text': 'Must not reappear.', 'language': 'English',
                    })
                    try:
                        self.assertTrue(entered.wait(5))
                        self.assertEqual(self.delete_all(f'/api/{collection}').status_code, 200)
                    finally:
                        release.set()
                    self.assertEqual(submission.result(timeout=5).status_code, 409)
                self.assertEqual(worker._jobs, {})
                self.assertEqual(stores._history, [])

    def test_health_validation_and_unknown_api_do_not_fall_through_to_spa(self):
        self.assertFalse(self.client.get('/api/health').json()['model_loaded'])
        self.assertEqual(self.client.get('/api/languages').status_code, 503)
        self.assertEqual(self.client.post('/api/generate', json={}).status_code, 422)
        self.assertEqual(self.client.get('/api/does-not-exist').status_code, 404)
        self.assertEqual(self.client.post('/api/history/zip', json={'ids': []}).status_code, 400)

    def test_bulk_deletions_require_the_configured_admin_password(self):
        self.ready_voice()
        stores._history.append({'id': 'private', 'user_id': 'local-user', 'text': 'Keep until authorized'})
        for path in ('/api/history', '/api/presets'):
            self.assertEqual(self.delete_all(path, password=None).status_code, 401)
            self.assertEqual(self.delete_all(path, password='incorrect').status_code, 401)
        self.assertEqual(len(stores._history), 1)
        self.assertEqual(len(stores._presets), 1)
        config.ADMIN_PASSWORD = ''
        response = self.delete_all('/api/history')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(len(stores._history), 1)

    def test_submission_reorder_cancellation_and_retry_share_one_queue(self):
        self.ready_voice()
        first, second = self.submit('First script.'), self.submit('Second script.')
        persisted = json.loads(config.QUEUE_FILE.read_text())
        self.assertEqual([j['job_id'] for j in persisted], [first, second])
        self.assertEqual(self.client.get(f'/api/jobs/{first}').json()['status'], 'queued')
        response = self.client.post('/api/queue/reorder', json={'job_ids': [second, first]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(worker._pending_job_ids, [second, first])
        response = self.client.post(f'/api/queue/{first}/cancel')
        self.assertEqual(response.json(), {'ok': True})
        self.assertEqual(worker._jobs[first]['status'], 'canceled')
        self.assertNotIn(first, worker._pending_job_ids)
        self.assertEqual(self.client.get(f'/api/queue/{first}/script').json()['text'], 'First script.')
        response = self.client.post(f'/api/queue/{first}/retry')
        self.assertEqual(response.status_code, 202, response.text)
        replacement = response.json()['job_id']
        self.assertNotIn(first, worker._jobs)
        self.assertEqual(worker._jobs[replacement]['attempt'], 2)
        self.assertEqual(worker._pending_job_ids, [second, replacement])

    def test_startup_drops_queued_jobs_for_legacy_builtin_voices(self):
        self.ready_voice()
        stores._presets[0]['is_builtin'] = True
        job_id = 'legacy-builtin-job'
        config.QUEUE_FILE.write_text(json.dumps([{
            'job_id': job_id, 'user_id': 'local-user', 'preset_id': 'voice',
            'text': 'Must remain ungenerated.', 'language': 'English', 'style': 'natural',
            'stability': 'balanced', 'submitted_at': 1,
        }]))

        worker._restore_queue_on_startup()

        self.assertNotIn(job_id, worker._jobs)
        self.assertEqual(worker._pending_job_ids, [])
        self.assertEqual(json.loads(config.QUEUE_FILE.read_text()), [])

    def test_running_cancellation_closes_stream_without_publishing_audio(self):
        fake = self.ready_voice()
        job_id = self.submit()
        worker._pending_job_ids.remove(job_id)
        closed = []

        def stream(**_kwargs):
            try:
                # Simulate the HTTP cancel arriving while a stream is producing audio.
                response = self.client.post(f'/api/queue/{job_id}/cancel')
                self.assertEqual(response.status_code, 200)
                yield np.ones(100, dtype=np.float32), 24000, {}
                self.fail('A canceled stream must not request another piece')
            finally:
                closed.append(True)

        fake.generate_voice_clone_streaming = stream
        with patch.object(worker.audio_convert, 'write_mp3') as write:
            worker._process_job(job_id)
        self.assertEqual(closed, [True])
        self.assertEqual(worker._jobs[job_id]['status'], 'canceled')
        self.assertIsNone(worker._current_running_job_id)
        self.assertEqual(stores._history, [])
        write.assert_not_called()

    def test_restart_restores_fifo_with_existing_json_format(self):
        self.ready_voice()
        ids = [self.submit('First script.'), self.submit('Second script.')]
        worker._jobs.clear()
        worker._pending_job_ids.clear()
        worker._restore_queue_on_startup()
        self.assertEqual(worker._pending_job_ids, ids)
        self.assertTrue(all(worker._jobs[j]['status'] == 'queued' for j in ids))
        self.assertEqual(self.client.get('/api/queue').json()['queue'][0]['job_id'], ids[0])

    def test_history_zip_and_delete_keep_existing_media_behavior(self):
        import zipfile

        (config.GEN_DIR / 'clip.mp3').write_bytes(b'audio-fixture')
        stores._history.append({
            'id': 'entry', 'user_id': 'local-user', 'preset_name': 'Voice',
            'audio_url': '/audio/clip.mp3', 'created_at': 1,
        })
        response = self.client.post('/api/history/zip', json={'ids': ['entry'], 'names': {'entry': 'Narration'}})
        self.assertEqual(response.status_code, 200, response.text)
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            self.assertEqual(archive.read('Narration.mp3'), b'audio-fixture')
        response = self.client.delete('/api/history/entry')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(config.HISTORY_FILE.read_text()), [])
        self.assertFalse((config.GEN_DIR / 'clip.mp3').exists())

    def test_selected_language_survives_queue_restart_generation_and_history_reload(self):
        fake = self.ready_voice()  # Reference voice is English; request German narration.
        transcript = 'Guten Tag. Dies ist ein deutscher Text.'
        job_id = self.submit(transcript, language='German')
        self.assertEqual(json.loads(config.QUEUE_FILE.read_text())[0]['language'], 'German')
        worker._jobs.clear()
        worker._pending_job_ids.clear()
        worker._restore_queue_on_startup()
        self.assertEqual(self.client.get('/api/queue').json()['queue'][0]['language'], 'German')
        self.assertEqual(self.client.get(f'/api/queue/{job_id}/script').json(), {
            'text': transcript, 'preset_id': 'voice', 'language': 'German',
        })
        # Run the real worker and persistence with a stubbed model/audio encoder.
        from unittest.mock import Mock
        fake.generate_voice_clone_streaming = Mock(return_value=iter([(np.ones(24000, dtype=np.float32), 24000, {})]))
        worker._pending_job_ids.remove(job_id)
        with patch.object(budget, '_chunk_duration_is_sane', return_value=True), patch.object(
            worker.audio_stitcher, 'trim_edge_silence', side_effect=lambda audio, _sr: audio,
        ), patch.object(
            worker.audio_stitcher, 'stitch_audio', side_effect=lambda pieces, _sr, **_kwargs: np.concatenate(pieces),
        ), patch.object(
            worker.audio_convert, 'write_mp3', side_effect=lambda _audio, _sr, target: Path(target).write_bytes(b'mp3'),
        ):
            worker._process_job(job_id)
        self.assertEqual(fake.generate_voice_clone_streaming.call_args.kwargs['language'], 'German')
        stores._history = stores._load_json(config.HISTORY_FILE)
        entry = self.client.get('/api/history').json()['history'][0]
        self.assertEqual(entry['language'], 'German')
        self.assertEqual(entry['preset_id'], 'voice')
        self.assertEqual(entry['text'], transcript)
        self.assertEqual(worker._jobs[job_id]['status'], 'done')
        self.assertEqual(self.client.get('/api/presets').json()['presets'][0]['completed_voiceovers'], 1)

    def test_development_paths_stay_outside_the_package(self):
        service = Path(__file__).resolve().parents[1]
        self.assertEqual(config.BACKEND_DIR, service)
        self.assertEqual(config.REPO_ROOT / 'apps/studio', service.parents[1] / 'apps/studio')

    def test_spa_serves_files_and_client_routes_without_shadowing_api(self):
        # The production build is an optional input in a source-only checkout.
        if not any(getattr(route, 'path', None) == '/{full_path:path}' for route in app.routes):
            self.skipTest('Build Studio first to register the SPA route')
        frontend = self.root / 'frontend'
        frontend.mkdir()
        (frontend / 'index.html').write_text('<html>studio</html>')
        (frontend / 'asset.js').write_text('console.log("studio")')
        with patch.object(config, 'FRONTEND_DIST', frontend):
            self.assertEqual(self.client.get('/studio').text, '<html>studio</html>')
            self.assertEqual(self.client.get('/asset.js').text, 'console.log("studio")')
            self.assertEqual(self.client.get('/api/missing').status_code, 404)


if __name__ == '__main__':
    unittest.main()
