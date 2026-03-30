#!/bin/bash
# =============================================================================
# Sourcing Tool - Complete Server Setup Script
# =============================================================================
# This script installs all dependencies for the Sourcing Tool project on a
# fresh server. Run this as root or with sudo privileges.
#
# Supports: Ubuntu 20.04/22.04/24.04, Debian 11/12, CentOS 8/RHEL 8+
# =============================================================================

set -e  # Exit on any error

echo "============================================================================="
echo "  Sourcing Tool - Server Setup"
echo "============================================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VERSION=$VERSION_ID
else
    echo -e "${RED}ERROR: Cannot detect OS${NC}"
    exit 1
fi

echo "Detected OS: $OS $VERSION"
echo ""

# Function to print status
print_status() {
    echo -e "${YELLOW}[*] $1${NC}"
}

print_success() {
    echo -e "${GREEN}[✓] $1${NC}"
}

print_error() {
    echo -e "${RED}[✗] $1${NC}"
}

# =============================================================================
# 1. SYSTEM UPDATE & BASE DEPENDENCIES
# =============================================================================
print_status "Updating system packages..."

if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    apt-get update && apt-get upgrade -y
    apt-get install -y curl wget git build-essential software-properties-common \
        ca-certificates gnupg lsb-release apt-transport-https
elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "fedora" ]]; then
    yum update -y || dnf update -y
    yum install -y curl wget git gcc make || dnf install -y curl wget git gcc make
else
    print_error "Unsupported OS: $OS"
    exit 1
fi

print_success "System packages updated"

# =============================================================================
# 2. INSTALL NODE.JS 20+ (via NodeSource)
# =============================================================================
print_status "Installing Node.js 20.x..."

if ! command -v node &> /dev/null || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 20 ]]; then
    if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
    elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "fedora" ]]; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
        yum install -y nodejs || dnf install -y nodejs
    fi
fi

# Verify Node.js installation
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    print_success "Node.js installed: $NODE_VERSION"
else
    print_error "Node.js installation failed"
    exit 1
fi

# Verify npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    print_success "npm installed: $NPM_VERSION"
else
    print_error "npm installation failed"
    exit 1
fi

# =============================================================================
# 3. INSTALL PYTHON 3.11+
# =============================================================================
print_status "Installing Python 3.11..."

if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    # Add deadsnakes PPA for Python 3.11 on older Ubuntu
    if [[ "$OS" == "ubuntu" && "$(echo "$VERSION_ID >= 22.04" | bc 2>/dev/null || echo "0")" -eq 0 ]]; then
        add-apt-repository -y ppa:deadsnakes/ppa
        apt-get update
    fi
    apt-get install -y python3.11 python3.11-venv python3.11-dev python3-pip
    
    # Create symlinks if needed
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 || true
    
elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "fedora" ]]; then
    # Enable EPEL and install Python 3.11
    yum install -y epel-release || true
    yum install -y python3.11 python3.11-pip python3.11-devel || \
        dnf install -y python3.11 python3.11-pip python3.11-devel
fi

# Verify Python installation
if command -v python3.11 &> /dev/null; then
    PYTHON_VERSION=$(python3.11 --version)
    print_success "Python installed: $PYTHON_VERSION"
else
    print_error "Python 3.11 installation failed"
    exit 1
fi

# Upgrade pip
python3.11 -m pip install --upgrade pip

# =============================================================================
# 4. INSTALL REDIS (for caching)
# =============================================================================
print_status "Installing Redis..."

if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    apt-get install -y redis-server
    systemctl enable redis-server
    systemctl start redis-server
elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "fedora" ]]; then
    yum install -y redis || dnf install -y redis
    systemctl enable redis
    systemctl start redis
fi

# Verify Redis
if systemctl is-active --quiet redis-server 2>/dev/null || systemctl is-active --quiet redis 2>/dev/null; then
    print_success "Redis installed and running"
else
    print_error "Redis installation may have issues (non-critical)"
fi

# =============================================================================
# 5. INSTALL SHARP LIBRARY DEPENDENCIES (for image processing)
# =============================================================================
print_status "Installing Sharp image processing dependencies..."

if [[ "$OS" == "ubuntu" || "$OS" == "debian" ]]; then
    apt-get install -y libvips-dev libvips-tools
elif [[ "$OS" == "centos" || "$OS" == "rhel" || "$OS" == "fedora" ]]; then
    yum install -y vips-devel || dnf install -y vips-devel
fi

print_success "Sharp dependencies installed"

# =============================================================================
# 6. PROJECT SETUP INSTRUCTIONS
# =============================================================================
echo ""
echo "============================================================================="
echo "  Installation Complete! Next Steps:"
echo "============================================================================="
echo ""
echo "1. Clone or upload the project files to your server"
echo "   Example: git clone <your-repo-url> /opt/sourcing-tool"
echo ""
echo "2. Run the project-specific setup script:"
echo "   cd /opt/sourcing-tool"
echo "   chmod +x scripts/setup-project.sh"
echo "   ./scripts/setup-project.sh"
echo ""
echo "3. Configure environment variables:"
echo "   cp .env.example .env"
echo "   nano .env  # Edit with your API keys"
echo ""
echo "4. Start the services:"
echo "   ./scripts/start-services.sh"
echo ""
echo "============================================================================="
echo "  System Information:"
echo "============================================================================="
echo "Node.js: $(node -v)"
echo "npm: $(npm -v)"
echo "Python: $(python3.11 --version 2>/dev/null || python3 --version)"
echo "Redis: $(redis-cli --version 2>/dev/null || echo 'Not checked')"
echo ""
