"""Routes presets"""
import homegrown_api.config as config
import time
import uuid
from pathlib import Path
import soundfile as sf
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

import homegrown_api.audio.transcription as audio_transcription
import homegrown_api.dependencies as dependencies
import homegrown_api.generation.budget as generation_budget
import homegrown_api.generation.model as generation_model
import homegrown_api.generation.worker as generation_worker
import homegrown_api.persistence.media_paths as persistence_media_paths
import homegrown_api.persistence.stores as persistence_stores
import homegrown_api.routes.downloads as routes_downloads

router = APIRouter()


@router.delete("/api/presets")
def delete_all_presets(
    user_id: str = Depends(dependencies.get_current_user),
    _admin: None = Depends(dependencies.require_admin_password),
):
    with generation_worker._jobs_lock:
        generation_worker.require_idle_for_deletion(user_id)
        return persistence_stores.delete_collection("presets", user_id)


def _preset_response(preset: dict) -> dict:
    """Add fields derivable/servable at read time without persisting them
    redundantly (preview_url is just the reference file exposed over HTTP).

    ref_seconds and chunk_chars are COMPUTED here rather than stored, and that is
    what makes them useful. The voices that need reporting on are the ones
    created by an older build -- before _trim_reference_clip existed, when a
    60s clip was accepted whole -- and a persisted field would be missing on
    exactly those, needing a migration to backfill. Deriving covers them for
    free. _ref_facts memoises the underlying sf.info()/_compute_seq_budget pair,
    so listing N voices is N cache hits after the first call.
    """
    facts = generation_budget._ref_facts(preset)
    try:
        preview_name = persistence_stores._reference_path(preset).name
        reference_error = None
    except persistence_media_paths.StoredMediaPathError as exc:
        preview_name = ""
        reference_error = str(exc)
    return {
        **{key: value for key, value in preset.items() if key != "is_builtin"},
        "preview_url": f"/refs/{preview_name}" if preview_name else None,
        "reference_error": reference_error,
        "ref_seconds": facts.ref_seconds,
        "chunk_chars": facts.budget.chunk_chars,
    }


@router.get("/api/presets")
def list_presets(
    limit: int | None = None,
    offset: int = 0,
    q: str | None = None,
    user_id: str = Depends(dependencies.get_current_user),
):
    presets = [p for p in persistence_stores._presets if p.get("user_id") == user_id and not p.get("is_builtin")]
    needle = (q or "").strip().casefold()
    if needle:
        presets = [p for p in presets if needle in str(p.get("name", "")).casefold()]
    total = len(presets)
    if limit is not None or offset:
        limit = min(100, max(1, limit if limit is not None else 100))
        offset = max(0, offset)
        presets = presets[offset:offset + limit]
    return {"presets": [_preset_response(p) for p in presets], "total": total}


