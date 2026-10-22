"""Routes downloads"""
import homegrown_api.config as config
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import homegrown_api.audio.convert as audio_convert

router = APIRouter()


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return cleaned or "homegrown"


@router.get("/api/download/{filename}")
def download_audio(filename: str, name: str = "homegrown"):
    """Serve a generated clip as a renamed .mp3 download. New generations are
    written as .mp3 directly (see write_mp3 in _process_job) and are served
    as-is here. History entries from before that change still point at an
    on-disk .wav -- those get converted (via PyAV) and cached on first hit."""
    src_path = (config.GEN_DIR / filename).resolve()
    if (
        config.GEN_DIR.resolve() not in src_path.parents
        or src_path.suffix.lower() not in (".mp3", ".wav")
        or not src_path.exists()
    ):
        raise HTTPException(404, "Unknown audio file")

    if src_path.suffix.lower() == ".mp3":
        mp3_path = src_path
    else:
        mp3_path = src_path.with_suffix(".mp3")
        if not mp3_path.exists():
            try:
                audio_convert.wav_to_mp3(str(src_path), str(mp3_path))
            except Exception as e:
                mp3_path.unlink(missing_ok=True)
                config.logger.exception("Failed to convert %s to mp3", src_path)
                raise HTTPException(500, f"Could not convert audio to mp3: {e}")

    return FileResponse(
        str(mp3_path), media_type="audio/mpeg", filename=f"{_safe_filename(name)}.mp3",
    )
