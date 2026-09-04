' Runs start_server.bat with no visible console window -- used by the
' Task Scheduler "at logon" auto-start task so nothing pops up on screen.
' For manual/debugging use, double-click start_server.bat directly instead.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Run """" & scriptDir & "\start_server.bat""", 0, False
