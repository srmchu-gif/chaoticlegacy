param(
  [string]$ProjectRootHint = ""
)

$ErrorActionPreference = "Stop"
$global:LauncherLogFile = Join-Path ([System.IO.Path]::GetTempPath()) "chaotic-launcher.log"

function Write-LauncherLog {
  param([string]$Message)

  $line = ("{0} | {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message)
  try {
    Add-Content -LiteralPath $global:LauncherLogFile -Value $line -Encoding ASCII
  } catch {
    # Ignore log write issues.
  }
}

function Show-LauncherError {
  param([string]$Message)

  try {
    Add-Type -AssemblyName PresentationFramework -ErrorAction Stop
    [System.Windows.MessageBox]::Show($Message, "Chaotic Launcher") | Out-Null
  } catch {
    # Ignore UI fallback errors.
  }
}

function Resolve-EdgePath {
  $resolved = Get-Command "msedge.exe" -ErrorAction SilentlyContinue
  if ($resolved -and $resolved.Source) {
    return $resolved.Source
  }

  $knownPaths = @(
    "$env:ProgramFiles (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "$env:ProgramFiles\\Microsoft\\Edge\\Application\\msedge.exe",
    "$env:LocalAppData\\Microsoft\\Edge\\Application\\msedge.exe"
  )

  foreach ($candidate in $knownPaths) {
    if (Test-Path -LiteralPath $candidate) {
      return $candidate
    }
  }

  return $null
}

function Resolve-NodePath {
  $node = Get-Command "node" -ErrorAction SilentlyContinue
  if ($node -and $node.Source) {
    return $node.Source
  }

  return $null
}

function Stop-ProcessTree {
  param([int]$ProcessId)

  if ($ProcessId -le 0) {
    return
  }

  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    return
  }

  try {
    & taskkill.exe /PID $ProcessId /T /F | Out-Null
  } catch {
    # Ignore cleanup failures.
  }
}

function Wait-ServerReady {
  param(
    [string]$HealthUrl,
    [int]$TimeoutSeconds,
    [System.Diagnostics.Process]$ServerProcess
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if ($ServerProcess.HasExited) {
      throw "Node server stopped before startup completed."
    }

    try {
      $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
        return
      }
    } catch {
      # Keep polling until timeout.
    }

    Start-Sleep -Milliseconds 500
  }

  throw "Timeout while waiting for server startup at $HealthUrl."
}

function Test-ProjectRoot {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $false
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
  } catch {
    return $false
  }

  $required = @(
    (Join-Path $fullPath "server.js"),
    (Join-Path $fullPath "public"),
    (Join-Path $fullPath "downloads")
  )

  return (Test-Path -LiteralPath $required[0] -PathType Leaf) -and
    (Test-Path -LiteralPath $required[1] -PathType Container) -and
    (Test-Path -LiteralPath $required[2] -PathType Container)
}

function Add-ProjectRootCandidates {
  param(
    [System.Collections.Generic.List[string]]$List,
    [string]$Path
  )

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  try {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
  } catch {
    return
  }

  if (-not (Test-Path -LiteralPath $fullPath)) {
    return
  }

  if (-not $List.Contains($fullPath)) {
    [void]$List.Add($fullPath)
  }

  $cursor = $fullPath
  for ($i = 0; $i -lt 5; $i++) {
    $parent = Split-Path -Parent $cursor
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $cursor) {
      break
    }
    if (-not $List.Contains($parent)) {
      [void]$List.Add($parent)
    }
    $cursor = $parent
  }
}

function Resolve-ProjectRoot {
  param(
    [string]$Hint,
    [string]$LauncherDirectory
  )

  $candidates = New-Object 'System.Collections.Generic.List[string]'

  $selfProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $PID) -ErrorAction SilentlyContinue
  if ($selfProcess -and $selfProcess.ParentProcessId) {
    $parentProcess = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f [int]$selfProcess.ParentProcessId) -ErrorAction SilentlyContinue
    if ($parentProcess -and $parentProcess.ExecutablePath) {
      Add-ProjectRootCandidates -List $candidates -Path (Split-Path -Parent $parentProcess.ExecutablePath)
    }
  }

  Add-ProjectRootCandidates -List $candidates -Path $Hint
  Add-ProjectRootCandidates -List $candidates -Path (Get-Location).Path
  Add-ProjectRootCandidates -List $candidates -Path $LauncherDirectory
  Add-ProjectRootCandidates -List $candidates -Path (Join-Path $LauncherDirectory "..")
  Add-ProjectRootCandidates -List $candidates -Path $env:CHAOTIC_PROJECT_ROOT

  foreach ($candidate in $candidates) {
    if (Test-ProjectRoot -Path $candidate) {
      return [System.IO.Path]::GetFullPath($candidate)
    }
  }

  throw "Nao foi possivel localizar a pasta do jogo. Execute o Chaotic.exe na pasta que contem server.js, public e downloads."
}

function Get-EdgeSessionProcessIds {
  param([string]$ProfilePath)

  $normalizedProfile = [System.IO.Path]::GetFullPath($ProfilePath).ToLowerInvariant()
  $processes = Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" -ErrorAction SilentlyContinue
  if (-not $processes) {
    return @()
  }

  $matches = $processes | Where-Object {
    $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($normalizedProfile)
  }

  return @($matches | ForEach-Object { [int]$_.ProcessId })
}

