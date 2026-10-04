@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title DCC - install

echo.
echo  DCC - install
echo  This window installs Bun, downloads dependencies, and builds dcc.exe.
echo  The first run can take a while (the Germany map is large).
echo.

where bun >nul 2>&1
if errorlevel 1 (
  if exist "%USERPROFILE%\.bun\bin\bun.exe" (
    set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
  )
)

where bun >nul 2>&1
if errorlevel 1 (
  echo  Bun not found. Installing...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://bun.sh/install.ps1 | iex"
  if errorlevel 1 goto :fail
  set "PATH=%USERPROFILE%\.bun\bin;%PATH%"
)

where bun >nul 2>&1
if errorlevel 1 (
  echo  Bun was installed but this window cannot see it yet.
  echo  Close this window, open a new one, and run install.bat again.
  goto :fail
)

echo.
echo  ==^> Project dependencies
call bun install
if errorlevel 1 goto :fail

set "GERMANY_MAP=apps\frontend\public\maps\germany-cold-war\germany-cold-war.pmtiles"
if exist "%GERMANY_MAP%" (
  echo.
  echo  ==^> Germany map already on disk, skipping download.
) else (
  echo.
  echo  ==^> Downloading offline maps (Germany is about 1 GB; needs internet)
  call bun run cache:map
  if errorlevel 1 goto :fail
)

echo.
echo  ==^> Building the executable
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-local.ps1"
if errorlevel 1 goto :fail

echo.
echo  Done. Launch with:
echo  %~dp0dist\win-unpacked\dcc.exe
echo.
echo  On first launch, pick your DCS World folder (the one that contains bin\DCS.exe).
echo.
pause
exit /b 0

:fail
echo.
echo  Install stopped with an error. See INSTALL.txt for the manual steps.
echo.
pause
exit /b 1
