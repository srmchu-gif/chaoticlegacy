Option Explicit

Dim shell, scriptDir, launcherPath, projectRootHint, command
Set shell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
launcherPath = scriptDir & "\\launcher.ps1"
projectRootHint = shell.CurrentDirectory
command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & launcherPath & """ -ProjectRootHint """ & projectRootHint & """"

shell.Run command, 0, False
