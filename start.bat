@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Chaotic Legacy - Docker Cloudflare Control

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "PROFILE=cloudflare"
set "APP_SERVICE=app"
set "TUNNEL_SERVICE=cloudflared"
set "TUNNEL_HOST_SERVICE=cloudflared-host"
set "APP_PORT=3000"
set "PUBLIC_URL=https://game.chaoticlegacy.qzz.io"
set "INTERACTIVE_MODE=0"
set "RUN_MODE=Docker-only (app + cloudflared)"

if /i "%~1"=="start" goto CLI_START
if /i "%~1"=="stop" goto CLI_STOP
if /i "%~1"=="status" goto CLI_STATUS
if /i "%~1"=="logs" goto CLI_LOGS
if /i "%~1"=="restart" goto CLI_RESTART

:MENU
set "INTERACTIVE_MODE=1"
cls
echo ==========================================================
echo   Chaotic Legacy - Docker Cloudflare Control
echo ==========================================================
echo.
echo 1^) Start      ^(Docker-only^)
echo 2^) Stop
echo 3^) Status
echo 4^) Logs
echo 5^) Restart
echo 0^) Sair
echo.
set /p "OPT=Escolha uma opcao e pressione Enter: "

if "%OPT%"=="1" goto START
if "%OPT%"=="2" goto STOP
if "%OPT%"=="3" goto STATUS
if "%OPT%"=="4" goto LOGS
if "%OPT%"=="5" goto RESTART
if "%OPT%"=="0" exit /b 0
goto MENU

:CLI_START
set "INTERACTIVE_MODE=0"
goto START

:CLI_STOP
set "INTERACTIVE_MODE=0"
goto STOP

:CLI_STATUS
set "INTERACTIVE_MODE=0"
goto STATUS

:CLI_LOGS
set "INTERACTIVE_MODE=0"
goto LOGS

:CLI_RESTART
set "INTERACTIVE_MODE=0"
goto RESTART

:START
call :ensure_prereqs || goto FAIL
call :load_env_values || goto FAIL
echo.
echo [INFO] Modo ativo: %RUN_MODE%
call :ensure_docker_only_connector
call :resolve_port_conflict || goto FAIL
echo [INFO] Subindo app + cloudflared...
docker compose --profile %PROFILE% up -d %APP_SERVICE% %TUNNEL_SERVICE%
if errorlevel 1 (
  echo [ERRO] Falha ao subir containers.
  goto FAIL
)
call :wait_app_healthy || goto FAIL
call :wait_tunnel_connected
call :status_core
call :command_loop
exit /b 0

