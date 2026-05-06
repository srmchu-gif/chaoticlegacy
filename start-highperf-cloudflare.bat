@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Chaotic Legacy - High Performance (Node local + Cloudflare Tunnel)

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "PROFILE=cloudflare-host"
set "SERVICE=cloudflared-host"
set "DOCKER_ONLY_PROFILE=cloudflare"
set "DOCKER_ONLY_APP_SERVICE=app"
set "DOCKER_ONLY_TUNNEL_SERVICE=cloudflared"
set "PUBLIC_URL=https://game.chaoticlegacy.qzz.io"
set "APP_PORT=3000"
set "NODE_PID_FILE=%ROOT_DIR%runtime\highperf-node.pid"
set "NODE_LOG_FILE=%ROOT_DIR%runtime\highperf-node.log"
set "INTERACTIVE_MODE=0"
set "RUN_MODE=High Performance (Node local + cloudflared container)"

if /i "%~1"=="start" goto CLI_START
if /i "%~1"=="stop" goto CLI_STOP
if /i "%~1"=="status" goto CLI_STATUS
if /i "%~1"=="logs" goto CLI_LOGS
if /i "%~1"=="restart" goto CLI_RESTART

:MENU
set "INTERACTIVE_MODE=1"
cls
echo ==========================================================
echo   Chaotic Legacy - High Performance Cloudflare Control
echo ==========================================================
echo.
echo 1^) Start      ^(Node local + cloudflared-host^)
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
call :deactivate_docker_only_stack || goto FAIL
echo.
echo [INFO] Modo ativo: %RUN_MODE%
call :kill_port_3000_owner
call :start_node_local || goto FAIL
echo [INFO] Subindo cloudflared-host...
docker compose --profile %PROFILE% up -d %SERVICE%
if errorlevel 1 (
  echo [ERRO] Falha ao iniciar cloudflared-host.
  goto FAIL
)
call :wait_app_health
call :wait_cloudflare_connection
echo.
call :status_core
call :post_start_public_validation
echo [OK] Servidor do game ativo em modo HIGH PERFORMANCE.
echo [URL] %PUBLIC_URL%
echo [DICA] Digite "stop" para encerrar Node local + tunnel.
echo.
call :command_loop
exit /b 0

:STOP
where docker >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Docker nao encontrado no PATH.
  goto FAIL
)
echo.
echo [INFO] Parando cloudflared-host...
docker compose --profile %PROFILE% stop %SERVICE% >nul 2>&1
call :stop_node_local
call :kill_port_3000_owner
echo [OK] Servicos parados.
echo.
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:RESTART
call :ensure_prereqs || goto FAIL
call :load_env_values || goto FAIL
call :deactivate_docker_only_stack || goto FAIL
echo.
echo [INFO] Reiniciando em modo HIGH PERFORMANCE...
call :stop_node_local
call :kill_port_3000_owner
call :start_node_local || goto FAIL
docker compose --profile %PROFILE% restart %SERVICE% >nul 2>&1
docker compose --profile %PROFILE% up -d %SERVICE% >nul 2>&1
call :wait_app_health
call :wait_cloudflare_connection
call :status_core
call :post_start_public_validation
echo [OK] Reinicio concluido.
echo.
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:STATUS
call :ensure_prereqs || goto FAIL
call :load_env_values || goto FAIL
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
echo [INFO] Ultimas linhas Node local:
powershell -NoProfile -Command "if(Test-Path '%NODE_LOG_FILE%'){ Get-Content '%NODE_LOG_FILE%' -Tail 80 } else { Write-Host '  Sem log local ainda.' }"
echo.
echo [INFO] Logs do cloudflared-host (Ctrl+C para sair):
docker compose logs -f --tail=120 %SERVICE%
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
echo [STATUS] Processo Node local:
powershell -NoProfile -Command ^
  "if(Test-Path '%NODE_PID_FILE%'){ $nodePid=(Get-Content '%NODE_PID_FILE%' -Raw).Trim(); if($nodePid -and (Get-Process -Id $nodePid -ErrorAction SilentlyContinue)){ Write-Host ('  Node local em execucao (PID ' + $nodePid + ').') } else { Write-Host '  Node local parado.' } } else { Write-Host '  Node local parado.' }"
