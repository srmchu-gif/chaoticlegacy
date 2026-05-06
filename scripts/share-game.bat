@echo off
setlocal EnableExtensions
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.." >nul 2>&1

echo [DEPRECATED] scripts\share-game.bat foi integrado ao start-cloudflare.bat.
echo              Redirecionando para o novo fluxo Cloudflare-only...
echo.
call "%CD%\start-cloudflare.bat" %*
set "EXIT_CODE=%ERRORLEVEL%"

popd >nul 2>&1
exit /b %EXIT_CODE%
