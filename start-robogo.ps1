# RoboGo Electron Application Starter
Write-Host "Starting RoboGo Electron Application..." -ForegroundColor Green
Write-Host ""

# Check if node_modules exists, if not install dependencies
if (!(Test-Path "node_modules")) {
    Write-Host "Installing Electron dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Check if client dependencies are installed
if (!(Test-Path "../client/node_modules")) {
    Write-Host "Installing client dependencies..." -ForegroundColor Yellow
    Set-Location "../client"
    npm install
    Set-Location "../robogo-electron"
    Write-Host ""
}

# Check if server dependencies are installed
if (!(Test-Path "../server/node_modules")) {
    Write-Host "Installing server dependencies..." -ForegroundColor Yellow
    Set-Location "../server"
    npm install
    Set-Location "../robogo-electron"
    Write-Host ""
}

Write-Host "Starting RoboGo application..." -ForegroundColor Green
Write-Host "This will automatically start the client and server processes." -ForegroundColor Cyan
Write-Host "Please wait for the application to load completely." -ForegroundColor Cyan
Write-Host ""

npm start

Write-Host "Press any key to continue..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
