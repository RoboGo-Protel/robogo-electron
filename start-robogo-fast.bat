@echo off
echo Starting RoboGo application (FAST MODE)...
echo This mode skips the build process and uses existing build.
echo Use this only if you're sure the client is already built.
echo.

REM Check if node_modules exists, if not install dependencies
if not exist "node_modules" (
    echo Installing Electron dependencies...
    npm install
    echo.
)

echo Starting RoboGo application (skipping build)...
echo.

SET SKIP_BUILD=true
npm start

pause