:STOP
call :ensure_prereqs || goto FAIL
echo.
echo [INFO] Parando stack Docker-only...
docker compose --profile %PROFILE% stop %TUNNEL_SERVICE% %APP_SERVICE% >nul 2>&1
call :ensure_docker_only_connector
echo [OK] Containers parados.
echo.
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:RESTART
call :ensure_prereqs || goto FAIL
call :load_env_values || goto FAIL
echo.
echo [INFO] Reiniciando stack Docker-only...
call :ensure_docker_only_connector
call :resolve_port_conflict || goto FAIL
docker compose --profile %PROFILE% up -d %APP_SERVICE% %TUNNEL_SERVICE%
if errorlevel 1 (
  echo [ERRO] Falha ao reiniciar containers.
  goto FAIL
)
call :wait_app_healthy || goto FAIL
call :wait_tunnel_connected
call :status_core
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:STATUS
call :ensure_prereqs || goto FAIL
call :load_env_values || goto FAIL
call :ensure_docker_only_connector
echo.
call :status_core
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:LOGS
call :ensure_prereqs || goto FAIL
echo.
echo [INFO] Logs app (Ctrl+C para sair):
docker compose logs -f --tail=120 %APP_SERVICE%
echo.
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:status_core
echo [STATUS] Modo:
echo   %RUN_MODE%
echo.
echo [STATUS] Containers:
docker compose --profile %PROFILE% ps
echo.
call :autoheal_if_needed
call :autoheal_tunnel_if_needed
echo.
echo [STATUS] Health local:
powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/health' -UseBasicParsing -TimeoutSec 6; Write-Host ('  HTTP ' + $r.StatusCode); if($r.StatusCode -eq 200){ exit 0 } else { exit 2 } } catch { Write-Host '  Indisponivel'; exit 1 }"
set "ORIGIN_OK=0"
if not errorlevel 1 set "ORIGIN_OK=1"
if "%ORIGIN_OK%"=="1" (
  echo [DIAG] ORIGIN_OK
) else (
  echo [DIAG] ORIGIN_DOWN
)
echo.
echo [STATUS] Cloudflare tunnel:
set "TUNNEL_CONN=0"
for /f %%C in ('docker compose logs --tail=120 %TUNNEL_SERVICE% ^| find /i /c "Registered tunnel connection"') do set "TUNNEL_CONN=%%C"
if %TUNNEL_CONN% GTR 0 (
  echo [DIAG] TUNNEL_OK ^(%TUNNEL_CONN% conexoes recentes^)
) else (
  echo [DIAG] TUNNEL_ONLY ^(sem conexao registrada recentemente^)
)
echo.
echo [STATUS] URL publica:
powershell -NoProfile -Command ^
  "$status=0; try { $r = Invoke-WebRequest '%PUBLIC_URL%' -UseBasicParsing -TimeoutSec 12; $status=[int]$r.StatusCode } catch { if($_.Exception.Response){ $status=[int]$_.Exception.Response.StatusCode } else { $status=0 } }; if($status -in 200,301,302,303,307,308,401,403,405){ Write-Host ('  OK - HTTP ' + $status); exit 0 } elseif($status -eq 502){ Write-Host '  ERRO - HTTP 502'; exit 2 } elseif($status -eq 0){ Write-Host '  ERRO - sem conexao'; exit 1 } else { Write-Host ('  ERRO - HTTP ' + $status); exit 1 }"
set "URL_STATUS=%ERRORLEVEL%"
if errorlevel 2 (
  if "%ORIGIN_OK%"=="1" (
    echo [DIAG] EDGE_ROUTE_FAIL
  )
)
call :check_tunnel_metrics_delta
if not "%ORIGIN_OK%"=="1" exit /b 1
if not "%URL_STATUS%"=="0" exit /b 1
exit /b 0

:check_tunnel_metrics_delta
set "REQ_BEFORE="
set "REQ_AFTER="
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$m = docker run --rm --network chaotic-api-main_chaotic_net curlimages/curl:8.8.0 -s http://%TUNNEL_SERVICE%:20241/metrics 2>$null; $k=[regex]::Match($m,'cloudflared_tunnel_total_requests\s+([0-9]+)'); if($k.Success){$k.Groups[1].Value} else {'NA'}"`) do set "REQ_BEFORE=%%R"
if "%REQ_BEFORE%"=="NA" (
  echo [DIAG] METRICS_UNAVAILABLE
  exit /b 0
)
powershell -NoProfile -Command "try { Invoke-WebRequest '%PUBLIC_URL%/health' -UseBasicParsing -TimeoutSec 8 > $null } catch { }" >nul 2>&1
for /f "usebackq delims=" %%R in (`powershell -NoProfile -Command "$m = docker run --rm --network chaotic-api-main_chaotic_net curlimages/curl:8.8.0 -s http://%TUNNEL_SERVICE%:20241/metrics 2>$null; $k=[regex]::Match($m,'cloudflared_tunnel_total_requests\s+([0-9]+)'); if($k.Success){$k.Groups[1].Value} else {'NA'}"`) do set "REQ_AFTER=%%R"
if "%REQ_AFTER%"=="NA" (
  echo [DIAG] METRICS_UNAVAILABLE
  exit /b 0
)
set /a REQ_DELTA=%REQ_AFTER%-%REQ_BEFORE%
if %REQ_DELTA% GTR 0 (
  echo [DIAG] TUNNEL_METRICS_OK ^(requests +%REQ_DELTA%^)
) else (
  echo [DIAG] TUNNEL_METRICS_STUCK ^(requests +0^)
)
exit /b 0

