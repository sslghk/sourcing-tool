# =============================================================================
# Sourcing Tool - Stop Services Script (Windows PowerShell)
# =============================================================================

$ErrorActionPreference = "Stop"

$PROJECT_DIR = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
$LOGS_DIR = "$PROJECT_DIR\logs"

Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Sourcing Tool - Stopping Services" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

function Stop-ServiceById($name, $pidFile) {
    $pidPath = "$LOGS_DIR\$pidFile"
    if (Test-Path $pidPath) {
        $jobId = Get-Content $pidPath
        $job = Get-Job -Id $jobId -ErrorAction SilentlyContinue
        if ($job) {
            Stop-Job -Job $job -ErrorAction SilentlyContinue
            Remove-Job -Job $job -ErrorAction SilentlyContinue
            Write-Host "[✓] $name stopped (Job ID: $jobId)" -ForegroundColor Green
        } else {
            Write-Host "[!] $name job not found (may have already stopped)" -ForegroundColor Yellow
        }
        Remove-Item $pidPath -ErrorAction SilentlyContinue
    } else {
        Write-Host "[!] $name PID file not found" -ForegroundColor Yellow
    }
}

# Stop Next.js
Stop-ServiceById "Next.js" "nextjs.pid"

# Stop Taobao service
Stop-ServiceById "Taobao Service" "taobao.pid"

# Also check for any remaining Python/Node processes on known ports
$pythonProcesses = Get-Process python -ErrorAction SilentlyContinue | Where-Object { 
    $_.CommandLine -like "*uvicorn*" 
}
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue

if ($pythonProcesses) {
    $pythonProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[✓] Cleaned up remaining Python processes" -ForegroundColor Green
}

Write-Host ""
Write-Host "All services stopped" -ForegroundColor Green
Write-Host ""
