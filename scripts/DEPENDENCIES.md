# Sourcing Tool - Dependencies & Server Setup Guide

## Overview

This document lists all dependencies required to run the Sourcing Tool project on a new server and provides quick setup instructions.

## System Requirements

| Component | Minimum Version | Recommended |
|-----------|----------------|-------------|
| Node.js | 20.x | 20.x LTS |
| Python | 3.11 | 3.11.x |
| Redis | 6.x | 7.x |
| OS | Ubuntu 20.04 / Windows 10 | Ubuntu 22.04 LTS |
| RAM | 4GB | 8GB+ |
| Disk | 10GB | 20GB+ |

---

## Node.js Dependencies (package.json)

### Production Dependencies

```json
{
  "@radix-ui/react-dialog": "^1.1.2",
  "@radix-ui/react-dropdown-menu": "^2.1.2",
  "@radix-ui/react-select": "^2.1.2",
  "@radix-ui/react-slot": "^1.1.0",
  "@radix-ui/react-tabs": "^1.1.1",
  "@radix-ui/react-toast": "^1.2.2",
  "@tanstack/react-query": "^5.17.19",
  "@types/nodemailer": "^7.0.11",
  "@types/sharp": "^0.31.1",
  "bcryptjs": "^3.0.3",
  "class-variance-authority": "^0.7.1",
  "clsx": "^2.1.1",
  "date-fns": "^3.0.6",
  "framer-motion": "^11.11.17",
  "google-translate-api-x": "^10.7.2",
  "jspdf": "^4.2.0",
  "jspdf-autotable": "^5.0.7",
  "lucide-react": "^0.468.0",
  "next": "16.1.6",
  "next-auth": "^5.0.0-beta.30",
  "nodemailer": "^7.0.13",
  "pptxgenjs": "^4.0.1",
  "radix-ui": "^1.4.3",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "react-icons": "^5.3.0",
  "recharts": "^2.10.3",
  "sharp": "^0.34.5",
  "sonner": "^1.7.1",
  "tailwind-merge": "^2.6.1",
  "zod": "^3.22.4"
}
```

### Development Dependencies

```json
{
  "@tailwindcss/postcss": "^4",
  "@types/bcryptjs": "^2.4.6",
  "@types/node": "^20",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "babel-plugin-react-compiler": "1.0.0",
  "eslint": "^9",
  "eslint-config-next": "16.1.6",
  "shadcn": "^3.8.5",
  "tailwindcss": "^4",
  "tw-animate-css": "^1.4.0",
  "typescript": "^5"
}
```

---

## Python Dependencies (Taobao Service)

### requirements.txt

```
fastapi>=0.115.0
uvicorn[standard]>=0.30.0
httpx>=0.27.0
redis>=5.2.0
pydantic>=2.9.0
python-dotenv>=1.0.1
beautifulsoup4>=4.12.3
lxml>=5.3.0
Pillow>=11.0.0
python-multipart>=0.0.12
```

### Key Python Packages

| Package | Purpose |
|---------|---------|
| `fastapi` | Web framework for Taobao API service |
| `uvicorn` | ASGI server to run FastAPI |
| `httpx` | HTTP client for API requests |
| `redis` | Caching layer |
| `pydantic` | Data validation |
| `beautifulsoup4` + `lxml` | HTML parsing |
| `Pillow` | Image processing |

---

## System Dependencies

### Linux (Ubuntu/Debian)

```bash
# Required for Sharp image processing library
sudo apt-get install -y libvips-dev libvips-tools

# Build tools for native Node.js modules
sudo apt-get install -y build-essential

# Python development headers
sudo apt-get install -y python3.11-dev
```

### Windows

```powershell
# Install via Chocolatey
choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

---

## Quick Setup Instructions

### Linux/macOS

```bash
# 1. Run system setup (as root/sudo)
curl -fsSL https://your-repo/scripts/setup-server.sh | sudo bash

# OR manually:
# - Install Node.js 20+: https://nodejs.org/
# - Install Python 3.11: https://python.org/
# - Install Redis: sudo apt-get install redis-server

# 2. Clone the project
git clone <your-repo-url> /opt/sourcing-tool
cd /opt/sourcing-tool

# 3. Run project setup
chmod +x scripts/*.sh
./scripts/setup-project.sh

# 4. Configure environment
cp .env.example .env
nano .env  # Edit with your API keys

# 5. Start services
./scripts/start-services.sh
```

### Windows

```powershell
# 1. Run system setup (as Administrator)
# Download and run: scripts/Setup-Server.ps1

# 2. Clone the project
git clone <your-repo-url> C:\projects\sourcing-tool
cd C:\projects\sourcing-tool

# 3. Run project setup
.\scripts\Setup-Project.ps1

# 4. Configure environment
copy .env.example .env
notepad .env  # Edit with your API keys

# 5. Start services
.\scripts\Start-Services.ps1
```

---

## Environment Variables Required

Copy `.env.example` to `.env` and configure:

| Variable | Required | Description |
|----------|----------|-------------|
| `TAOBAO_SERVICE_URL` | Yes | URL of Taobao service (http://localhost:8001) |
| `ONEBOUND_API_KEY` | Yes | OneBound API key for Taobao |
| `ONEBOUND_API_SECRET` | Yes | OneBound API secret |
| `GEMINI_API_KEY` | Yes | Google Gemini AI API key |
| `REDIS_URL` | No | Redis connection URL (optional) |
| `SMTP_HOST` | No | Email server for password reset |
| `MAX_AI_IMAGES` | No | Max AI designs (default: 4) |

---

## Services Architecture

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Next.js App   │──────▶  Taobao Service  │──────▶   OneBound API  │
│   (Port 3000)   │      │   (Port 8001)    │      │  (Taobao Data)  │
└─────────────────┘      └──────────────────┘      └─────────────────┘
        │                         │
        ▼                         ▼
┌─────────────────┐      ┌──────────────────┐
│   File Storage  │      │   Redis Cache    │
│ (data/, public) │      │   (Port 6379)    │
└─────────────────┘      └──────────────────┘
```

---

## Troubleshooting

### Port Already in Use

```bash
# Check what's using port 8001
lsof -i :8001

# Kill process
kill -9 <PID>
```

### Node.js Native Module Build Failures

```bash
# Rebuild native modules
npm rebuild

# Or delete node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
```

### Python Virtual Environment Issues

```bash
cd services/taobao
rm -rf venv
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## API Keys Setup

1. **OneBound API** (Taobao): https://open.onebound.cn/
2. **Google Gemini**: https://makersuite.google.com/app/apikey
3. **ScrapingBee** (optional): https://www.scrapingbee.com/

---

## File Locations

| Path | Purpose |
|------|---------|
| `data/proposals/` | Proposal JSON storage |
| `public/ai-images/` | AI-generated product images |
| `logs/` | Service log files |
| `services/taobao/` | Python FastAPI service |
