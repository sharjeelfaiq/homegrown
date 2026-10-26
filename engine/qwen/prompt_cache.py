"""Instance-owned, storage-bounded reference prompt cache (no CUDA operations)."""
from collections import OrderedDict
from pathlib import Path


def reference_key(path, transcript, xvec_only, append_silence, batch_size, device, dtype):
    try:
        resolved = Path(path).resolve(strict=True)
        stat = resolved.stat()
        if not resolved.is_file():
            return None
    except (OSError, ValueError, RuntimeError):
        return None
    return (str(resolved), stat.st_size, stat.st_mtime_ns, transcript,
            bool(xvec_only), bool(append_silence), batch_size, str(device), str(dtype))


def tensor_storage_bytes(value):
    """Count whole retained storages, deduplicating views and shared tensors."""
    storages = {}
    visited = set()

    def visit(item):
        if id(item) in visited:
            return
        visited.add(id(item))
        if hasattr(item, 'untyped_storage'):
            storage = item.untyped_storage()
            storages[(str(item.device), storage.data_ptr())] = storage.nbytes()
        elif isinstance(item, dict):
            for child in item.values():
                visit(child)
        elif isinstance(item, (tuple, list)):
            for child in item:
                visit(child)
    visit(value)
    return sum(storages.values())


class PromptCache:
    def __init__(self, max_entries=16, max_bytes=16 * 1024 * 1024):
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self._entries = OrderedDict()
        self.retained_bytes = 0

    def __len__(self):
        return len(self._entries)

    def get(self, key):
        if key is None or key not in self._entries:
            return None
        value, _ = self._entries[key]
        self._entries.move_to_end(key)
        return value

    def put(self, key, value):
        if key is None:
            return
        size = tensor_storage_bytes(value)
        if size > self.max_bytes or self.max_entries < 1:
            return
        if key in self._entries:
            _, previous_size = self._entries.pop(key)
            self.retained_bytes -= previous_size
        # Accounting per entry is conservative when entries share storage.
        while self._entries and (len(self._entries) >= self.max_entries or
                                 self.retained_bytes + size > self.max_bytes):
            _, (_, removed_size) = self._entries.popitem(last=False)
            self.retained_bytes -= removed_size
        self._entries[key] = (value, size)
        self.retained_bytes += size
