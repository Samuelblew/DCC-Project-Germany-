$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$env:PATH = "$env:USERPROFILE\.bun\bin;" + $env:PATH
Set-Location $root

$existing = @(
  Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
    Where-Object { $_.CommandLine -like '*\dcc\*' }
)
if ($existing.Count -gt 0) {
  $window = Get-Process -Id $existing[0].ProcessId -ErrorAction SilentlyContinue
  if ($window -and $window.MainWindowHandle -ne 0) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DccWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
    [DccWindow]::ShowWindow($window.MainWindowHandle, 9) | Out-Null
    [DccWindow]::SetForegroundWindow($window.MainWindowHandle) | Out-Null
  }
  exit 0
}

$listening = @(
  Get-NetTCPConnection -LocalPort 5173, 5174 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty LocalPort -Unique
)
if ($listening -contains 5173 -and $listening -contains 5174) {
  Set-Location (Join-Path $root 'apps\core')
  & bun run dev
  exit $LASTEXITCODE
}

& bunx turbo run dev --filter=@dcc/core --filter=@dcc/frontend --filter=@dcc/document
exit $LASTEXITCODE
