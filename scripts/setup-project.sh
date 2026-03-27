#!/bin/bash
# =============================================================================
# Sourcing Tool - Project Setup Script
# =============================================================================
# This script installs all project-specific dependencies after the server
# environment has been prepared with setup-server.sh
# =============================================================================

set -e

echo "============================================================================="
echo "  Sourcing Tool - Project Setup"
echo "============================================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_status() {
    echo -e "${YELLOW}[*] $1${NC}"
}

print_success() {
    echo -e "${GREEN}[✓] $1${NC}"
}

print_error() {
    echo -e "${RED}[✗] $1${NC}"
}

print_info() {
    echo -e "${BLUE}[i] $1${NC}"
}

# Get project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "Project directory: $PROJECT_DIR"
echo ""

# =============================================================================
# 1. INSTALL NODE.JS DEPENDENCIES
# =============================================================================
print_status "Installing Node.js dependencies (this may take a few minutes)..."

# Check if package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found in $PROJECT_DIR"
    exit 1
fi

# Install npm dependencies
npm install

print_success "Node.js dependencies installed"
echo ""

# =============================================================================
# 2. INSTALL PYTHON TAOBACO SERVICE DEPENDENCIES
# =============================================================================
print_status "Installing Python Taobao service dependencies..."

TAOBAO_SERVICE_DIR="$PROJECT_DIR/services/taobao"

if [ ! -d "$TAOBAO_SERVICE_DIR" ]; then
    print_error "Taobao service directory not found at $TAOBAO_SERVICE_DIR"
    exit 1
fi

cd "$TAOBAO_SERVICE_DIR"

# Check if requirements.txt exists
if [ ! -f "requirements.txt" ]; then
    print_error "requirements.txt not found in $TAOBAO_SERVICE_DIR"
    exit 1
fi

# Create Python virtual environment
print_status "Creating Python virtual environment..."
python3.11 -m venv venv

# Activate virtual environment and install dependencies
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

deactivate

print_success "Python Taobao service dependencies installed"
echo ""

# =============================================================================
# 3. CREATE DATA DIRECTORIES
# =============================================================================
cd "$PROJECT_DIR"

print_status "Creating data directories..."

mkdir -p data/proposals
mkdir -p public/ai-images
mkdir -p logs

print_success "Data directories created"
echo ""

# =============================================================================
# 4. CHECK ENVIRONMENT FILE
# =============================================================================
print_status "Checking environment configuration..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        print_info "Created .env from .env.example - PLEASE EDIT IT WITH YOUR API KEYS"
    else
        print_error "No .env or .env.example file found"
        echo "Please create a .env file manually."
    fi
else
    print_success ".env file exists"
fi

echo ""

# =============================================================================
# 5. MAKE SCRIPTS EXECUTABLE
# =============================================================================
print_status "Setting up executable permissions..."

chmod +x scripts/*.sh 2>/dev/null || true
chmod +x services/taobao/start.sh 2>/dev/null || true

print_success "Scripts are now executable"
echo ""

# =============================================================================
# 6. BUILD NEXT.JS (optional, for production)
# =============================================================================
read -p "Build Next.js for production? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_status "Building Next.js application..."
    npm run build
    print_success "Build complete"
else
    print_info "Skipping build (run 'npm run build' later for production)"
fi

echo ""
echo "============================================================================="
echo "  Setup Complete!"
echo "============================================================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Edit your environment variables:"
echo "   nano $PROJECT_DIR/.env"
echo ""
echo "2. Start the services:"
echo "   cd $PROJECT_DIR"
echo "   ./scripts/start-services.sh"
echo ""
echo "Or start services manually:"
echo "   - Taobao Service: cd services/taobao && ./start.sh"
echo "   - Next.js Dev:    npm run dev"
echo "   - Next.js Prod:   npm start (after build)"
echo ""
echo "Services will be available at:"
echo "   - Frontend: http://localhost:3000"
echo "   - Taobao API: http://localhost:8001"
echo "   - API Docs: http://localhost:8001/docs"
echo ""
