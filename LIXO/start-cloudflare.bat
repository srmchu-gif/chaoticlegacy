@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Chaotic Legacy - Cloudflare Tunnel Control

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "COMPOSE_FILE=%ROOT_DIR%docker-compose.yml"
set "PROFILE=cloudflare"
set "SERVICES=app cloudflared"
set "PUBLIC_URL=https://game.chaoticlegacy.qzz.io"
set "APP_PORT=25565"
set "INTERACTIVE_MODE=0"
set "RUN_MODE=Docker completo"

if /i "%~1"=="start" goto CLI_START
if /i "%~1"=="stop" goto CLI_STOP
if /i "%~1"=="status" goto CLI_STATUS
if /i "%~1"=="logs" goto CLI_LOGS
if /i "%~1"=="restart" goto CLI_RESTART

:MENU
set "INTERACTIVE_MODE=1"
cls
echo ==============================================
echo   Chaotic Legacy - Cloudflare Tunnel Control
echo ==============================================
echo.
echo 1^) Start      ^(sobe app + tunnel, depois comando: stop^)
echo 2^) Stop       ^(desliga app + tunnel^)
echo 3^) Status     ^(containers + health + URL^)
echo 4^) Logs       ^(tail de logs do tunnel^)
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
echo [INFO] Subindo app e tunnel (Cloudflare)...
echo [INFO] Uso diario recomendado: docker compose --profile %PROFILE% up -d %SERVICES%
docker compose --profile %PROFILE% up -d %SERVICES%
if errorlevel 1 (
  echo [ERRO] Falha ao iniciar os servicos.
  goto FAIL
)

call :wait_app_health
call :wait_cloudflare_connection

echo.
echo [OK] Servidor do game ativo.
echo [URL] %PUBLIC_URL%
echo [DICA] Digite "stop" para encerrar app+tunnel.
echo.
call :status_core
call :command_loop
exit /b 0

:STOP
call :ensure_prereqs || goto FAIL
echo.
echo [INFO] Parando app e tunnel...
docker compose --profile %PROFILE% stop %SERVICES%
if errorlevel 1 (
  echo [ERRO] Falha ao parar os servicos.
  goto FAIL
)
echo [OK] Servicos parados.
echo.
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:RESTART
call :ensure_prereqs || goto FAIL
echo.
echo [INFO] Reiniciando app e tunnel...
docker compose --profile %PROFILE% restart %SERVICES%
if errorlevel 1 (
  echo [ERRO] Falha ao reiniciar os servicos.
  goto FAIL
)
echo [OK] Servicos reiniciados.
echo.
call :status_core
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
echo [INFO] Logs do cloudflared (Ctrl+C para sair)...
docker compose logs -f --tail=120 cloudflared
echo.
if "%INTERACTIVE_MODE%"=="1" (
  pause
  goto MENU
)
exit /b 0

:status_core
echo [STATUS] Containers:
docker compose ps
echo.
echo [STATUS] Health local:
powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/health' -UseBasicParsing -TimeoutSec 5; Write-Host ('  HTTP ' + $r.StatusCode); Write-Host ('  ' + $r.Content) } catch { Write-Host '  Indisponivel (app ainda iniciando ou parada).' }"
echo.
echo [STATUS] Cloudflare tunnel:
set "CF_CONTAINER_UP=0"
docker compose ps cloudflared | findstr /i "Up" >nul 2>&1
if not errorlevel 1 set "CF_CONTAINER_UP=1"
set "CF_CONN_COUNT=0"
for /f %%C in ('docker compose logs --tail=120 cloudflared ^| find /i /c "Registered tunnel connection"') do set "CF_CONN_COUNT=%%C"
if "%CF_CONTAINER_UP%"=="1" (
  if %CF_CONN_COUNT% GTR 0 (
    echo   Conectado ^(%CF_CONN_COUNT% conexoes registradas nos logs recentes^).
  ) else (
    echo   Container ativo, aguardando conexao registrada...
  )
) else (
  echo   Container cloudflared nao esta em execucao.
  echo   Use: start-cloudflare.bat start
)
echo.
echo [URL PUBLICA]
echo   %PUBLIC_URL%
call :check_public_url
echo.
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
  echo [INFO] Logs do cloudflared (Ctrl+C para sair)...
  docker compose logs -f --tail=120 cloudflared
  goto command_loop_read
)
if /i "!USER_CMD!"=="restart" (
  echo [INFO] Reiniciando app e tunnel...
  docker compose --profile %PROFILE% restart %SERVICES%
  if errorlevel 1 (
    echo [ERRO] Falha ao reiniciar os servicos.
  ) else (
    echo [OK] Servicos reiniciados.
    call :status_core
  )
  goto command_loop_read
)
if "!USER_CMD!"=="" goto command_loop_read
echo [INFO] Comando invalido. Use: stop ^| status ^| logs ^| restart
goto command_loop_read

