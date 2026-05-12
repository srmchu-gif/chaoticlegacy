@echo off
setlocal
set "ROOT=%~dp0"
set "PS1=%ROOT%scripts\delete-user-safe.ps1"
set "PROJECT_ROOT=%ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -ProjectRoot "%PROJECT_ROOT%"
if errorlevel 1 (
  echo.
  echo Falha ao abrir painel admin local.
  pause
)
endlocal
