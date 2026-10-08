@echo off
if "%~1"=="" (
  "%ComSpec%" /d /k ""%~f0" --run"
  exit /b
)
setlocal
cd /d "%~dp0"
echo OilBank - local SQLite
if not exist "%~dp0package.json" goto missingfiles
if not exist "%~dp0scripts\setup.js" goto missingfiles
rem Prefer the installed Node rather than a stale PATH inherited before installation.
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 LTS, then try again.
  goto failed
)
node.exe -e "console.log('Node.js '+process.version);if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 (
  echo OilBank requires Node.js 24 LTS.
  goto failed
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Repair the Node.js installation with npm enabled.
  goto failed
)
if /i "%~1"=="--check" (
  call npm.cmd --version
  echo Startup prerequisites OK.
  exit /b 0
)
if not exist node_modules\express (
  echo Installing application dependencies. Internet is needed only for this step.
  call npm.cmd install
  if errorlevel 1 goto failed
)
node.exe --env-file-if-exists=.env scripts/setup.js
if errorlevel 1 goto failed
node.exe --env-file-if-exists=.env scripts/launch.js
if errorlevel 1 goto failed
exit /b 0
:missingfiles
echo Required OilBank files are missing.
echo Extract the ENTIRE ZIP first, then open start-oilbank.bat inside the extracted OilBank folder.
:failed
echo.
echo OilBank could not start. Send the error message above for help.
pause
exit /b 1
