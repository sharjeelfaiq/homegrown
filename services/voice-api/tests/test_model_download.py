import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from homegrown_api import config, model_download


class ModelDownloadTests(unittest.TestCase):
    def test_existing_base_checkpoint_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            (model_dir / "config.json").write_text(
                json.dumps({"tts_model_size": "1b7", "tts_model_type": "base"}),
                encoding="utf-8",
            )
            with patch.object(config, "MODEL_PATH", str(model_dir)):
                model_download.download_model_if_needed()

    def test_existing_wrong_checkpoint_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            model_dir = Path(directory)
            (model_dir / "config.json").write_text(
                json.dumps({"tts_model_size": "wrong-size", "tts_model_type": "base"}),
                encoding="utf-8",
            )
            with patch.object(config, "MODEL_PATH", str(model_dir)):
                with self.assertRaisesRegex(RuntimeError, "1.7B-Base"):
                    model_download.download_model_if_needed()


if __name__ == "__main__":
    unittest.main()
