param(
  [int]$Port = 3000
)

$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $conn) {
  exit 0
}

$ownerPid = [int]$conn.OwningProcess
$proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ownerPid) -ErrorAction SilentlyContinue
$name = [string]$proc.Name
$cmd = [string]$proc.CommandLine

if ($name -match '(?i)^node(\.exe)?$' -and $cmd -match '(?i)server\.js' -and $cmd -match '(?i)--env-file=\.env') {
  try {
    Stop-Process -Id $ownerPid -Force -ErrorAction Stop
    Write-Host ("[INFO] Processo Node local encerrado para liberar porta {0} (PID {1})." -f $Port, $ownerPid)
    exit 0
  } catch {
    Write-Host ("[ERRO] Nao foi possivel encerrar o processo Node local na porta {0} (PID {1})." -f $Port, $ownerPid)
    exit 2
  }
}

if ($name -match '(?i)^(docker-proxy\.exe|com\.docker\.backend\.exe|vmmem)$') {
  exit 0
}

Write-Host ("[ERRO] PORT_CONFLICT: porta {0} ocupada por PID {1} ({2})." -f $Port, $ownerPid, $name)
Write-Host "[ERRO] Encerre esse processo ou troque a porta antes de iniciar em modo Docker-only."
exit 1
