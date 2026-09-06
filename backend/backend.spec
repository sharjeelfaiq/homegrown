# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for backend.exe.

Build from the backend/ folder:
    pyinstaller backend.spec --clean

Torch's Windows wheel bundles CUDA (cublas/cudnn/cufft/...) directly as DLLs
inside torch/lib/ (no separate nvidia-*-cu12 packages on this machine), so a
plain collect_all('torch') picks up everything needed -- no manual DLL
copying required. transformers uses a lazy-module __getattr__ mechanism that
static analysis can't see through; collect_all's collect_submodules walks the
installed package tree on disk instead of following imports, which is what
actually catches it.
"""
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

block_cipher = None
REPO_ROOT = Path(SPEC).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"

datas = []
binaries = []
hiddenimports = []

for pkg in [
    "torch",
    "numpy",
    "fastapi",
    "uvicorn",
    "starlette",
    "soundfile",
    "faster_whisper",
    "ctranslate2",
    "av",
    "filelock",
    "dotenv",
    "pydantic",
    "pydantic_core",
    "anyio",
    "click",
    "h11",
    "httptools",
    "requests",
    "transformers",
    "accelerate",
    "huggingface_hub",
    "safetensors",
    "tokenizers",
    "qwen_tts",
    "einops",
    "multipart",
]:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as e:
        print(f"WARNING: collect_all({pkg!r}) failed: {e}")

# Vendored FasterQwen3TTS package -- not pip-installed, so it's shipped as raw
# source under the bundle root. PyInstaller adds the bundle dir to sys.path
# automatically, so `from qwen import FasterQwen3TTS` resolves at runtime like
# an ordinary filesystem package even though static analysis can't trace it.
datas += [(str(REPO_ROOT / "qwen"), "qwen")]

# Built frontend (must exist -- run `npm run build` in frontend/ first).
frontend_dist = REPO_ROOT / "frontend" / "dist"
if not frontend_dist.is_dir() or not (frontend_dist / "index.html").exists():
    raise SystemExit(
        "frontend/dist is missing or incomplete -- run `npm run build` in frontend/ before building backend.spec"
    )
datas += [(str(frontend_dist), "frontend_dist")]

a = Analysis(
    ["run.py"],
    pathex=[str(BACKEND_DIR)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + [
        "main", "auth", "audio_convert", "audio_stitcher", "text_chunker",
        "boot_status",
        "uvicorn.logging",
        "uvicorn.loops", "uvicorn.loops.auto",
        "uvicorn.protocols", "uvicorn.protocols.http", "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets", "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan", "uvicorn.lifespan.on",
        "fastapi.middleware.cors",
        "pydantic.v1",
        "multipart",
        "python_multipart",
    ],
    hookspath=[],
    excludes=[],
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="backend",
    debug=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False,
    upx=False,
    name="backend",
)
