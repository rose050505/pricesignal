#!/usr/bin/env bash
# PriceSignal setup step 2: install Zetaris locally (Docker). Interactive only for the registry login.
# Usage: bash scripts/02_zetaris_install.sh            (finds zetaris-platform.zip in Downloads)
set -uo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"; mkdir -p "$APP/logs"; LOG="$APP/logs/02_zetaris.log"
ZDIR="$HOME/해커톤/zetaris-platform"
ZIP="${1:-$(ls -t "$HOME"/해커톤/zetaris-platform*.zip "$HOME"/다운로드/zetaris-platform*.zip "$HOME"/Downloads/zetaris-platform*.zip 2>/dev/null | head -1)}"
say(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
say "zip: ${ZIP:-NOT FOUND}"
[ -n "${ZIP:-}" ] || { say "zetaris-platform.zip not found in ~/다운로드 or ~/Downloads"; exit 1; }
if [ ! -d "$ZDIR" ]; then
  mkdir -p "$ZDIR.tmp" && unzip -q -o "$ZIP" -d "$ZDIR.tmp" || { say "unzip failed"; exit 1; }
  inner="$(find "$ZDIR.tmp" -maxdepth 2 -name docker-compose.yml -printf '%h\n' | head -1)"
  mv "$inner" "$ZDIR" && rm -rf "$ZDIR.tmp"
fi
cd "$ZDIR" || exit 1
say "platform dir: $ZDIR ($(ls | tr '\n' ' '))"
# 1) registry login (asks for the username/password shown on the Zetaris 'Run locally' page)
if ! grep -q zetarishackathon "$HOME/.docker/config.json" 2>/dev/null; then
  echo; echo "== Zetaris 'Run locally' 페이지의 레지스트리 사용자명/비밀번호를 입력하세요 =="
  docker login zetarishackathon.azurecr.io || { say "docker login failed"; exit 1; }
fi
say "registry login ok"
# 2) admin account + laptop settings, before the first start
ADMIN_FILE="$APP/.zetaris_admin"
if [ ! -f "$ADMIN_FILE" ]; then
  PW="Ps$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 14)9!"
  printf 'ZETARIS_ADMIN_EMAIL=bmy31513151@gmail.com\nZETARIS_ADMIN_PASSWORD=%s\n' "$PW" > "$ADMIN_FILE"; chmod 600 "$ADMIN_FILE"
fi
. "$ADMIN_FILE"
setkv(){ if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi; }
cp -n .env .env.orig 2>/dev/null || true
setkv ZETARIS_ADMIN_EMAIL "$ZETARIS_ADMIN_EMAIL"; setkv ZETARIS_ADMIN_PASSWORD "$ZETARIS_ADMIN_PASSWORD"; setkv ZETARIS_ADMIN_ORG PriceSignal
setkv ZSPARK_DRIVER_MEM 2g; setkv ZSPARK_DRIVER_CORES 2; setkv ZSPARK_MASTER_URL 'local[2]'; setkv ZETARIS_API_MAX_HEAP 1g
setkv UI_PORT 3000; setkv ALLOWED_ORIGINS http://localhost:3000; setkv GUI_URL http://localhost:3000; setkv COMPOSE_PROFILES ''; setkv ZETARIS_SEED_TPCH true
chmod 600 .env
docker compose config --quiet && say ".env valid" || { say ".env invalid"; exit 1; }
[ -x ./preflight.sh ] && ./preflight.sh 2>&1 | tail -25 | tee -a "$LOG"
# 3) pull + start in the background (30-45 min first time)
say "starting pull + up in background; progress -> logs/02_zetaris_pull.log"
nohup bash -c 'docker compose pull && docker compose up -d && echo PULL_UP_DONE; docker compose ps --all' > "$APP/logs/02_zetaris_pull.log" 2>&1 &
echo; echo "설치가 백그라운드에서 진행 중입니다. 이 창은 닫아도 됩니다."
echo "관리자 로그인: $ZETARIS_ADMIN_EMAIL / 비밀번호는 $ADMIN_FILE 에 저장됨 (cat 으로 확인)"