echo.
echo [STATUS] Container tunnel:
docker compose ps %SERVICE%
echo.
echo [STATUS] Health local:
set "ORIGIN_OK=0"
powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/health' -UseBasicParsing -TimeoutSec 5; Write-Host ('  HTTP ' + $r.StatusCode); Write-Host ('  ' + $r.Content); if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { Write-Host '  Indisponivel (Node local ainda iniciando ou parado).'; exit 1 }"
if not errorlevel 1 (
  set "ORIGIN_OK=1"
  echo [DIAG] ORIGIN_OK
) else (
  echo [DIAG] ORIGIN_DOWN
)
echo.
echo [STATUS] Cloudflare tunnel:
set "CF_CONTAINER_UP=0"
set "TUNNEL_OK=0"
docker compose ps %SERVICE% | findstr /i "Up" >nul 2>&1
if not errorlevel 1 set "CF_CONTAINER_UP=1"
set "CF_CONN_COUNT=0"
if "%CF_CONTAINER_UP%"=="1" (
  for /f %%C in ('docker compose logs --tail=120 %SERVICE% ^| find /i /c "Registered tunnel connection"') do set "CF_CONN_COUNT=%%C"
)
if "%CF_CONTAINER_UP%"=="1" (
  if %CF_CONN_COUNT% GTR 0 (
    echo   Conectado ^(%CF_CONN_COUNT% conexoes registradas nos logs recentes^).
    set "TUNNEL_OK=1"
    echo [DIAG] TUNNEL_OK
  ) else (
    echo   Container ativo, aguardando conexao registrada...
    echo [DIAG] TUNNEL_DOWN
  )
) else (
  echo   Container %SERVICE% nao esta em execucao.
  echo   Use: start-highperf-cloudflare.bat start
  echo [DIAG] TUNNEL_DOWN
)
echo.
echo [URL PUBLICA]
echo   %PUBLIC_URL%
call :check_public_url
if errorlevel 1 (
  if "%ORIGIN_OK%"=="1" if "%TUNNEL_OK%"=="1" (
    echo [DIAG] EDGE_ROUTE_FAIL
    echo [DICA] No painel Cloudflare, confirme o Public Hostname em modo HighPerf para:
    echo       http://host.docker.internal:3000
  )
)
echo.
exit /b 0

:post_start_public_validation
powershell -NoProfile -Command ^
  "$status = 0; try { $r = Invoke-WebRequest '%PUBLIC_URL%' -UseBasicParsing -TimeoutSec 10; $status = [int]$r.StatusCode } catch { if($_.Exception.Response){ $status = [int]$_.Exception.Response.StatusCode } else { $status = 0 } }; if($status -eq 502){ exit 2 } elseif($status -eq 0){ exit 1 } elseif($status -in 200,301,302,303,307,308,401,403,405){ exit 0 } else { exit 1 }" >nul 2>&1
if errorlevel 2 (
  echo [AVISO] URL publica com HTTP 502 mesmo com modo highperf ativo.
  echo [ACAO] Revise no Cloudflare o hostname game.chaoticlegacy.qzz.io para:
  echo        http://host.docker.internal:3000
  exit /b 0
)
if errorlevel 1 (
  echo [AVISO] Nao foi possivel validar a URL publica neste momento.
)
exit /b 0

:command_loop
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
where node >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Node.js nao encontrado no PATH.
  exit /b 1
)
call :ensure_docker_running
if errorlevel 1 exit /b 1
if not exist "%ROOT_DIR%runtime" mkdir "%ROOT_DIR%runtime" >nul 2>&1
exit /b 0

:load_env_values
if not exist ".env" (
  echo [ERRO] Arquivo .env nao encontrado.
  exit /b 1
)
set "CF_TUNNEL_TOKEN="
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /i "%%~A"=="CF_TUNNEL_TOKEN" set "CF_TUNNEL_TOKEN=%%~B"
)
if not defined CF_TUNNEL_TOKEN (
  echo [ERRO] CF_TUNNEL_TOKEN ausente no .env.
  exit /b 1
)
exit /b 0

:start_node_local
set "NODE_ALREADY_RUNNING=0"
for /f %%R in ('powershell -NoProfile -Command "if(Test-Path ''%NODE_PID_FILE%''){ $nodePid=(Get-Content ''%NODE_PID_FILE%'' -Raw).Trim(); if($nodePid -and (Get-Process -Id $nodePid -ErrorAction SilentlyContinue)){ Write-Output '1' } else { Write-Output '0' } } else { Write-Output '0' }"') do set "NODE_ALREADY_RUNNING=%%R"
if "%NODE_ALREADY_RUNNING%"=="1" (
  echo [INFO] Node local ja estava ativo.
  exit /b 0
)
echo [INFO] Iniciando Node local em background...
set "NODE_CMD=set PORT=%APP_PORT%&& set PERSIST_DIR=%ROOT_DIR%runtime&& set SQLITE_FILE=%ROOT_DIR%runtime\\chaotic.db&& node --env-file=.env server.js"
powershell -NoProfile -Command ^
  "$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c %NODE_CMD% >> \"%NODE_LOG_FILE%\" 2>>&1' -PassThru -WindowStyle Hidden; Set-Content -Path '%NODE_PID_FILE%' -Value $p.Id"
if errorlevel 1 (
  echo [ERRO] Falha ao iniciar Node local.
  exit /b 1
)
exit /b 0

