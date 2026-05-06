param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
  [int]$RetentionDays = 14
)

$ErrorActionPreference = "Stop"

$runtimeDir = Join-Path $ProjectRoot "runtime"
$dbPath = Join-Path $runtimeDir "chaotic.db"
$backupDir = Join-Path $ProjectRoot "backups"

if (!(Test-Path $dbPath)) {
  throw "Banco SQLite nao encontrado em: $dbPath"
}

if (!(Test-Path $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmpCopy = Join-Path $backupDir "chaotic-$stamp.db"
$gzPath = "$tmpCopy.gz"

Copy-Item -Path $dbPath -Destination $tmpCopy -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
$inStream = [System.IO.File]::OpenRead($tmpCopy)
$outStream = [System.IO.File]::Create($gzPath)
$gzip = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionMode]::Compress)
$inStream.CopyTo($gzip)
$gzip.Dispose()
$inStream.Dispose()
$outStream.Dispose()

Remove-Item -Path $tmpCopy -Force

$cutoff = (Get-Date).AddDays(-[Math]::Abs($RetentionDays))
Get-ChildItem -Path $backupDir -Filter "chaotic-*.db.gz" |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -Force

Write-Output "Backup gerado: $gzPath"
