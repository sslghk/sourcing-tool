# =============================================================================
# Sourcing Tool - Service Startup Script (Windows PowerShell)
# =============================================================================

$ErrorActionPreference = "Stop"

# Get project directory
$PROJECT_DIR = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$LOGS_DIR = "$PROJECT_DIR\logs"

# Create logs directory
New-Item -ItemType Directory -Force -Path $LOGS_DIR | Out-Null

function Write-Status($message) {
    Write-Host "[*] $message" -ForegroundColor Yellow
}

function Write-Success($message) {
    Write-Host "[✓] $message" -ForegroundColor Green
}

function Write-Error($message) {
    Write-Host "[✗] $message" -ForegroundColor Red
}

function Write-Info($message) {
    Write-Host "[i] $message" -ForegroundColor Blue
}

function Test-PortInUse($port) {
    $connection = Test-NetConnection -ComputerName localhost -Port $port -WarningAction SilentlyContinue
    return $connection.TcpTestSucceeded
}

Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Sourcing Tool - Starting Services" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if Redis is running
try {
    $redisPing = redis-cli ping 2>$null
    if ($redisPing -eq "PONG") {
        Write-Success "Redis is running"
    } else {
        Write-Info "Redis is not running (optional for caching)"
    }
} catch {
    Write-Info "Redis not detected (optional for caching)"
}
Write-Host ""

# =============================================================================
# START TAOBAO SERVICE
# =============================================================================
Write-Info "Starting Taobao Python Service..."

$TAOBAO_DIR = "$PROJECT_DIR\services\taobao"

if (-not (Test-Path $TAOBAO_DIR)) {
    Write-Error "Taobao service directory not found"
    exit 1
}

Set-Location $TAOBAO_DIR

# Check if virtual environment exists
if (-not (Test-Path "venv")) {
    Write-Error "Virtual environment not found. Run Setup-Project.ps1 first."
    exit 1
}

# Check if port 8001 is already in use
if (Test-PortInUse 8001) {
    Write-Host "WARNING: Port 8001 is already in use. Is the Taobao service already running?" -ForegroundColor Yellow
} else {
    # Start Taobao service in background
    $job = Start-Job -ScriptBlock {
        param($dir)
        Set-Location $dir
        & .\venv\Scripts\Activate.ps1
        python -m uvicorn main:app --host 0.0.0.0 --port 8001
    } -ArgumentList $TAOBAO_DIR
    
    # Save job ID
    $job.Id | Out-File "$LOGS_DIR\taobao.pid"
    
    Start-Sleep -Seconds 3
    
    if ($job.State -eq "Running") {
        Write-Success "Taobao service started (Job ID: $($job.Id), Port: 8001)"
        Write-Info "Logs will appear in the job output. View with: Receive-Job -Id $($job.Id)"
    } else {
        Write-Error "Taobao service failed to start"
        Receive-Job -Job $job
    }
}

Write-Host ""

# =============================================================================
# START NEXT.JS
# =============================================================================
Write-Info "Starting Next.js Application..."

Set-Location $PROJECT_DIR

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Error "node_modules not found. Run Setup-Project.ps1 first."
    exit 1
}

# Check if production build exists
if (Test-Path ".next") {
    Write-Info "Production build detected. Starting in production mode..."
    $job = Start-Job -ScriptBlock {
        param($dir)
        Set-Location $dir
        npm start
    } -ArgumentList $PROJECT_DIR
} else {
    Write-Info "No production build found. Starting in development mode..."
    Write-Host "Note: Run 'npm run build' for production mode" -ForegroundColor Yellow
    $job = Start-Job -ScriptBlock {
        param($dir)
        Set-Location $dir
        npm run dev
    } -ArgumentList $PROJECT_DIR
}

# Save job ID
$job.Id | Out-File "$LOGS_DIR\nextjs.pid"

Start-Sleep -Seconds 5

if ($job.State -eq "Running") {
    Write-Success "Next.js started (Job ID: $($job.Id), Port: 3000)"
} else {
    Write-Error "Next.js failed to start"
    Receive-Job -Job $job
}

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  All Services Started!" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service URLs:"
Write-Host "  - Frontend:    http://localhost:3000"
Write-Host "  - Taobao API:  http://localhost:8001"
Write-Host "  - API Docs:    http://localhost:8001/docs"
Write-Host ""
Write-Host "Commands:"
Write-Host "  - View Taobao logs:   Get-Job -Id (Get-Content $LOGS_DIR\taobao.pid) | Receive-Job"
Write-Host "  - View Next.js logs:  Get-Job -Id (Get-Content $LOGS_DIR\nextjs.pid) | Receive-Job"
Write-Host "  - Stop all:           .\scripts\Stop-Services.ps1"
Write-Host ""
Write-Host "Press Ctrl+C to stop viewing this window. Services continue running in background."
Write-Host "Run Stop-Services.ps1 to stop all services."
Write-Host ""

# Keep window open
while ($true) {
    Start-Sleep -Seconds 1
}