:autoheal_if_needed
set "APP_HEALTH_RAW="
for /f "delims=" %%H in ('docker compose --profile %PROFILE% ps --format json %APP_SERVICE% 2^>nul') do set "APP_HEALTH_RAW=%%H"
if not defined APP_HEALTH_RAW (
  echo [AUTOHEAL] app ausente; iniciando...
  docker compose --profile %PROFILE% up -d %APP_SERVICE% >nul 2>&1
  call :wait_app_healthy >nul 2>&1
  goto :eof
)
echo !APP_HEALTH_RAW! | findstr /i "\"State\":\"running\"" >nul 2>&1
if errorlevel 1 (
  echo [AUTOHEAL] app parado; iniciando...
  docker compose --profile %PROFILE% up -d %APP_SERVICE% >nul 2>&1
  call :wait_app_healthy >nul 2>&1
  goto :eof
)
echo !APP_HEALTH_RAW! | findstr /i "\"Health\":\"healthy\"" >nul 2>&1
if errorlevel 1 (
  echo [AUTOHEAL] app em startup; aguardando health...
  call :wait_app_healthy >nul 2>&1
)
goto :eof

:autoheal_tunnel_if_needed
set "TUNNEL_HEALTH_RAW="
for /f "delims=" %%H in ('docker compose --profile %PROFILE% ps --format json %TUNNEL_SERVICE% 2^>nul') do set "TUNNEL_HEALTH_RAW=%%H"
if not defined TUNNEL_HEALTH_RAW (
  echo [AUTOHEAL] tunnel ausente; iniciando...
  docker compose --profile %PROFILE% up -d %TUNNEL_SERVICE% >nul 2>&1
  call :wait_tunnel_connected >nul 2>&1
  goto :eof
)
echo !TUNNEL_HEALTH_RAW! | findstr /i "\"State\":\"running\"" >nul 2>&1
if errorlevel 1 (
  echo [AUTOHEAL] tunnel parado; iniciando...
  docker compose --profile %PROFILE% up -d %TUNNEL_SERVICE% >nul 2>&1
  call :wait_tunnel_connected >nul 2>&1
)
goto :eof

:ensure_docker_only_connector
docker compose --profile cloudflare-host stop %TUNNEL_HOST_SERVICE% >nul 2>&1
set "HF_RUNNING=0"
for /f "delims=" %%H in ('docker compose --profile cloudflare-host ps --format json %TUNNEL_HOST_SERVICE% 2^>nul') do set "HF_RAW=%%H"
if defined HF_RAW (
  echo !HF_RAW! | findstr /i "\"State\":\"running\"" >nul 2>&1
  if not errorlevel 1 set "HF_RUNNING=1"
)
if "%HF_RUNNING%"=="1" (
  echo [AVISO] Nao foi possivel desativar %TUNNEL_HOST_SERVICE%. Resolva antes de continuar.
)
exit /b 0

:resolve_port_conflict
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%scripts\docker_port_guard.ps1" -Port %APP_PORT%
if errorlevel 2 exit /b 1
if errorlevel 1 exit /b 1
exit /b 0

:wait_app_healthy
for /l %%S in (1,1,90) do (
  powershell -NoProfile -Command ^
    "try { $r=Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/health' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    echo [OK] app saudavel em http://127.0.0.1:%APP_PORT%/health
    exit /b 0
  )
  >nul timeout /t 1
)
echo [ERRO] ORIGIN_DOWN: app nao ficou saudavel a tempo.
docker compose --profile %PROFILE% logs --tail=80 %APP_SERVICE%
exit /b 1

