import asyncio
import tempfile
import threading
import time
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

from homegrown_api import config, lifespan, boot_status
from homegrown_api.app import app
from homegrown_api.generation import model, worker


class ModelStartupTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.storage = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(config, "STORAGE_DIR", self.storage))
        self.stack.enter_context(patch("homegrown_api.persistence.stores._migrate_preset_media_paths"))
        self.stack.enter_context(patch.object(model, "_tts", None))
        self.stack.enter_context(patch.object(model, "_device", "unknown"))
        self.stack.enter_context(patch.object(model, "_device_reason", ""))
        self.stack.enter_context(patch.object(worker, "_restore_queue_on_startup"))
        self.stack.enter_context(patch.object(worker, "_worker_loop", return_value=None))

    def test_lifespan_serves_health_while_model_loads_and_api_waits(self):
        load_started = threading.Event()
        release_load = threading.Event()
        fake_model = SimpleNamespace(sample_rate=24000)

        def load_model():
            load_started.set()
            release_load.wait(3)
            model._tts = fake_model

        self.stack.enter_context(patch.object(model, "probe_device", side_effect=lambda: setattr(model, "_device", "cpu")))
        self.stack.enter_context(patch.object(model, "load_model", side_effect=load_model))
        self.stack.enter_context(patch.object(boot_status, "write"))

        with TestClient(app) as client:
            self.assertTrue(load_started.wait(1))
            started = time.monotonic()
            health = client.get("/api/health")
            self.assertLess(time.monotonic() - started, 1)
            self.assertFalse(health.json()["model_loaded"])
            self.assertIsNone(health.json()["voice_model"])
            self.assertIsNone(health.json()["custom_voice_model"])

            result = {}
            request = threading.Thread(target=lambda: result.setdefault("response", client.get("/api/presets")))
            request.start()
            time.sleep(0.1)
            self.assertTrue(request.is_alive(), "API request should wait for model readiness")
            release_load.set()
            request.join(2)
            self.assertFalse(request.is_alive())
            self.assertEqual(result["response"].status_code, 200)
            self.assertTrue(worker._restore_queue_on_startup.called)

    def test_model_failure_wakes_waiting_api_with_actionable_503(self):
        self.stack.enter_context(patch.object(model, "probe_device", return_value=None))
        self.stack.enter_context(patch.object(model, "load_model", side_effect=RuntimeError("load failed")))
        self.stack.enter_context(patch.object(boot_status, "write"))

        with TestClient(app) as client:
            response = client.get("/api/presets")
            self.assertEqual(response.status_code, 503)
            self.assertIn("load failed", response.json()["detail"])
            health = client.get("/api/health")
            self.assertIn("load failed", health.json()["startup_error"])


if __name__ == "__main__":
    unittest.main()