@router.post("/api/presets")
async def create_preset(
    audio: UploadFile = File(...),
    name: str = Form(...),
    ref_text: str = Form(""),
    language: str = Form("English"),
    tag: str = Form(""),
    user_id: str = Depends(dependencies.get_current_user),
    _upload: None = Depends(persistence_stores.reference_upload_dependency),
):
    name = name.strip()
    ref_text = ref_text.strip()
    tag = tag.strip()
    if not name:
        raise HTTPException(400, "name is required")

    preset_id = uuid.uuid4().hex
    ext = Path(audio.filename or "ref.wav").suffix or ".wav"
    dest = config.REF_DIR / f"{preset_id}{ext}"
    dest.write_bytes(await audio.read())

    try:
        duration_s = sf.info(str(dest)).duration
    except Exception as e:
        dest.unlink(missing_ok=True)
        config.logger.exception("Failed to read reference audio for preset %r", name)
        raise HTTPException(400, f"Could not read reference audio file: {e}")

    if duration_s < config.MIN_REF_AUDIO_SECS:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"Reference audio is {duration_s:.1f}s, too short (minimum {config.MIN_REF_AUDIO_SECS}s) "
            "for reliable voice cloning.",
        )
    if duration_s > config.MAX_REF_AUDIO_SECS:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"That file is {duration_s / 60:.0f} minutes long, past the "
            f"{config.MAX_REF_AUDIO_SECS / 60:.0f}-minute upload limit. Length is not the problem -- "
            f"only the first {config.REF_TRIM_SECS:.0f} seconds are used either way -- but a file "
            "this big has to be uploaded before it can be shortened.",
        )

    # Longer than the model can hold alongside a script: keep the opening and
    # discard the rest. Before transcription on purpose -- see the docstring.
    original_duration_s = duration_s
    if duration_s > config.REF_TRIM_SECS:
        try:
            result = audio_transcription._trim_reference_clip(str(dest), config.REF_TRIM_SECS)
        except Exception as e:
            dest.unlink(missing_ok=True)
            config.logger.exception("Failed to trim reference clip for preset %r", name)
            raise HTTPException(400, f"Could not process that audio file: {e}")
        if result is None:
            dest.unlink(missing_ok=True)
            raise HTTPException(400, "That clip appears to be silent.")
        dest, trimmed = result
        config.logger.info(
            "Preset %r: reference clip trimmed %.1fs -> %.1fs (cap %.0fs)",
            name, duration_s, trimmed, config.REF_TRIM_SECS,
        )
        duration_s = trimmed

    supplied_ref_text = bool(ref_text)
    detected_language = ""
    if not ref_text:
        try:
            config.logger.info("Auto-transcribing reference audio for preset %r with faster-whisper", name)
            ref_text, detected_language = audio_transcription._transcribe_audio(str(dest))
        except Exception as e:
            dest.unlink(missing_ok=True)
            config.logger.exception("Auto-transcription failed for preset %r", name)
            raise HTTPException(400, f"Auto-transcription failed: {e}. Provide ref_text manually.")
        if not ref_text:
            dest.unlink(missing_ok=True)
            raise HTTPException(
                400,
                "Auto-transcription produced empty text -- the clip may be silent or unclear. "
                "Provide ref_text manually.",
            )

    # Only ever reject a transcript the CALLER supplied. This guard was written
    # to catch a placeholder ("ZAZA" for a 23s clip), which is a mistake a
    # human makes and can correct. Applied to our own auto-transcription it is
    # a dead end: the UI sends an empty ref_text every time, so the only thing
    # this could reject was faster-whisper's own output, and the message then
    # told the user to supply a transcript the app gives them no way to supply.
    # Reported from a WhatsApp voice note -- 105 chars for 40s, unusable, with
    # no way forward.
    #
    # A sparse auto-transcript is worth knowing about but is not fatal: the
    # clone is conditioned on the audio, ref_text mainly sets the speaking rate,
    # and _ref_profile already clamps that to a sane range.
    if len(ref_text) / duration_s < config.MIN_REF_TEXT_CHARS_PER_SEC:
        if supplied_ref_text:
            dest.unlink(missing_ok=True)
            raise HTTPException(
                400,
                f"ref_text ({len(ref_text)} chars) looks too short to be an accurate transcript "
                f"of {duration_s:.1f}s of audio. ref_text must be the exact transcript of what's "
                "spoken in the reference clip -- a mismatched transcript causes unstable voice "
                "cloning.",
            )
        config.logger.warning(
            "Preset %r: auto-transcript is sparse (%d chars for %.1fs = %.1f chars/sec). "
            "Accepting it -- the clip may be quiet, heavily paused, or in a language "
            "faster-whisper handles poorly.",
            name, len(ref_text), duration_s, len(ref_text) / duration_s,
        )

    # Same reasoning as above, but this one still bites for generated text:
    # an inflated transcript (whisper's repetition loop duplicating a passage)
    # eats sequence budget that generation needs. Truncating our own output is
    # better than refusing the upload over it.
    if len(ref_text) / duration_s > config.MAX_REF_TEXT_CHARS_PER_SEC and not supplied_ref_text:
        keep = int(duration_s * config.MAX_REF_TEXT_CHARS_PER_SEC)
        config.logger.warning(
            "Preset %r: auto-transcript implausibly long (%d chars for %.1fs) -- "
            "likely a whisper repetition loop. Truncating to %d chars.",
            name, len(ref_text), duration_s, keep,
        )
        ref_text = ref_text[:keep].rstrip()

    if len(ref_text) / duration_s > config.MAX_REF_TEXT_CHARS_PER_SEC:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            400,
            f"ref_text ({len(ref_text)} chars for {duration_s:.1f}s = "
            f"{len(ref_text)/duration_s:.0f} chars/sec) is too long to be an accurate "
            "transcript -- nobody speaks that fast. Usually this means a repeated or "
            "duplicated passage. Trim it to exactly what is spoken in the clip.",
        )

    config.logger.info(
        "Creating preset %r: duration=%.1fs ref_text_len=%d language=%s",
        name, duration_s, len(ref_text), language,
    )

    # The recording knows its own language; asking the user to declare it was
    # a question they could get wrong about their own audio. Whisper detects it
    # while transcribing, so prefer that and keep the request field only as a
    # fallback for a language this model cannot speak.
    if detected_language:
        mapped = generation_model._model_language_name(detected_language)
        if mapped:
            if mapped != language:
                config.logger.info(
                    "Preset %r: language detected as %s (request said %s)", name, mapped, language,
                )
            language = mapped
        else:
            config.logger.info(
                "Preset %r: detected language %r is not one this model speaks; keeping %s",
                name, detected_language, language,
            )

    preset = {
        "id": preset_id,
        "user_id": user_id,
        "name": name,
        "language": language,
        "ref_text": ref_text,
        "audio_path": persistence_media_paths.storage_relative_path(dest, config.STORAGE_DIR),
        "tag": tag,
        "is_builtin": False,
        "created_at": time.time(),
    }
    with persistence_stores._store_lock:
        persistence_stores._presets.insert(0, preset)
        persistence_stores._save_json(config.PRESETS_FILE, persistence_stores._presets)
    response = _preset_response(preset)
    # ref_seconds is NOT set here any more -- _preset_response measures the saved
    # file and every later list call reads that same number, so assigning the
    # in-process duration too would let create and list disagree by an mp3 frame
    # about the same voice. Only the before/after pair is create-only: nothing
    # persisted records what the upload was trimmed FROM.
    response["trimmed_from_seconds"] = (
        round(original_duration_s, 1) if original_duration_s > duration_s + 0.05 else None
    )
    return response


