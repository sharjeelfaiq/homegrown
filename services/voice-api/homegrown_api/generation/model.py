"""Shared model and device state."""
import homegrown_api.config as config
import threading
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from qwen import FasterQwen3TTS


_tts: Optional["FasterQwen3TTS"] = None


# Set once a CUDA-level fault (e.g. Windows TDR killing a kernel) has taken out
# this process's CUDA context. Nothing can recover it in-process: every job from
# then on fails identically, which is exactly what makes it worth reporting --
# a client that keeps offering "retry" is offering something that cannot work.
# Never cleared: the only cure is a restart, and a restart clears it by
# definition.
_gpu_fault: Optional[str] = None


_gen_lock = threading.Lock()


# Which device the model actually ended up on, and why. Surfaced via
# /api/health so the UI can warn that a CPU run will be extremely slow.
_device: str = "unknown"


_device_reason: str = ""

# Filled by the independent startup device probe. Model-management requests
# read this cached value instead of importing torch on the request thread.
_gpu_memory_mib: int | None = None
_gpu_available_memory_mib: int | None = None
_gpu_name: str | None = None
_gpu_compute_capability: str | None = None


# faster-whisper reports ISO 639-1; the model names its languages in full.
# Only the ones this model actually speaks are worth mapping -- anything else
# falls back to the request's value.
_WHISPER_TO_MODEL_LANGUAGE = {
    "en": "English", "zh": "Chinese", "de": "German", "es": "Spanish",
    "ru": "Russian", "ko": "Korean", "fr": "French", "ja": "Japanese",
    "pt": "Portuguese", "tr": "Turkish", "pl": "Polish", "ca": "Catalan",
    "nl": "Dutch", "ar": "Arabic", "sv": "Swedish", "it": "Italian",
    "id": "Indonesian", "hi": "Hindi", "fi": "Finnish", "vi": "Vietnamese",
    "he": "Hebrew", "uk": "Ukrainian", "el": "Greek", "ms": "Malay",
    "cs": "Czech", "ro": "Romanian", "da": "Danish", "hu": "Hungarian",
    "ta": "Tamil", "no": "Norwegian", "th": "Thai", "ur": "Urdu",
}


def _canonical_language(name: str) -> Optional[str]:
    """`name` in the model's own spelling, or None if it does not speak it.

    /api/generate now carries a per-request language -- the Script editor can
    override the one stamped on the voice -- so an unsupported value has to be
    rejected here. Without this it reaches the wrapper and surfaces as a
    mid-generation NotImplementedError on a chunk, i.e. a failed job rather
    than a refused request.

    Case-insensitive because codec_language_id is keyed in lower case while
    /api/languages publishes the capitalized names the client sends back.
    """
    if _tts is None:
        return None
    supported = _tts.model.model.config.talker_config.codec_language_id
    key = (name or "").strip().lower()
    return key.capitalize() if key in supported else None


def _model_language_name(whisper_code: str) -> Optional[str]:
    """Whisper's language code as a name this model recognises, or None."""
    name = _WHISPER_TO_MODEL_LANGUAGE.get(whisper_code.lower())
    if name is None or _tts is None:
        return name
    supported = _tts.model.model.config.talker_config.codec_language_id
    return name if name.lower() in supported else None



def probe_device() -> None:
    """Resolve and own the device selected for this process."""
    global _device, _device_reason, _gpu_memory_mib, _gpu_available_memory_mib, _gpu_name, _gpu_compute_capability
    # Keep importing the heavyweight inference stack out of ASGI app import.
    # Uvicorn can then bind and serve the Studio while startup continues, as it
    # does in the development environment.
    from qwen.utils import resolve_device
    _device, _device_reason = resolve_device("auto")
    _gpu_memory_mib = None
    _gpu_available_memory_mib = None
    _gpu_name = None
    _gpu_compute_capability = None
    if _device.startswith("cuda"):
        try:
            import torch
            properties = torch.cuda.get_device_properties(0)
            _gpu_name = properties.name
            _gpu_compute_capability = f"sm_{properties.major}{properties.minor}"
            total_bytes = properties.total_memory
            _gpu_memory_mib = round(total_bytes / (1024 ** 2))
            try:
                free_bytes, _ = torch.cuda.mem_get_info(0)
                _gpu_available_memory_mib = round(free_bytes / (1024 ** 2))
            except Exception:
                pass
        except Exception:
            # Device selection already succeeded. Memory is only used for
            # optional compatibility messaging and must not hide the device.
            _gpu_memory_mib = None


def load_model() -> None:
    """Initialize the shared model only after startup has selected its device."""
    global _tts, _device, _device_reason
    import torch
    from qwen import FasterQwen3TTS
    from homegrown_api.model_download import active_model_path

    try:
        _tts = FasterQwen3TTS.from_pretrained(
            str(active_model_path()), device=_device, dtype=torch.bfloat16,
            attn_implementation="sdpa", max_seq_len=config.MAX_SEQ_LEN,
        )
    except Exception:
        # A fit estimate is not a successful runtime check. If GPU initialization
        # fails, retry on CPU; a successful load is then the strongest evidence
        # available and generation's runtime gate accepts that loaded CPU model.
        if not _device.startswith("cuda"):
            raise
        config.logger.exception("GPU model load failed; retrying the model on CPU")
        _device = "cpu"
        _device_reason = "GPU load failed; using CPU fallback. Generation will be very slow."
        _tts = FasterQwen3TTS.from_pretrained(
            str(active_model_path()), device="cpu", dtype=torch.float32,
            attn_implementation="sdpa", max_seq_len=config.MAX_SEQ_LEN,
        )