:ensure_prereqs
if not exist "%COMPOSE_FILE%" (
  echo [ERRO] docker-compose.yml nao encontrado em:
  echo        %ROOT_DIR%
  exit /b 1
)
where docker >nul 2>nul
if errorlevel 1 (
  echo [ERRO] Docker nao encontrado no PATH.
  echo        Abra o Docker Desktop e tente novamente.
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
  echo        Crie a partir de .env.example e defina CF_TUNNEL_TOKEN.
  exit /b 1
)
set "CF_TUNNEL_TOKEN="
set "APP_PUBLIC_PORT="
set "SMTP_PASS="
for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
  if /i "%%~A"=="CF_TUNNEL_TOKEN" set "CF_TUNNEL_TOKEN=%%~B"
  if /i "%%~A"=="APP_PUBLIC_PORT" set "APP_PUBLIC_PORT=%%~B"
  if /i "%%~A"=="SMTP_PASS" set "SMTP_PASS=%%~B"
)
if not defined CF_TUNNEL_TOKEN (
  echo [ERRO] CF_TUNNEL_TOKEN ausente no .env.
  echo        Defina um token valido do Cloudflare Tunnel.
  exit /b 1
)
if defined APP_PUBLIC_PORT set "APP_PORT=%APP_PUBLIC_PORT%"
if not defined SMTP_PASS (
  echo [AVISO] SMTP_PASS nao definido no .env.
) else (
  echo %SMTP_PASS% | findstr /i /c:"COLOQUE_APP_PASSWORD_GMAIL_AQUI" >nul 2>&1
  if not errorlevel 1 (
    echo [AVISO] SMTP_PASS ainda esta com placeholder. Registro por email vai falhar.
  )
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

:wait_app_health
echo [INFO] Verificando health da app...
for /l %%S in (1,1,60) do (
  powershell -NoProfile -Command ^
    "try { $r = Invoke-WebRequest 'http://127.0.0.1:%APP_PORT%/health' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    echo [OK] App saudavel.
    exit /b 0
  )
  >nul timeout /t 1
)
echo [AVISO] App ainda nao confirmou health 200. Pode estar inicializando.
exit /b 0

:wait_cloudflare_connection
echo [INFO] Verificando conexao do tunnel...
for /l %%S in (1,1,60) do (
  docker compose logs --tail=120 cloudflared | find /i "Registered tunnel connection" >nul 2>&1
  if not errorlevel 1 (
    echo [OK] Tunnel Cloudflare conectado.
    exit /b 0
  )
  docker compose logs --tail=120 cloudflared | find /i "Unauthorized" >nul 2>&1
  if not errorlevel 1 (
    echo [ERRO] Token invalido/expirado no cloudflared.
    exit /b 1
  )
  >nul timeout /t 1
)
echo [AVISO] Nao foi possivel confirmar conexao do tunnel pelos logs.
echo        Rode: start-cloudflare.bat logs
exit /b 0

:check_public_url
echo.
echo [STATUS] Teste de acesso publico:
powershell -NoProfile -Command ^
  "$status = 0; try { $r = Invoke-WebRequest '%PUBLIC_URL%' -UseBasicParsing -TimeoutSec 10; $status = [int]$r.StatusCode } catch { if($_.Exception.Response){ $status = [int]$_.Exception.Response.StatusCode } else { $status = 0 } }; if($status -in 200,301,302,303,307,308,401,403,405){ Write-Host ('  OK - URL publica respondeu HTTP ' + $status + '.'); exit 0 } elseif($status -eq 502){ Write-Host '  ERRO - URL publica respondeu HTTP 502. Verifique o Public Hostname no Cloudflare apontando para http://app:3000 (modo Docker completo).'; exit 1 } elseif($status -eq 0){ Write-Host '  ERRO - Nao foi possivel conectar na URL publica.'; exit 1 } else { Write-Host ('  ERRO - URL publica respondeu HTTP ' + $status + '.'); exit 1 }"
if errorlevel 1 exit /b 1
exit /b 0

:FAIL
if "%INTERACTIVE_MODE%"=="1" pause
exit /b 1
