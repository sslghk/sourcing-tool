#!/bin/bash
# =============================================================================
# Sourcing Tool - Stop Services Script
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS_DIR="$PROJECT_DIR/logs"

echo "============================================================================="
echo "  Sourcing Tool - Stopping Services"
echo "============================================================================="
echo ""

stop_service() {
    local name=$1
    local pid_file=$2
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            # Wait for process to die
            for i in {1..10}; do
                if ! kill -0 "$pid" 2>/dev/null; then
                    break
                fi
                sleep 0.5
            done
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
            echo -e "${GREEN}✓ $name stopped (PID: $pid)${NC}"
        else
            echo -e "${YELLOW}! $name was not running (stale PID file)${NC}"
        fi
        rm -f "$pid_file"
    else
        echo -e "${YELLOW}! $name PID file not found${NC}"
    fi
}

# Stop Next.js
stop_service "Next.js" "$LOGS_DIR/nextjs.pid"

# Stop Taobao service
stop_service "Taobao Service" "$LOGS_DIR/taobao.pid"

echo ""
echo -e "${GREEN}All services stopped${NC}"
echo ""
