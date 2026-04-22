#!/bin/bash
# =============================================================================
# Sourcing Tool - Systemd Services + Cron Job Setup
# Run as root or with sudo: sudo bash scripts/setup-services.sh
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_status()  { echo -e "${YELLOW}[*] $1${NC}"; }
print_success() { echo -e "${GREEN}[✓] $1${NC}"; }
print_error()   { echo -e "${RED}[✗] $1${NC}"; }

# ---------------------------------------------------------------------------
# CONFIG — edit these if your paths differ
# ---------------------------------------------------------------------------
PROJECT_DIR="/opt/sourcing-tool"
APP_USER="ubuntu"
NEXTJS_PORT=3000
TAOBAO_PORT=8001
WG_INTERFACE="wg0"          # change if your WireGuard interface name differs
NODE_BIN="$(which node || echo /usr/bin/node)"
NPM_BIN="$(which npm || echo /usr/bin/npm)"
PYTHON_BIN="$PROJECT_DIR/services/taobao/venv/bin/python"
UVICORN_BIN="$PROJECT_DIR/services/taobao/venv/bin/uvicorn"

echo "============================================="
echo "  Sourcing Tool - Service Setup"
echo "  Project dir : $PROJECT_DIR"
echo "  App user    : $APP_USER"
echo "  WireGuard   : $WG_INTERFACE"
echo "============================================="
echo ""

# ---------------------------------------------------------------------------
# 1. WIREGUARD
# ---------------------------------------------------------------------------
print_status "Enabling WireGuard interface ($WG_INTERFACE) on boot..."

if ! command -v wg &> /dev/null; then
    print_status "WireGuard not installed — installing..."
    apt-get update -qq && apt-get install -y -qq wireguard
fi

if [ ! -f "/etc/wireguard/${WG_INTERFACE}.conf" ]; then
    print_error "/etc/wireguard/${WG_INTERFACE}.conf not found — skipping WireGuard setup."
    print_error "Create the config first, then re-run this script or run:"
    print_error "  sudo systemctl enable --now wg-quick@${WG_INTERFACE}"
else
    systemctl enable "wg-quick@${WG_INTERFACE}"
    systemctl start  "wg-quick@${WG_INTERFACE}" 2>/dev/null || true
    sleep 2
    if systemctl is-active --quiet "wg-quick@${WG_INTERFACE}"; then
        print_success "WireGuard ($WG_INTERFACE) is running"
    else
        print_error "WireGuard ($WG_INTERFACE) failed — check: journalctl -u wg-quick@${WG_INTERFACE} -n 30"
    fi
fi

# ---------------------------------------------------------------------------
# 2. NEXT.JS SYSTEMD SERVICE
# ---------------------------------------------------------------------------
print_status "Creating Next.js systemd service..."

cat > /etc/systemd/system/sourcing-nextjs.service << EOF
[Unit]
Description=Sourcing Tool - Next.js App
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$NPM_BIN start
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$NEXTJS_PORT
EnvironmentFile=$PROJECT_DIR/.env
StandardOutput=append:$PROJECT_DIR/logs/nextjs.log
StandardError=append:$PROJECT_DIR/logs/nextjs-error.log

[Install]
WantedBy=multi-user.target
EOF

print_success "Next.js service created: /etc/systemd/system/sourcing-nextjs.service"

# ---------------------------------------------------------------------------
# 3. TAOBAO PYTHON SERVICE
# ---------------------------------------------------------------------------
print_status "Creating Taobao Python service..."

cat > /etc/systemd/system/sourcing-taobao.service << EOF
[Unit]
Description=Sourcing Tool - Taobao FastAPI Service
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$PROJECT_DIR/services/taobao
ExecStart=$UVICORN_BIN main:app --host 0.0.0.0 --port $TAOBAO_PORT
Restart=always
RestartSec=5
EnvironmentFile=$PROJECT_DIR/.env
StandardOutput=append:$PROJECT_DIR/logs/taobao.log
StandardError=append:$PROJECT_DIR/logs/taobao-error.log

[Install]
WantedBy=multi-user.target
EOF

print_success "Taobao service created: /etc/systemd/system/sourcing-taobao.service"

# ---------------------------------------------------------------------------
# 4. ENSURE LOGS DIRECTORY EXISTS
# ---------------------------------------------------------------------------
print_status "Creating logs directory..."
mkdir -p "$PROJECT_DIR/logs"
chown "$APP_USER":"$APP_USER" "$PROJECT_DIR/logs"
print_success "Logs directory ready: $PROJECT_DIR/logs"

# ---------------------------------------------------------------------------
# 5. ENABLE & START SERVICES
# ---------------------------------------------------------------------------
print_status "Reloading systemd daemon..."
systemctl daemon-reload

print_status "Enabling services to start on boot..."
systemctl enable sourcing-nextjs
systemctl enable sourcing-taobao

print_status "Starting services..."
systemctl restart sourcing-nextjs
systemctl restart sourcing-taobao

sleep 3

if systemctl is-active --quiet sourcing-nextjs; then
    print_success "Next.js service is running"
else
    print_error "Next.js service failed to start — check: journalctl -u sourcing-nextjs -n 50"
fi

if systemctl is-active --quiet sourcing-taobao; then
    print_success "Taobao service is running"
else
    print_error "Taobao service failed to start — check: journalctl -u sourcing-taobao -n 50"
fi

# ---------------------------------------------------------------------------
# 6. CRON JOB — batch AI worker every 5 minutes (fallback; instrumentation.ts also polls internally)
# ---------------------------------------------------------------------------
print_status "Setting up batch AI worker cron job..."

CRON_JOB="*/5 * * * * curl -s -X POST http://localhost:$NEXTJS_PORT/api/ai-enrich-batch/worker > /dev/null 2>&1"
CRON_FILE="/etc/cron.d/sourcing-batch-worker"

cat > "$CRON_FILE" << EOF
# Sourcing Tool - Advance pending batch AI jobs every 5 minutes
*/5 * * * * $APP_USER curl -s -X POST http://localhost:$NEXTJS_PORT/api/ai-enrich-batch/worker > /dev/null 2>&1
EOF

chmod 644 "$CRON_FILE"
print_success "Cron job installed: $CRON_FILE"

# ---------------------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------------------
echo ""
echo "============================================="
echo "  Setup Complete!"
echo "============================================="
echo ""
echo "Services:"
echo "  WireGuard → wg-quick@$WG_INTERFACE"
echo "  Next.js   → http://localhost:$NEXTJS_PORT"
echo "  Taobao    → http://localhost:$TAOBAO_PORT"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status  wg-quick@$WG_INTERFACE"
echo "  sudo systemctl restart wg-quick@$WG_INTERFACE"
echo "  sudo systemctl status  sourcing-nextjs"
echo "  sudo systemctl status  sourcing-taobao"
echo "  sudo systemctl restart sourcing-nextjs"
echo "  sudo systemctl restart sourcing-taobao"
echo "  sudo journalctl -u sourcing-nextjs -f"
echo "  sudo journalctl -u sourcing-taobao -f"
echo "  tail -f $PROJECT_DIR/logs/nextjs.log"
echo "  tail -f $PROJECT_DIR/logs/taobao.log"
echo ""
echo "To update the app:"
echo "  cd $PROJECT_DIR"
echo "  git pull"
echo "  npm install"
echo "  npm run build"
echo "  sudo systemctl restart sourcing-nextjs"
echo ""
