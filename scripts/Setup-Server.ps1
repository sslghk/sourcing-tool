# =============================================================================
# Sourcing Tool - Server Setup Script (Windows PowerShell)
# =============================================================================
# Run this as Administrator on Windows Server or Windows 10/11
# =============================================================================

$ErrorActionPreference = "Stop"

Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Sourcing Tool - Windows Server Setup" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

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

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Error "This script must be run as Administrator"
    exit 1
}

# =============================================================================
# 1. Install Chocolatey (Package Manager)
# =============================================================================
Write-Status "Checking for Chocolatey package manager..."

if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Status "Installing Chocolatey..."
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    
    # Refresh environment
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Success "Chocolatey is ready"

# =============================================================================
# 2. Install Node.js 20+
# =============================================================================
Write-Status "Installing Node.js 20.x..."

$nodeVersion = node -v 2>$null
if ($nodeVersion -and $nodeVersion -match "^v(\d+)" -and [int]$matches[1] -ge 20) {
    Write-Success "Node.js $nodeVersion already installed"
} else {
    choco install nodejs -y --version=20.11.1
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# Verify Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Success "Node.js installed: $(node -v)"
    Write-Success "npm installed: $(npm -v)"
} else {
    Write-Error "Node.js installation failed"
    exit 1
}

# =============================================================================
# 3. Install Python 3.11
# =============================================================================
Write-Status "Installing Python 3.11..."

$pythonVersion = python --version 2>$null
if ($pythonVersion -match "3\.11") {
    Write-Success "Python $pythonVersion already installed"
} else {
    choco install python --version=3.11.8 -y
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# Verify Python
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Success "Python installed: $(python --version)"
} else {
    Write-Error "Python installation failed"
    exit 1
}

# Upgrade pip
python -m pip install --upgrade pip

# =============================================================================
# 4. Install Redis (optional)
# =============================================================================
Write-Status "Installing Redis..."

if (-not (Get-Command redis-cli -ErrorAction SilentlyContinue)) {
    choco install redis-64 -y
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

# Start Redis service
try {
    Start-Service redis -ErrorAction SilentlyContinue
    Write-Success "Redis installed and running"
} catch {
    Write-Error "Redis installation may have issues (non-critical)"
}

# =============================================================================
# 5. Install Git
# =============================================================================
Write-Status "Installing Git..."

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    choco install git -y
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Write-Success "Git is ready"

# =============================================================================
# 6. Install Windows Build Tools (for native Node.js modules)
# =============================================================================
Write-Status "Installing Windows build tools..."

choco install visualstudio2022buildtools -y --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Write-Success "Build tools installed"

# =============================================================================
# PROJECT SETUP INSTRUCTIONS
# =============================================================================
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Installation Complete! Next Steps:" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Clone or extract the project files to your server"
Write-Host "   Example: git clone <your-repo-url> C:\projects\sourcing-tool"
Write-Host ""
Write-Host "2. Run the project-specific setup script:"
Write-Host "   cd C:\projects\sourcing-tool"
Write-Host "   .\scripts\Setup-Project.ps1"
Write-Host ""
Write-Host "3. Configure environment variables:"
Write-Host "   copy .env.example .env"
Write-Host "   notepad .env  # Edit with your API keys"
Write-Host ""
Write-Host "4. Start the services:"
Write-Host "   .\scripts\Start-Services.ps1"
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  System Information:" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "Node.js: $(node -v)"
Write-Host "npm: $(npm -v)"
Write-Host "Python: $(python --version)"
Write-Host ""
