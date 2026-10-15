# Builds a packaged local copy of DCC (dist\win-unpacked\dcc.exe) from the current working tree
# and starts it. The build has no update feed, so it never replaces itself with an official release.
param(
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:PATH = "$env:USERPROFILE\.bun\bin;" + $env:PATH
Set-Location $root
$Host.UI.RawUI.WindowTitle = 'DCC - build local'

$unpacked = Join-Path $root 'dist\win-unpacked'
$exe = Join-Path $unpacked 'dcc.exe'

$running = @(
  Get-CimInstance Win32_Process -Filter "Name = 'dcc.exe'" |
    Where-Object { $_.ExecutablePath -like "$unpacked\*" }
)
if ($running.Count -gt 0) {
  Write-Host 'Feche o DCC antes de recompilar (o build precisa substituir os arquivos).' -ForegroundColor Yellow
  Read-Host 'Pressione Enter para sair'
  exit 1
}

function Invoke-Step([string]$label, [scriptblock]$step) {
  Write-Host ''
  Write-Host "==> $label" -ForegroundColor DarkYellow
  & $step
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Falhou: $label (codigo $LASTEXITCODE)" -ForegroundColor Red
    Read-Host 'Pressione Enter para sair'
    exit $LASTEXITCODE
  }
}

$started = Get-Date
# Read-only cache: each frontend build carries the offline maps (~1.2 GB); caching every build
# filled .turbo/cache with gigabytes that a local rebuild never reuses.
Invoke-Step 'Compilando frontend, document e core' { bunx turbo run build --cache=local:r,remote:r }
Invoke-Step 'Empacotando executavel' {
  Push-Location (Join-Path $root 'apps\core')
  try { bun run build:unpack } finally { Pop-Location }
}

$updateFeed = Join-Path $unpacked 'resources\app-update.yml'
if (Test-Path $updateFeed) { Remove-Item $updateFeed -Force }

$elapsed = [int]((Get-Date) - $started).TotalSeconds
Write-Host ''
Write-Host "Pronto em ${elapsed}s: $exe" -ForegroundColor Green

if (-not $NoLaunch) {
  Start-Process -FilePath $exe -WorkingDirectory $unpacked
}
