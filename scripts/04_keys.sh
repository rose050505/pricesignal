#!/usr/bin/env bash
# PriceSignal setup step 4: put secrets into .env without printing them anywhere.
# Usage: bash scripts/04_keys.sh ZETARIS_API_KEY   |   NVIDIA_API_KEY   |   METERLESS_RUNTIME_TOKEN   |   METERLESS_BASE_URL
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] || cp .env.example .env
K="${1:?which key? e.g. ZETARIS_API_KEY}"
read -r -s -p "$K 값을 붙여넣고 Enter (화면에 표시되지 않음): " V; echo
[ -n "$V" ] || { echo "빈 값 — 취소"; exit 1; }
V_ESC=$(printf '%s' "$V" | sed 's/[|&]/\\&/g')
if grep -q "^$K=" .env; then sed -i "s|^$K=.*|$K=$V_ESC|" .env; else echo "$K=$V" >> .env; fi
chmod 600 .env
echo "$K 저장됨 (길이 ${#V})"; mkdir -p logs; echo "$(date +%H:%M:%S) $K set (len ${#V})" >> logs/04_keys.log
