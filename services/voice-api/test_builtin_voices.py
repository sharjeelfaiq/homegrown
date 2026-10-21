import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import main


class ModelStartupTests(unittest.TestCase):
    def test_startup_publishes_probe_load_and_ready_after_model_initializes(self):
        phases = []
        with patch.object(main, "resolve_device", return_value=("cuda:0", "test GPU")), patch.object(
            main, "_restore_queue_on_startup"
        ), patch.object(
            main.boot_status,
            "write",
            side_effect=lambda _storage, phase, **_kwargs: phases.append(phase),
        ), patch.object(main.threading, "Thread") as thread, patch.object(
            main.FasterQwen3TTS, "from_pretrained"
        ) as load_model, patch.object(main, "_tts", None):
            thread.return_value.start = lambda: None

            async def start_and_stop():
                async with main.lifespan(main.app):
                    pass

            asyncio.run(start_and_stop())

        load_model.assert_called_once()
        self.assertEqual(
            phases,
            [
                main.boot_status.PHASE_PROBING_GPU,
                main.boot_status.PHASE_LOADING_MODEL,
                main.boot_status.PHASE_READY,
            ],
        )

    def test_startup_keeps_cpu_fallback_and_never_reports_ready_after_load_failure(self):
        phases = []
        with tempfile.TemporaryDirectory() as storage:
            with patch.object(main, "STORAGE_DIR", Path(storage)), patch.object(
                main, "_device", "cuda:0"
            ), patch.object(main, "resolve_device", return_value=("cpu", "no usable GPU")), patch.object(
                main.boot_status,
                "write",
                side_effect=lambda _storage, phase, **_kwargs: phases.append(phase),
            ), patch.object(main.FasterQwen3TTS, "from_pretrained", side_effect=RuntimeError("load failed")), patch.object(
                main, "_tts", None
            ):
                async def start_and_stop():
                    async with main.lifespan(main.app):
                        pass

                asyncio.run(start_and_stop())
                self.assertEqual(main._device, "cpu")

        self.assertEqual(phases[:2], [main.boot_status.PHASE_PROBING_GPU, main.boot_status.PHASE_LOADING_MODEL])
        self.assertEqual(phases[-1], main.boot_status.PHASE_ERROR)
        self.assertNotIn(main.boot_status.PHASE_READY, phases)


if __name__ == "__main__":
    unittest.main()