:wait_tunnel_connected
for /l %%S in (1,1,40) do (
  docker compose logs --tail=120 %TUNNEL_SERVICE% | find /i "Registered tunnel connection" >nul 2>&1
  if not errorlevel 1 (
    echo [OK] Tunnel Cloudflare conectado.
    exit /b 0
  )
  >nul timeout /t 1
)
echo [AVISO] TUNNEL_ONLY: nao foi possivel confirmar conexao do tunnel pelos logs.
exit /b 0

:ensure_prereqs
if not exist "docker-compose.yml" (
  echo [ERRO] docker-compose.yml nao encontrado.
  exit /b 1
)
where docker >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Docker nao encontrado no PATH.
  exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Docker Compose nao esta disponivel.
  exit /b 1
)
call :ensure_docker_running
if errorlevel 1 exit /b 1
exit /b 0

:load_env_values
if not exist ".env" (
  echo [ERRO] Arquivo .env nao encontrado.
  exit /b 1
)
set "CF_TUNNEL_TOKEN="
set "APP_PUBLIC_PORT="
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /i "%%~A"=="CF_TUNNEL_TOKEN" set "CF_TUNNEL_TOKEN=%%~B"
  if /i "%%~A"=="APP_PUBLIC_PORT" set "APP_PUBLIC_PORT=%%~B"
)
if not defined CF_TUNNEL_TOKEN (
  echo [ERRO] CF_TUNNEL_TOKEN ausente no .env.
  exit /b 1
)
if not defined APP_PUBLIC_PORT (
  echo [ERRO] APP_PUBLIC_PORT ausente no .env.
  exit /b 1
)
if /i not "%APP_PUBLIC_PORT%"=="%APP_PORT%" (
  echo [ERRO] APP_PUBLIC_PORT=%APP_PUBLIC_PORT% invalido para modo Docker-only.
  echo [ERRO] Defina APP_PUBLIC_PORT=%APP_PORT% no .env.
  exit /b 1
)
exit /b 0

:ensure_docker_running
docker info >nul 2>&1
if not errorlevel 1 exit /b 0

set "DOCKER_DESKTOP_EXE="
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
  set "DOCKER_DESKTOP_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe"
)
if not defined DOCKER_DESKTOP_EXE if exist "%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe" (
  set "DOCKER_DESKTOP_EXE=%LocalAppData%\Programs\Docker\Docker\Docker Desktop.exe"
)
if not defined DOCKER_DESKTOP_EXE (
  echo [ERRO] Docker Desktop nao encontrado. Inicie manualmente e tente novamente.
  exit /b 1
)

echo [INFO] Docker Desktop nao esta pronto. Abrindo...
start "" "%DOCKER_DESKTOP_EXE%" >nul 2>&1
echo [INFO] Aguardando Docker ficar pronto...
for /l %%S in (1,1,120) do (
  docker info >nul 2>&1
  if not errorlevel 1 (
    echo [OK] Docker pronto.
    exit /b 0
  )
  >nul timeout /t 2
)
echo [ERRO] Docker Desktop nao ficou pronto a tempo.
exit /b 1

:command_loop
echo.
echo [CMD] Comandos disponiveis: stop ^| status ^| logs ^| restart
:command_loop_read
set "USER_CMD="
set /p "USER_CMD=> "
if /i "!USER_CMD!"=="stop" goto STOP
if /i "!USER_CMD!"=="status" (
  call :status_core
  goto command_loop_read
)
if /i "!USER_CMD!"=="logs" (
  call :LOGS
  goto command_loop_read
)
if /i "!USER_CMD!"=="restart" (
  call :RESTART
  goto command_loop_read
)
if "!USER_CMD!"=="" goto command_loop_read
echo [INFO] Comando invalido. Use: stop ^| status ^| logs ^| restart
goto command_loop_read

:FAIL
if "%INTERACTIVE_MODE%"=="1" pause
exit /b 1
