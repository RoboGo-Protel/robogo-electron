@echo off
echo Starting RoboGo Electron Application...
echo.

REM Check if node_modules exists, if not install dependencies
if not exist "node_modules" (
    echo Installing Electron dependencies...
    npm install
    echo.
)

REM Check if client dependencies are installed
if not exist "../client/node_modules" (
    echo Installing client dependencies...
    cd ../client
    npm install
    cd ../robogo-electron
    echo.
)

REM Check if server dependencies are installed
if not exist "../server/node_modules" (
    echo Installing server dependencies...
    cd ../server
    npm install
    cd ../robogo-electron
    echo.
)

echo Starting RoboGo application...
echo This will automatically start the client and server processes.
echo.
echo PLEASE WAIT: 
echo - Building client for production (this may take 1-2 minutes)
echo - Starting server
echo - Starting client
echo - Loading application window
echo.
echo The application window will appear when everything is ready.
echo.

npm start

pause
