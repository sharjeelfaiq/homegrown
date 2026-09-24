import tempfile
import unittest
from pathlib import Path

from media_paths import StoredMediaPathError, resolve_stored_media_path, storage_relative_path


class MediaPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "storage"
        self.reference = self.root / "references" / "fixture.mp3"
        self.reference.parent.mkdir(parents=True)
        self.reference.write_bytes(b"fixture")

    def tearDown(self):
        self.temp.cleanup()

    def test_relative_path_is_canonical(self):
        self.assertEqual(resolve_stored_media_path("references/fixture.mp3", self.root), self.reference.resolve())
        self.assertEqual(storage_relative_path(self.reference, self.root), "references/fixture.mp3")

    def test_legacy_backend_storage_path_is_remapped(self):
        legacy = r"D:\dev-projects\websites\homegrown\backend\storage\references\fixture.mp3"
        self.assertEqual(resolve_stored_media_path(legacy, self.root), self.reference.resolve())

    def test_missing_path_is_actionable(self):
        with self.assertRaisesRegex(StoredMediaPathError, "missing"):
            resolve_stored_media_path("references/missing.mp3", self.root)

    def test_path_escape_is_rejected(self):
        with self.assertRaisesRegex(StoredMediaPathError, "escapes"):
            resolve_stored_media_path("../outside.mp3", self.root)

    def test_packaged_backend_storage_path_is_remapped(self):
        legacy = r"C:\Homegrown\backend\storage\references\fixture.mp3"
        self.assertEqual(resolve_stored_media_path(legacy, self.root), self.reference.resolve())


if __name__ == "__main__":
    unittest.main()
