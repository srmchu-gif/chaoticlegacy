$ErrorActionPreference = "Stop"

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$buildStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outputExeName = "Chaotic-$buildStamp.exe"
$outputExe = Join-Path $projectRoot $outputExeName
$legacyExe = Join-Path $projectRoot "Chaotic.exe"
$launcherSource = Join-Path $projectRoot "scripts\\chaotic-launcher.cs"
$launcherScript = Join-Path $projectRoot "launcher.ps1"
$iconPath = Join-Path $projectRoot "favicon.ico"
$startTime = Get-Date

$requiredFiles = @($launcherSource, $launcherScript, $iconPath)
foreach ($required in $requiredFiles) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Arquivo obrigatorio ausente: $required"
  }
}

Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like "Chaotic*" } | Stop-Process -Force -ErrorAction SilentlyContinue

if (Test-Path -LiteralPath $outputExe) {
  Remove-Item -LiteralPath $outputExe -Force
}
if (Test-Path -LiteralPath $legacyExe) {
  Remove-Item -LiteralPath $legacyExe -Force -ErrorAction SilentlyContinue
}

$launcherTypeDefinition = Get-Content -LiteralPath $launcherSource -Raw

Add-Type -AssemblyName "Microsoft.CSharp"

$compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
$compilerParameters = New-Object System.CodeDom.Compiler.CompilerParameters
$compilerParameters.GenerateExecutable = $true
$compilerParameters.GenerateInMemory = $false
$compilerParameters.IncludeDebugInformation = $false
$compilerParameters.OutputAssembly = $outputExe
$compilerParameters.CompilerOptions = "/target:winexe /optimize+ /win32icon:`"$iconPath`""
[void]$compilerParameters.ReferencedAssemblies.Add("System.dll")
[void]$compilerParameters.ReferencedAssemblies.Add("System.Core.dll")
[void]$compilerParameters.ReferencedAssemblies.Add("System.Windows.Forms.dll")

$compileResult = $compiler.CompileAssemblyFromSource($compilerParameters, $launcherTypeDefinition)
if ($compileResult.Errors.HasErrors) {
  $errors = ($compileResult.Errors | ForEach-Object { $_.ErrorText }) -join "; "
  throw "Falha ao compilar Chaotic.exe: $errors"
}

if (-not (Test-Path -LiteralPath $outputExe -PathType Leaf)) {
  throw "Build finalizado sem gerar $outputExeName."
}

$outputInfo = Get-Item -LiteralPath $outputExe
if ($outputInfo.LastWriteTime -lt $startTime.AddSeconds(-1)) {
  throw "$outputExeName nao foi atualizado durante o build."
}
if ($outputInfo.Length -le 0) {
  throw "$outputExeName gerado com tamanho invalido."
}

Write-Host "$outputExeName gerado com sucesso."
Write-Host ("Arquivo: " + $outputInfo.FullName)
Write-Host ("Tamanho: " + $outputInfo.Length + " bytes")
Write-Host ("Atualizado em: " + $outputInfo.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"))
