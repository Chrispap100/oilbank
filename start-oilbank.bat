@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org then run this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])!==24)process.exit(1)"
if errorlevel 1 (
  echo OilBank requires Node.js 24 LTS.
  pause
  exit /b 1
)
if not exist node_modules\express (
  call npm install
  if errorlevel 1 goto failed
)
call npm run setup
if errorlevel 1 goto failed
node --env-file-if-exists=.env scripts/launch.js
if errorlevel 1 goto failed
exit /b 0
:failed
echo OilBank could not start. See the message above.
pause
exit /b 1