:stop_node_local
if not exist "%NODE_PID_FILE%" exit /b 0
set "NODE_PID="
set /p NODE_PID=<"%NODE_PID_FILE%"
if not defined NODE_PID (
  del /q "%NODE_PID_FILE%" >nul 2>&1
  exit /b 0
)
echo [INFO] Encerrando Node local (PID %NODE_PID%)...
taskkill /PID %NODE_PID% /F >nul 2>&1
del /q "%NODE_PID_FILE%" >nul 2>&1
exit /b 0

:kill_port_3000_owner
powershell -NoProfile -Command ^
  "$conn = Get-NetTCPConnection -LocalPort %APP_PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $conn){ Write-Host ('[INFO] Porta ' + %APP_PORT% + ' ja esta livre.'); exit 0 }; $ownerPid = [int]$conn.OwningProcess; taskkill /PID $ownerPid /F > $null 2>&1; if($LASTEXITCODE -eq 0){ Write-Host ('[OK] Processo na porta ' + %APP_PORT% + ' finalizado (PID ' + $ownerPid + ').'); exit 0 } else { Write-Host ('[AVISO] Nao foi possivel finalizar PID ' + $ownerPid + ' na porta ' + %APP_PORT% + '.'); exit 0 }"
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

:wait_app_health
echo [INFO] Verificando health do Node local...
for /l %%S in (1,1,80) do (
  powershell -NoProfile -Command ^
    "try { $r = Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/health' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    echo [OK] Node local saudavel.
    exit /b 0
  )
  >nul timeout /t 1
)
echo [AVISO] Node local ainda nao confirmou health 200.
exit /b 0

:wait_cloudflare_connection
echo [INFO] Verificando conexao do tunnel...
for /l %%S in (1,1,60) do (
  docker compose logs --tail=120 %SERVICE% | find /i "Registered tunnel connection" >nul 2>&1
  if not errorlevel 1 (
    echo [OK] Tunnel Cloudflare conectado.
    exit /b 0
  )
  >nul timeout /t 1
)
echo [AVISO] Nao foi possivel confirmar conexao do tunnel pelos logs.
exit /b 0

:deactivate_docker_only_stack
echo [INFO] Garantindo conector unico: desativando modo Docker-only...
docker compose --profile %DOCKER_ONLY_PROFILE% stop %DOCKER_ONLY_TUNNEL_SERVICE% >nul 2>&1
docker compose --profile %DOCKER_ONLY_PROFILE% stop %DOCKER_ONLY_APP_SERVICE% >nul 2>&1
set "DOCKER_APP_RUNNING=0"
set "DOCKER_TUNNEL_RUNNING=0"
for /f "delims=" %%L in ('docker compose --profile %DOCKER_ONLY_PROFILE% ps --format json %DOCKER_ONLY_APP_SERVICE% 2^>nul') do (
  set "APP_JSON=%%L"
)
if defined APP_JSON (
  echo !APP_JSON! | findstr /i "\"State\":\"running\"" >nul 2>&1
  if not errorlevel 1 set "DOCKER_APP_RUNNING=1"
  set "APP_JSON="
)
for /f "delims=" %%L in ('docker compose --profile %DOCKER_ONLY_PROFILE% ps --format json %DOCKER_ONLY_TUNNEL_SERVICE% 2^>nul') do (
  set "TUNNEL_JSON=%%L"
)
if defined TUNNEL_JSON (
  echo !TUNNEL_JSON! | findstr /i "\"State\":\"running\"" >nul 2>&1
  if not errorlevel 1 set "DOCKER_TUNNEL_RUNNING=1"
  set "TUNNEL_JSON="
)
if "%DOCKER_APP_RUNNING%"=="1" (
  echo [ERRO] Nao foi possivel parar o container %DOCKER_ONLY_APP_SERVICE% do modo Docker-only.
  exit /b 1
)
if "%DOCKER_TUNNEL_RUNNING%"=="1" (
  echo [ERRO] Nao foi possivel parar o container %DOCKER_ONLY_TUNNEL_SERVICE% do modo Docker-only.
  exit /b 1
)
exit /b 0

:check_public_url
echo.
echo [STATUS] Teste de acesso publico:
powershell -NoProfile -Command ^
  "$status = 0; try { $r = Invoke-WebRequest '%PUBLIC_URL%' -UseBasicParsing -TimeoutSec 10; $status = [int]$r.StatusCode } catch { if($_.Exception.Response){ $status = [int]$_.Exception.Response.StatusCode } else { $status = 0 } }; if($status -in 200,301,302,303,307,308,401,403,405){ Write-Host ('  OK - URL publica respondeu HTTP ' + $status + '.'); exit 0 } elseif($status -eq 502){ Write-Host '  ERRO - URL publica respondeu HTTP 502.'; exit 1 } elseif($status -eq 0){ Write-Host '  ERRO - Nao foi possivel conectar na URL publica.'; exit 1 } else { Write-Host ('  ERRO - URL publica respondeu HTTP ' + $status + '.'); exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:FAIL
if "%INTERACTIVE_MODE%"=="1" pause
exit /b 1
