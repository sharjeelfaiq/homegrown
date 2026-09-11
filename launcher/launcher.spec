# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

REPO_ROOT = Path(SPEC).resolve().parent.parent
ICON = REPO_ROOT / "assets" / "icon.ico"

a = Analysis(
    ["launcher.py"],
    pathex=[],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    cipher=None,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=None)
exe = EXE(
    pyz, a.scripts, a.binaries, a.zipfiles, a.datas, [],
    name="Homegrown",
    debug=False,
    strip=False,
    upx=False,
    console=False,
    icon=str(ICON) if ICON.exists() else None,
    onefile=True,
)
