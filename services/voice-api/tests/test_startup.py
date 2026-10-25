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
from homegrown_api import model_download
from homegrown_api.app import app
from homegrown_api.generation import model, worker


class ModelStartupTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.storage = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(config, "STORAGE_DIR", self.storage))
        self.stack.enter_context(patch.object(model_download, "model_is_installed", return_value=True))
        self.stack.enter_context(patch("homegrown_api.persistence.stores._migrate_preset_media_paths"))
        self.stack.enter_context(patch.object(model, "_tts", None))
        self.stack.enter_context(patch.object(model, "_gpu_fault", None))
        self.stack.enter_context(patch.object(model, "_device", "unknown"))
        self.stack.enter_context(patch.object(model, "_device_reason", ""))
        self.stack.enter_context(patch.object(model, "probe_device", side_effect=lambda: setattr(model, "_device", "cpu")))
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
            self.assertNotIn("voice_model", health.json())
            self.assertNotIn("custom_voice_model", health.json())

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

    def test_model_failure_wakes_waiting_api_with_sanitized_503(self):
        self.stack.enter_context(patch.object(model, "probe_device", return_value=None))
        self.stack.enter_context(patch.object(model, "load_model", side_effect=RuntimeError("load failed")))
        self.stack.enter_context(patch.object(boot_status, "write"))

        with TestClient(app) as client:
            response = client.get("/api/presets")
            self.assertEqual(response.status_code, 503)
            self.assertIn("voice model is not ready", response.json()["detail"])
            self.assertNotIn("load failed", response.json()["detail"])
            health = client.get("/api/health")
            self.assertNotIn("load failed", health.json()["startup_error"])

    def test_missing_model_keeps_studio_and_management_available(self):
        self.stack.enter_context(patch.object(model_download, "model_is_installed", return_value=False))
        self.stack.enter_context(patch.object(boot_status, "write"))

        with TestClient(app) as client:
            health = client.get("/api/health")
            self.assertFalse(health.json()["model_loaded"])
            model._gpu_fault = "CUDA error: internal kernel details"
            health = client.get("/api/health").json()
            self.assertEqual(health["device_reason"], "No validated graphics device is available.")
            self.assertNotIn("internal kernel details", health["gpu_fault"])
            models = client.get("/api/models")
            self.assertEqual(models.status_code, 200)
            self.assertIsNone(models.json()["selected"])
            self.assertEqual(client.get("/api/queue").status_code, 200)
            self.assertEqual(client.post("/api/generate", json={}).status_code, 503)

    def test_selection_allows_estimated_cpu_fit(self):
        self.stack.enter_context(patch.object(model_download, "model_is_installed", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models.startup.model_busy", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models.startup.device_ready", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models._selection_file", self.storage / "model-selection.json"))
        self.stack.enter_context(patch("homegrown_api.routes.models.hardware_snapshot", return_value={
            "gpu_name": None, "vram_mib": None, "ram_mib": 16384, "cpu_threads": 12,
        }))
        with TestClient(app) as client:
            response = client.post("/api/models/select", json={"selection": "standard"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["state"], "needs_download")

    def test_model_listing_and_selection_share_cpu_fit_assessment(self):
        self.stack.enter_context(patch.object(model_download, "model_is_installed", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models.startup.model_busy", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models.startup.device_ready", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models._selection_file", self.storage / "model-selection.json"))
        self.stack.enter_context(patch("homegrown_api.routes.models.hardware_snapshot", return_value={
            "gpu_name": "NVIDIA GeForce GTX 970", "vram_mib": 4096,
            "ram_mib": 16384, "cpu_threads": 12,
        }))
        with TestClient(app) as client:
            models = client.get("/api/models").json()
            self.assertEqual(models["choices"]["higher"]["gpu"]["status"], "Severely insufficient")
            self.assertTrue(models["choices"]["higher"]["cpu"]["available"])
            self.assertTrue(models["choices"]["higher"]["available"])
            selection = client.post("/api/models/select", json={"selection": "higher"})
            self.assertEqual(selection.status_code, 200)
            self.assertEqual(selection.json()["state"], "needs_download")
            with patch("homegrown_api.routes.models.threading.Thread") as thread_class:
                download = client.post("/api/models/download")
                self.assertEqual(download.status_code, 200)
                thread_class.return_value.start.assert_called_once()

    def test_unknown_hardware_remains_available_on_model_listing(self):
        self.stack.enter_context(patch.object(model_download, "model_is_installed", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models.startup.device_ready", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models.startup.model_busy", return_value=False))
        self.stack.enter_context(patch("homegrown_api.routes.models._selection_file", self.storage / "model-selection.json"))
        self.stack.enter_context(patch("homegrown_api.routes.models.hardware_snapshot", return_value={}))
        with TestClient(app) as client:
            models = client.get("/api/models").json()
            self.assertTrue(models["choices"]["standard"]["available"])
            self.assertEqual(models["choices"]["standard"]["status"], "Unknown")
            for choice in ("standard", "higher"):
                selection = client.post("/api/models/select", json={"selection": choice})
                self.assertEqual(selection.status_code, 200)
                with patch("homegrown_api.routes.models.threading.Thread") as thread_class:
                    download = client.post("/api/models/download")
                    self.assertEqual(download.status_code, 200)
                    thread_class.return_value.start.assert_called_once()

    def test_device_detection_runs_independently_while_model_is_missing(self):
        self.stack.enter_context(patch.object(model_download, "model_is_installed", return_value=False))
        probe_started = threading.Event()
        release_probe = threading.Event()

        def slow_probe():
            probe_started.set()
            release_probe.wait(2)
            model._device = "cpu"
            model._device_reason = "No usable GPU"

        self.stack.enter_context(patch.object(model, "probe_device", side_effect=slow_probe))
        with TestClient(app) as client:
            self.assertTrue(probe_started.wait(1))
            started = time.monotonic()
            initial = client.get("/api/health")
            self.assertLess(time.monotonic() - started, 0.5)
            self.assertFalse(initial.json()["device_ready"])
            release_probe.set()
            deadline = time.monotonic() + 1
            while time.monotonic() < deadline:
                health = client.get("/api/health").json()
                if health["device_ready"]:
                    break
                time.sleep(0.01)
            self.assertTrue(health["device_ready"])
            self.assertEqual(health["device"], "cpu")
            self.assertFalse(health["model_loaded"])


if __name__ == "__main__":
    unittest.main()
