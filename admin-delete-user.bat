@echo off
setlocal
set "ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\delete-user-safe.ps1" -ProjectRoot "%ROOT%"
if errorlevel 1 (
  echo.
  echo Falha ao abrir utilitario de exclusao.
  pause
)
endlocal
