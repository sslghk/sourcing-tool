# =============================================================================
# Sourcing Tool - Project Setup Script (Windows PowerShell)
# =============================================================================

$ErrorActionPreference = "Stop"

Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Sourcing Tool - Project Setup (Windows)" -ForegroundColor Cyan
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

# Get project directory
$PROJECT_DIR = Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent
Set-Location $PROJECT_DIR

Write-Host "Project directory: $PROJECT_DIR" -ForegroundColor Gray
Write-Host ""

# =============================================================================
# 1. Install Node.js Dependencies
# =============================================================================
Write-Status "Installing Node.js dependencies (this may take a few minutes)..."

if (-not (Test-Path "package.json")) {
    Write-Error "package.json not found in $PROJECT_DIR"
    exit 1
}

npm install

if ($LASTEXITCODE -ne 0) {
    Write-Error "npm install failed"
    exit 1
}

Write-Success "Node.js dependencies installed"
Write-Host ""

# =============================================================================
# 2. Install Python Taobao Service Dependencies
# =============================================================================
Write-Status "Installing Python Taobao service dependencies..."

$TAOBAO_SERVICE_DIR = "$PROJECT_DIR\services\taobao"

if (-not (Test-Path $TAOBAO_SERVICE_DIR)) {
    Write-Error "Taobao service directory not found at $TAOBAO_SERVICE_DIR"
    exit 1
}

Set-Location $TAOBAO_SERVICE_DIR

if (-not (Test-Path "requirements.txt")) {
    Write-Error "requirements.txt not found in $TAOBAO_SERVICE_DIR"
    exit 1
}

# Create Python virtual environment
Write-Status "Creating Python virtual environment..."
if (-not (Test-Path "venv")) {
    python -m venv venv
}

# Activate and install
& .\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
deactivate

Write-Success "Python Taobao service dependencies installed"
Write-Host ""

# =============================================================================
# 3. Create Data Directories
# =============================================================================
Set-Location $PROJECT_DIR

Write-Status "Creating data directories..."

New-Item -ItemType Directory -Force -Path "data\proposals" | Out-Null
New-Item -ItemType Directory -Force -Path "public\ai-images" | Out-Null
New-Item -ItemType Directory -Force -Path "logs" | Out-Null

Write-Success "Data directories created"
Write-Host ""

# =============================================================================
# 4. Check Environment File
# =============================================================================
Write-Status "Checking environment configuration..."

if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Info "Created .env from .env.example - PLEASE EDIT IT WITH YOUR API KEYS"
    } else {
        Write-Error "No .env or .env.example file found"
        Write-Host "Please create a .env file manually."
    }
} else {
    Write-Success ".env file exists"
}

Write-Host ""

# =============================================================================
# 5. Build Next.js (optional, for production)
# =============================================================================
$buildChoice = Read-Host "Build Next.js for production? (y/N)"
if ($buildChoice -eq 'y' -or $buildChoice -eq 'Y') {
    Write-Status "Building Next.js application..."
    npm run build
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Build complete"
    } else {
        Write-Error "Build failed"
    }
} else {
    Write-Info "Skipping build (run 'npm run build' later for production)"
}

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host ""
Write-Host "1. Edit your environment variables:"
Write-Host "   notepad $PROJECT_DIR\.env"
Write-Host ""
Write-Host "2. Start the services:"
Write-Host "   cd $PROJECT_DIR"
Write-Host "   .\scripts\Start-Services.ps1"
Write-Host ""
Write-Host "Or start services manually:"
Write-Host "   - Taobao Service: cd services\taobao; .\venv\Scripts\Activate.ps1; python -m uvicorn main:app --host 0.0.0.0 --port 8001"
Write-Host "   - Next.js Dev:    npm run dev"
Write-Host "   - Next.js Prod:   npm start (after build)"
Write-Host ""
Write-Host "Services will be available at:"
Write-Host "   - Frontend: http://localhost:3000"
Write-Host "   - Taobao API: http://localhost:8001"
Write-Host "   - API Docs: http://localhost:8001/docs"
Write-Host ""