function Get-LauncherSettings {
  param([string]$ProjectRoot)

  $settingsPath = Join-Path $ProjectRoot "settings.json"
  if (-not (Test-Path -LiteralPath $settingsPath)) {
    return $null
  }

  try {
    $raw = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) {
      return $null
    }
    return $raw | ConvertFrom-Json
  } catch {
    Write-LauncherLog ("Failed to parse settings.json: " + $_.Exception.Message)
    return $null
  }
}

$launcherDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $null
$serverProcess = $null
$edgeProfileDir = $null

try {
  Write-LauncherLog "Launcher started."
  $projectRoot = Resolve-ProjectRoot -Hint $ProjectRootHint -LauncherDirectory $launcherDirectory
  Write-LauncherLog ("Project root resolved: " + $projectRoot)

  $nodePath = Resolve-NodePath
  if (-not $nodePath) {
    throw "Node.js nao encontrado no PATH. Instale em https://nodejs.org e tente novamente."
  }
  Write-LauncherLog ("Node path: " + $nodePath)

  $edgePath = Resolve-EdgePath
  if (-not $edgePath) {
    throw "Microsoft Edge nao encontrado nesta maquina."
  }
  Write-LauncherLog ("Edge path: " + $edgePath)

  $serverUrl = "http://localhost:3000"
  $healthUrl = "$serverUrl/api/library"
  $sessionToken = [Guid]::NewGuid().ToString("N")
  $edgeProfileDir = Join-Path ([System.IO.Path]::GetTempPath()) ("chaotic-edge-" + $sessionToken)
  New-Item -ItemType Directory -Path $edgeProfileDir -Force | Out-Null

  $gameUrl = "$serverUrl/?view=builder"
  $savedSettings = Get-LauncherSettings -ProjectRoot $projectRoot
  $fullscreenAuto = $true
  $screenSettings = $null
  if ($savedSettings) {
    if ($savedSettings.settings -and $savedSettings.settings.screen) {
      $screenSettings = $savedSettings.settings.screen
    } elseif ($savedSettings.screen) {
      $screenSettings = $savedSettings.screen
    }
  }
  if ($screenSettings) {
    $candidate = $screenSettings.fullscreenAuto
    if ($candidate -is [bool]) {
      $fullscreenAuto = $candidate
    }
  }
  Write-LauncherLog ("Fullscreen auto: " + $fullscreenAuto)

  $serverProcess = Start-Process -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
  Write-LauncherLog ("Node started with PID: " + $serverProcess.Id)
  Wait-ServerReady -HealthUrl $healthUrl -TimeoutSeconds 40 -ServerProcess $serverProcess
  Write-LauncherLog "Server health-check passed."

  $edgeArgs = @(
    "--app=$gameUrl",
    "--user-data-dir=$edgeProfileDir",
    "--no-first-run",
    "--no-default-browser-check"
  )
  if ($fullscreenAuto) {
    $edgeArgs += "--start-fullscreen"
  }

  [void](Start-Process -FilePath $edgePath -ArgumentList $edgeArgs -WorkingDirectory $projectRoot -PassThru)
  Write-LauncherLog "Edge session launch requested."

  $appearDeadline = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $appearDeadline) {
    $sessionIds = Get-EdgeSessionProcessIds -ProfilePath $edgeProfileDir
    if ($sessionIds.Count -gt 0) {
      break
    }
    Start-Sleep -Milliseconds 400
  }

  $existing = Get-EdgeSessionProcessIds -ProfilePath $edgeProfileDir
  if ($existing.Count -eq 0) {
    throw "Edge nao iniciou corretamente para esta sessao."
  }
  Write-LauncherLog ("Edge session processes detected: " + $existing.Count)

  while ($true) {
    if ($serverProcess.HasExited) {
      Write-LauncherLog "Server process exited. Shutting down Edge."
      $alive = Get-EdgeSessionProcessIds -ProfilePath $edgeProfileDir
      if ($alive.Count -gt 0) {
        Stop-Process -Id $alive -Force -ErrorAction SilentlyContinue
      }
      break
    }
    $alive = Get-EdgeSessionProcessIds -ProfilePath $edgeProfileDir
    if ($alive.Count -eq 0) {
      break
    }
    Start-Sleep -Seconds 1
  }
  Write-LauncherLog "Edge session ended."
}
catch {
  Write-LauncherLog ("Launcher error: " + $_.Exception.Message)
  Show-LauncherError -Message ("Falha ao iniciar Chaotic: " + $_.Exception.Message)
}
finally {
  if ($serverProcess) {
    Write-LauncherLog ("Stopping node process tree: " + $serverProcess.Id)
    Stop-ProcessTree -ProcessId $serverProcess.Id
  }

  if ($edgeProfileDir -and (Test-Path -LiteralPath $edgeProfileDir)) {
    try {
      Remove-Item -LiteralPath $edgeProfileDir -Recurse -Force -ErrorAction Stop
      Write-LauncherLog ("Removed temp edge profile: " + $edgeProfileDir)
    } catch {
      # Ignore temp profile cleanup failure.
    }
  }
  Write-LauncherLog "Launcher finished."
}