class RenamePresetRequest(BaseModel):
    name: str


@router.patch("/api/presets/{preset_id}")
def rename_preset(
    preset_id: str,
    req: RenamePresetRequest,
    user_id: str = Depends(dependencies.get_current_user),
):
    """Rename a voice.

    Deliberately does NOT touch `preset_name` on existing history entries.
    That field is a snapshot of what the voice was called when the voiceover
    was generated (see _process_job), and back-filling it would rewrite the
    past -- a voiceover made by "Narrator" did not stop having been made by
    "Narrator" because the voice is called something else now.

    The name has to live here rather than in the browser. The Voiceovers list
    renames its rows in localStorage, which works because nothing server-side
    reads those names; a voice's name is read here on every generate and
    stamped into history, so a client-only rename would show one name in the
    voices dialog and a different one on every voiceover it had produced.
    """
    preset = persistence_stores._find_preset(preset_id)
    if preset is None or preset.get("user_id") != user_id or preset.get("is_builtin"):
        raise HTTPException(404, "Unknown preset_id")

    name = req.name.strip()
    if not name:
        raise HTTPException(400, "name is required")

    with persistence_stores._store_lock:
        preset["name"] = name
        persistence_stores._save_json(config.PRESETS_FILE, persistence_stores._presets)
    return _preset_response(preset)


@router.get("/api/presets/{preset_id}/download")
def download_reference(preset_id: str, user_id: str = Depends(dependencies.get_current_user)):
    """Serve a voice's reference clip as a named download.

    A route rather than linking straight at the /refs mount, for three
    reasons: the on-disk name is a uuid hex, so a bare link downloads
    "a3f9c2...mp3"; the name has to follow the voice's CURRENT name, which
    only the server knows after a rename; and /refs is an unauthenticated
    StaticFiles mount, while this checks ownership like the rest of /api.

    No conversion, unlike /api/download -- a reference clip is whatever the
    user uploaded (.mp3, .wav, .ogg, .m4a...) and re-encoding it to hand it
    back would return something other than what they put in. FileResponse
    infers the media type from the suffix.
    """
    preset = persistence_stores._find_preset(preset_id)
    if preset is None or preset.get("user_id") != user_id or preset.get("is_builtin"):
        raise HTTPException(404, "Unknown preset_id")

    try:
        src = persistence_stores._reference_path(preset)
    except persistence_media_paths.StoredMediaPathError as exc:
        raise HTTPException(404, str(exc))

    return FileResponse(
        str(src),
        filename=f"{routes_downloads._safe_filename(preset['name'])}{src.suffix.lower()}",
    )


@router.delete("/api/presets/{preset_id}")
def delete_preset(preset_id: str, user_id: str = Depends(dependencies.get_current_user)):
    with persistence_stores._store_lock:
        preset = persistence_stores._find_preset(preset_id)
        if preset is None or preset.get("user_id") != user_id or preset.get("is_builtin"):
            raise HTTPException(404, "Unknown preset_id")
        persistence_stores._presets.remove(preset)
        persistence_stores._save_json(config.PRESETS_FILE, persistence_stores._presets)
    try:
        persistence_stores._reference_path(preset).unlink(missing_ok=True)
    except persistence_media_paths.StoredMediaPathError:
        config.logger.warning("Deleted preset %s with missing reference clip", preset_id)
    return {"ok": True}
