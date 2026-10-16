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

echo "==> Build frontend (Vite → frontend/dist.new, then swap in)"
# 1. Build into a separate folder, so the live site keeps serving the current
#    build for the whole ~30 s the build takes (Vite empties its output folder
#    first; building straight into dist/ broke the site during every deploy).
# 2. Vite also deletes the previous build's hashed chunks. Tabs and installed
#    PWAs still running the previous build then fail to lazy-load pages
#    ("This page needs a refresh" / MIME type text/html). Keep earlier chunks
#    in a stash and copy them into the new build; chunks are content-hashed,
#    so old and new files never collide. Stash entries expire after
#    ASSET_KEEP_DAYS (default 14).
# 3. Swap folders with two renames, so there is no window with a half-built site.
ASSET_STASH="$ROOT/frontend/.asset-stash"
mkdir -p "$ASSET_STASH"
if [[ -d frontend/dist/assets ]]; then
  cp -p frontend/dist/assets/* "$ASSET_STASH"/ 2>/dev/null || true
fi
rm -rf frontend/dist.new
(cd frontend && npm run build -- --outDir dist.new)
if [[ ! -f frontend/dist.new/index.html ]]; then
  echo "!! Frontend build produced no index.html — live site left unchanged." >&2
  exit 1
fi
find "$ASSET_STASH" -type f -mtime +"${ASSET_KEEP_DAYS:-14}" -delete 2>/dev/null || true
cp -p --update=none "$ASSET_STASH"/* frontend/dist.new/assets/ 2>/dev/null \
  || cp -pn "$ASSET_STASH"/* frontend/dist.new/assets/ 2>/dev/null || true
echo "    Kept $(ls "$ASSET_STASH" | wc -l) earlier asset files for open tabs"
rm -rf frontend/dist.prev
if [[ -d frontend/dist ]]; then mv frontend/dist frontend/dist.prev; fi
mv frontend/dist.new frontend/dist
echo "    Previous build kept at frontend/dist.prev (instant rollback:"
echo "      mv frontend/dist frontend/dist.bad && mv frontend/dist.prev frontend/dist)"

# Restart Node API so new backend/dist is loaded
# Default to the LMS API only, so other apps on this VPS (e.g. project-backend for
# phit.com.np) are not restarted by an LMS deploy. Override with PM2_APP_NAME.
PM2_NAME="${PM2_APP_NAME:-}"
if [[ -z "$PM2_NAME" ]] && command -v pm2 >/dev/null 2>&1 && pm2 describe lms-backend >/dev/null 2>&1; then
  PM2_NAME="lms-backend"
fi
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
#
# One-time nginx check: /assets/ must NOT fall back to index.html, and index.html/sw.js
# must not be cached — otherwise clients boot an old shell and hit
# "Expected a JavaScript-or-Wasm module script ... MIME type of text/html" after a deploy.
# See scripts/nginx-frontend.conf.example.

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
