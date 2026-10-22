import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from homegrown_api.app import app
from homegrown_api import config, lifespan, boot_status
from homegrown_api.generation import model, worker


class ModelStartupTests(unittest.TestCase):
    def setUp(self):
        # Startup tests must never migrate real local media or stores.
        migration = patch('homegrown_api.persistence.stores._migrate_preset_media_paths')
        migration.start()
        self.addCleanup(migration.stop)

    def test_startup_publishes_probe_load_and_ready_after_model_initializes(self):
        phases = []
        with patch.object(model, "resolve_device", return_value=("cuda:0", "test GPU")), patch.object(
            worker, "_restore_queue_on_startup"
        ), patch.object(
            boot_status,
            "write",
            side_effect=lambda _storage, phase, **_kwargs: phases.append(phase),
        ), patch.object(lifespan.threading, "Thread") as thread, patch.object(
            model.FasterQwen3TTS, "from_pretrained"
        ) as load_model, patch.object(model, "_tts", None):
            thread.return_value.start = lambda: None

            async def start_and_stop():
                async with lifespan.lifespan(app):
                    pass

            asyncio.run(start_and_stop())

        load_model.assert_called_once()
        thread.return_value.join.assert_called_once_with(timeout=2)
        self.assertEqual(
            phases,
            [
                boot_status.PHASE_PROBING_GPU,
                boot_status.PHASE_LOADING_MODEL,
                boot_status.PHASE_READY,
            ],
        )

    def test_startup_keeps_cpu_fallback_and_never_reports_ready_after_load_failure(self):
        phases = []
        with tempfile.TemporaryDirectory() as storage:
            with patch.object(config, "STORAGE_DIR", Path(storage)), patch.object(
                model, "_device", "cuda:0"
            ), patch.object(model, "resolve_device", return_value=("cpu", "no usable GPU")), patch.object(
                boot_status,
                "write",
                side_effect=lambda _storage, phase, **_kwargs: phases.append(phase),
            ), patch.object(model.FasterQwen3TTS, "from_pretrained", side_effect=RuntimeError("load failed")), patch.object(
                model, "_tts", None
            ):
                async def start_and_stop():
                    async with lifespan.lifespan(app):
                        pass

                asyncio.run(start_and_stop())
                self.assertEqual(model._device, "cpu")

        self.assertEqual(phases[:2], [boot_status.PHASE_PROBING_GPU, boot_status.PHASE_LOADING_MODEL])
        self.assertEqual(phases[-1], boot_status.PHASE_ERROR)
        self.assertNotIn(boot_status.PHASE_READY, phases)


if __name__ == "__main__":
    unittest.main()
