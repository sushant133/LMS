#!/usr/bin/env bash
# Run this ON the VPS after git pull.
# git pull alone does NOT update the live site — dist/ folders are gitignored.
#
# Usage (from repo root, e.g. /var/www/LMS):
#   chmod +x scripts/deploy-on-server.sh
#   ./scripts/deploy-on-server.sh
#
# Optional env:
#   PM2_APP_NAME=lms-api   # default: try common names
#   SKIP_NPM_INSTALL=1     # skip npm install steps

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Repo: $ROOT"
echo "==> Git: $(git rev-parse --short HEAD 2>/dev/null || echo unknown) $(git log -1 --pretty=%s 2>/dev/null || true)"

if [[ "${SKIP_NPM_INSTALL:-0}" != "1" ]]; then
  echo "==> Backend npm install"
  (cd backend && npm install --omit=dev 2>/dev/null || npm install)
  echo "==> Frontend npm install"
  (cd frontend && npm install)
fi

echo "==> Build shared + backend (TypeScript → backend/dist)"
(cd backend && npm run build)

echo "==> Build frontend (Vite → frontend/dist)"
(cd frontend && npm run build)

# Restart Node API so new backend/dist is loaded
PM2_NAME="${PM2_APP_NAME:-}"
if command -v pm2 >/dev/null 2>&1; then
  if [[ -n "$PM2_NAME" ]]; then
    echo "==> pm2 restart $PM2_NAME"
    pm2 restart "$PM2_NAME" || true
  else
    echo "==> pm2 restart (trying common process names)"
    pm2 restart all 2>/dev/null || pm2 restart lms 2>/dev/null || pm2 restart LMS 2>/dev/null || pm2 restart backend 2>/dev/null || {
      echo "    Could not auto-restart. Run: pm2 list && pm2 restart <name>"
    }
  fi
  pm2 save 2>/dev/null || true
elif systemctl is-active --quiet lms 2>/dev/null; then
  echo "==> systemctl restart lms"
  sudo systemctl restart lms
else
  echo "==> No pm2/systemd found. Restart your Node process manually so it loads backend/dist."
fi

# Nginx usually serves frontend/dist as static files — no restart needed after rebuild.
# Reload nginx if you changed proxy config only:
#   sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "==> Deploy finished."
echo "    Frontend: $ROOT/frontend/dist"
echo "    Backend:  $ROOT/backend/dist"
echo ""
echo "    On phone/PC: hard refresh (Ctrl+Shift+R) or clear site data."
echo "    PWA may keep old JS until you close all LMS tabs and reopen."
echo ""
echo "    Quick check:"
echo "      curl -s https://lms.phit.com.np/ | head"
echo "      # index-*.js hash in HTML should change after each frontend build"
