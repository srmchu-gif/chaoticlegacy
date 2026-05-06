@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "BACKUPS=%ROOT%backups"
set "RUNTIME_DB=%ROOT%runtime\chaotic.db"

echo [RESTORE] Projeto: %ROOT%
if not exist "%BACKUPS%" (
  echo [ERRO] Pasta de backups nao encontrada: %BACKUPS%
  exit /b 1
)

for /f "delims=" %%F in ('dir /b /a-d /o-d "%BACKUPS%\chaotic-*.db" 2^>nul') do (
  set "LATEST=%%F"
  goto :found_backup
)

echo [ERRO] Nenhum backup encontrado em %BACKUPS%.
exit /b 1

:found_backup
set "BACKUP_PATH=%BACKUPS%\%LATEST%"
echo [RESTORE] Backup mais recente: %BACKUP_PATH%

set /p "CONFIRM=Deseja restaurar este backup para runtime\\chaotic.db? (S/N): "
if /I not "%CONFIRM%"=="S" (
  echo [CANCELADO] Restauracao abortada pelo usuario.
  exit /b 0
)

if exist "%RUNTIME_DB%" (
  set "STAMP=%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%-%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
  set "STAMP=%STAMP: =0%"
  set "PREV=%ROOT%runtime\chaotic.db.pre_restore.%STAMP%"
  copy /y "%RUNTIME_DB%" "%PREV%" >nul
  if errorlevel 1 (
    echo [ERRO] Nao foi possivel criar backup pre-restore.
    exit /b 1
  )
  echo [RESTORE] Backup pre-restore salvo em: %PREV%
)

copy /y "%BACKUP_PATH%" "%RUNTIME_DB%" >nul
if errorlevel 1 (
  echo [ERRO] Falha ao copiar backup para runtime\\chaotic.db.
  echo [DICA] Pare o servidor antes da restauracao e tente novamente.
  exit /b 1
)

echo [RESTORE] Banco restaurado com sucesso.
echo [CHECK] Executando verificacao de integridade...
sqlite3 "%RUNTIME_DB%" "PRAGMA integrity_check;" 2>nul
if errorlevel 1 (
  echo [AVISO] sqlite3 nao encontrado ou verificacao nao executada.
  echo [DICA] Inicie o servidor e valide em /health.
  exit /b 0
)

echo [OK] Verificacao solicitada. Confira retorno acima.
exit /b 0
