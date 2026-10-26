#!/usr/bin/env bash
# PriceSignal setup step 1: read-only environment check. Writes logs/01_check.txt (no secrets).
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
OUT=logs/01_check.txt
{
  echo "== date"; date
  echo "== os"; uname -a; (lsb_release -ds 2>/dev/null || cat /etc/os-release | head -3)
  echo "== cpu/mem/disk"; nproc; free -g | head -2; df -h "$HOME" | tail -1
  echo "== docker"; command -v docker && docker version --format '{{.Client.Version}} / server {{.Server.Version}}' 2>&1 | head -3
  echo "== docker compose"; docker compose version 2>&1 | head -1
  echo "== docker without sudo?"; docker ps >/dev/null 2>&1 && echo yes || echo "no (permission or daemon down)"
  echo "== groups"; id -nG
  echo "== node/npm/git/python"; (node -v; npm -v; git --version; python3 --version) 2>&1
  echo "== claude/codex cli"; command -v claude codex 2>&1
  echo "== zetaris zip"; ls -la "$HOME"/다운로드/zetaris-platform* "$HOME"/Downloads/zetaris-platform* 2>/dev/null; find "$HOME" -maxdepth 3 -name 'zetaris-platform*' 2>/dev/null | head
  echo "== lan ip"; hostname -I 2>/dev/null
  echo "== ports in use (3000 8888 10000)"; (ss -ltn 2>/dev/null | grep -E ':(3000|8888|10000) ') || echo none
} > "$OUT" 2>&1
echo "done -> $OUT"
cat "$OUT"
