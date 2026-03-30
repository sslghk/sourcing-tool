#!/bin/bash
# =============================================================================
# Sourcing Tool - Service Startup Script
# =============================================================================
# Starts all services in the background with proper logging
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get project directory
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"

# Create logs directory
mkdir -p "$LOGS_DIR"

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to stop services
stop_services() {
    echo ""
    echo -e "${YELLOW}Stopping services...${NC}"
    
    # Stop Taobao service
    if [ -f "$LOGS_DIR/taobao.pid" ]; then
        TAOBAO_PID=$(cat "$LOGS_DIR/taobao.pid")
        if kill -0 "$TAOBAO_PID" 2>/dev/null; then
            kill "$TAOBAO_PID" 2>/dev/null || true
            echo "Taobao service stopped (PID: $TAOBAO_PID)"
        fi
        rm -f "$LOGS_DIR/taobao.pid"
    fi
    
    # Stop Next.js
    if [ -f "$LOGS_DIR/nextjs.pid" ]; then
        NEXTJS_PID=$(cat "$LOGS_DIR/nextjs.pid")
        if kill -0 "$NEXTJS_PID" 2>/dev/null; then
            kill "$NEXTJS_PID" 2>/dev/null || true
            echo "Next.js stopped (PID: $NEXTJS_PID)"
        fi
        rm -f "$LOGS_DIR/nextjs.pid"
    fi
    
    echo -e "${GREEN}All services stopped${NC}"
    exit 0
}

# Trap Ctrl+C and stop services
trap stop_services SIGINT SIGTERM

echo "============================================================================="
echo "  Sourcing Tool - Starting Services"
echo "============================================================================="
echo ""

# Check if Redis is running
if ! redis-cli ping >/dev/null 2>&1; then
    echo -e "${YELLOW}WARNING: Redis is not running. Starting Redis...${NC}"
    sudo systemctl start redis-server 2>/dev/null || sudo systemctl start redis 2>/dev/null || true
    sleep 2
fi

if redis-cli ping >/dev/null 2>&1; then
    echo -e "${GREEN}✓ Redis is running${NC}"
else
    echo -e "${YELLOW}WARNING: Redis could not be started (optional for caching)${NC}"
fi
echo ""

# =============================================================================
# START TAOBAO SERVICE
# =============================================================================
echo -e "${BLUE}Starting Taobao Python Service...${NC}"

TAOBAO_DIR="$PROJECT_DIR/services/taobao"

if [ ! -d "$TAOBAO_DIR" ]; then
    echo -e "${RED}ERROR: Taobao service directory not found${NC}"
    exit 1
fi

cd "$TAOBAO_DIR"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}Virtual environment not found. Creating one...${NC}"
    python3.11 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    deactivate
fi

# Check if port 8001 is already in use
if check_port 8001; then
    echo -e "${YELLOW}WARNING: Port 8001 is already in use. Is the Taobao service already running?${NC}"
else
    # Start Taobao service in background
    source venv/bin/activate
    
    PORT=8001 exec uvicorn main:app --host 0.0.0.0 --port 8001 > "$LOGS_DIR/taobao.log" 2>&1 &
    TAOBAO_PID=$!
    deactivate
    
    echo $TAOBAO_PID > "$LOGS_DIR/taobao.pid"
    
    # Wait a moment and check if it's running
    sleep 3
    
    if kill -0 $TAOBAO_PID 2>/dev/null; then
        echo -e "${GREEN}✓ Taobao service started (PID: $TAOBAO_PID, Port: 8001)${NC}"
        echo "  Logs: $LOGS_DIR/taobao.log"
    else
        echo -e "${RED}✗ Taobao service failed to start. Check logs: $LOGS_DIR/taobao.log${NC}"
    fi
fi

echo ""

# =============================================================================
# START NEXT.JS
# =============================================================================
echo -e "${BLUE}Starting Next.js Application...${NC}"

cd "$PROJECT_DIR"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${RED}ERROR: node_modules not found. Run 'npm install' first.${NC}"
    exit 1
fi

# Check if production build exists
if [ -d ".next" ]; then
    echo "Production build detected. Starting in production mode..."
    npm start > "$LOGS_DIR/nextjs.log" 2>&1 &
else
    echo "No production build found. Starting in development mode..."
    echo -e "${YELLOW}Note: Run 'npm run build' for production mode${NC}"
    npm run dev > "$LOGS_DIR/nextjs.log" 2>&1 &
fi

NEXTJS_PID=$!
echo $NEXTJS_PID > "$LOGS_DIR/nextjs.pid"

# Wait and check
sleep 5

if kill -0 $NEXTJS_PID 2>/dev/null; then
    echo -e "${GREEN}✓ Next.js started (PID: $NEXTJS_PID, Port: 3000)${NC}"
    echo "  Logs: $LOGS_DIR/nextjs.log"
else
    echo -e "${RED}✗ Next.js failed to start. Check logs: $LOGS_DIR/nextjs.log${NC}"
fi

echo ""
echo "============================================================================="
echo "  All Services Started!"
echo "============================================================================="
echo ""
echo "Service URLs:"
echo "  - Frontend:    http://localhost:3000"
echo "  - Taobao API:  http://localhost:8001"
echo "  - API Docs:    http://localhost:8001/docs"
echo ""
echo "Log Files:"
echo "  - Taobao:      $LOGS_DIR/taobao.log"
echo "  - Next.js:     $LOGS_DIR/nextjs.log"
echo ""
echo "Commands:"
echo "  - View logs:   tail -f $LOGS_DIR/*.log"
echo "  - Stop all:    Ctrl+C or ./scripts/stop-services.sh"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Keep script running
wait
