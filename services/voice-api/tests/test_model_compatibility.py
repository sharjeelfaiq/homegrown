import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from homegrown_api import config, model_download
from homegrown_api.model_compatibility import assess, compatibility


class ModelCompatibilityTests(unittest.TestCase):
    def test_tested_standard_gpu_profile(self):
        result = assess("standard", {"gpu_name": "NVIDIA GeForce GTX 970", "vram_mib": 4096, "ram_mib": 16384})
        self.assertEqual(result["gpu"]["status"], "Tested")
        self.assertTrue(result["available"])

    def test_gpu_estimate_and_severe_insufficiency(self):
        self.assertEqual(assess("higher", {"vram_mib": 8192, "ram_mib": 16384})["gpu"]["status"], "Estimated")
        result = assess("higher", {"vram_mib": 4096, "ram_mib": 4096})
        self.assertFalse(result["available"])
        self.assertEqual(result["gpu"]["status"], "Severely insufficient")

    def test_cpu_fit_and_slow_warning(self):
        result = assess("higher", {"ram_mib": 16384, "cpu_threads": 12})
        self.assertEqual(result["device"], "CPU")
        self.assertTrue(result["cpu"]["available"])
        self.assertIn("very slow", result["reason"])

    def test_unknown_hardware_never_disables_download(self):
        result = assess("higher", {})
        self.assertTrue(result["available"])
        self.assertEqual(result["status"], "Unknown")

    def test_recommendation_inputs_prioritize_gpu(self):
        higher = assess("higher", {"vram_mib": 8192, "ram_mib": 16384})
        standard = assess("standard", {"gpu_name": "NVIDIA GeForce GTX 970", "vram_mib": 4096, "ram_mib": 16384})
        self.assertEqual(higher["device"], "GPU")
        self.assertEqual(standard["gpu"]["status"], "Tested")

    def test_recommendation_prefers_higher_gpu_then_standard_gpu(self):
        from homegrown_api.routes import models
        higher_gpu = {"available": True, "gpu": {"available": True, "status": "Estimated"}}
        standard_gpu = {"available": True, "gpu": {"available": True, "status": "Tested"}}
        cpu_only_higher = {"available": True, "gpu": {"available": False, "status": "Severely insufficient"}}
        with patch.object(models, "_compatibility", side_effect=[standard_gpu, higher_gpu]):
            self.assertEqual(models._recommend(), "higher")
        with patch.object(models, "_compatibility", side_effect=[standard_gpu, cpu_only_higher]):
            self.assertEqual(models._recommend(), "standard")

    def test_loaded_cpu_is_allowed_and_gpu_checks_fit(self):
        self.assertEqual(compatibility("higher", "cpu", None, None), (True, None))
        self.assertFalse(compatibility("higher", "cuda", "GTX", 4096)[0])

    def test_higher_install_path_is_separate_and_standard_path_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            standard, higher = Path(temp) / "standard", Path(temp) / "higher"
            standard.mkdir()
            (standard / "config.json").write_text("{}", encoding="utf-8")
            with patch.object(config, "MODEL_PATH", str(standard)), patch.object(config, "HIGHER_MODEL_PATH", str(higher)):
                self.assertFalse(model_download.is_installed("standard"), "config-only partial downloads are not installed")
            (standard / "model.safetensors").write_bytes(b"weights")
            with patch.object(config, "MODEL_PATH", str(standard)), patch.object(config, "HIGHER_MODEL_PATH", str(higher)):
                self.assertNotEqual(model_download.model_path("standard"), model_download.model_path("higher"))
                self.assertTrue(model_download.is_installed("standard"))
                self.assertFalse(model_download.is_installed("higher"))
                self.assertTrue((standard / "config.json").exists())

    def test_higher_path_cannot_alias_standard(self):
        with tempfile.TemporaryDirectory() as temp:
            shared = Path(temp) / "shared"
            with patch.object(config, "MODEL_PATH", str(shared)), patch.object(config, "HIGHER_MODEL_PATH", str(shared)):
                self.assertFalse(model_download.is_installed("higher"))
                with self.assertRaises(ValueError):
                    model_download.download_model_if_needed("higher")


if __name__ == "__main__":
    unittest.main()
