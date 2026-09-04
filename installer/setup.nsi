; Voice Clone Studio -- Windows Installer
; Compile with: makensis setup.nsi   (run from the installer/ folder)

!define APP_NAME "Voice Clone Studio"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "Runtime Gurus"
!define INSTALL_DIR "$LOCALAPPDATA\Programs\VoiceCloneStudio"
; Deliberately distinct from a plain "VoiceCloneStudio" key: a separate,
; Electron-based build of this same app (different repo) previously used that
; exact key name, and InstallDirRegKey below reusing it silently redirected
; this installer to that build's leftover InstallLocation instead of
; ${INSTALL_DIR}. A unique key avoids ever colliding with it again.
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\VoiceCloneStudioPy"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "..\dist\VoiceCloneStudio-Setup-${APP_VERSION}.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
; Per-user, no admin/UAC required -- installs to %LOCALAPPDATA%, works on
; office machines where the user's Windows account has no admin rights.
; $DESKTOP/$SMPROGRAMS and the uninstall registry key below resolve to the
; current user's own locations (not all-users) under this execution level.
RequestExecutionLevel user
; Not /SOLID: makensis is a 32-bit process and the backend bundle (~5GB,
; mostly torch/CUDA DLLs) overflows its single mmap'd solid datablock
; ("Internal compiler error #12345: error mmapping datablock"). Per-file lzma
; avoids that one-giant-block requirement at a small cost to compression ratio.
SetCompressor lzma

!include "MUI2.nsh"
!define MUI_ABORTWARNING
!define MUI_ICON "..\assets\icon.ico"
!define MUI_UNICON "..\assets\icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Welcome to Voice Clone Studio Setup"
!define MUI_WELCOMEPAGE_TEXT "This will install Voice Clone Studio on your computer.$\r$\n$\r$\nREQUIREMENT: An NVIDIA GPU with up-to-date CUDA drivers is required. The app will show an error message if no compatible GPU is found.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\VoiceCloneStudio.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Voice Clone Studio now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Main" SecMain
  SetOutPath "$INSTDIR"
  File "..\launcher\dist\VoiceCloneStudio.exe"

  ; Backend bundle (backend.exe + all its DLLs/data, incl. the built frontend
  ; under backend\frontend_dist -- see backend.spec's `datas`).
  SetOutPath "$INSTDIR\backend"
  File /r "..\backend\dist\backend\*.*"

  ; Storage folder -- survives reinstalls/uninstalls unless the user opts in
  ; to deleting it (see the Uninstall section below).
  SetOutPath "$INSTDIR\storage\references"
  SetOutPath "$INSTDIR\storage\generated"

  ; Model snapshot downloaded on first run (see backend/run.py) -- not
  ; bundled in the installer, kept out of the ~2.5GB download this way.
  SetOutPath "$INSTDIR\models"

  ; .env pins the paths run.py would otherwise infer -- kept explicit so an
  ; advanced user can repoint MODEL_PATH at an existing snapshot.
  SetOutPath "$INSTDIR\backend"
  FileOpen $0 "$INSTDIR\backend\.env" w
  FileWrite $0 "MODEL_PATH=$INSTDIR\models$\r$\n"
  FileWrite $0 "VOICECLONE_STORAGE_DIR=$INSTDIR\storage$\r$\n"
  FileClose $0

  CreateShortcut "$DESKTOP\Voice Clone Studio.lnk" "$INSTDIR\VoiceCloneStudio.exe" "" "$INSTDIR\VoiceCloneStudio.exe" 0
  CreateDirectory "$SMPROGRAMS\Voice Clone Studio"
  CreateShortcut "$SMPROGRAMS\Voice Clone Studio\Voice Clone Studio.lnk" "$INSTDIR\VoiceCloneStudio.exe"
  CreateShortcut "$SMPROGRAMS\Voice Clone Studio\Uninstall.lnk" "$INSTDIR\Uninstall.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  MessageBox MB_YESNO "Do you want to delete your voice presets and generation history?$\r$\n$\r$\nClick Yes to delete everything.$\r$\nClick No to keep your data for a future reinstall." IDYES DeleteData IDNO SkipData

  DeleteData:
    RMDir /r "$INSTDIR\storage"
    RMDir /r "$INSTDIR\models"
    Goto DoneData
  SkipData:
    Goto DoneData
  DoneData:

  Delete "$INSTDIR\VoiceCloneStudio.exe"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir /r "$INSTDIR\backend"
  RMDir "$INSTDIR"

  Delete "$DESKTOP\Voice Clone Studio.lnk"
  Delete "$SMPROGRAMS\Voice Clone Studio\Voice Clone Studio.lnk"
  Delete "$SMPROGRAMS\Voice Clone Studio\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Voice Clone Studio"

  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
