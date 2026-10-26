#!/usr/bin/env bash
# PriceSignal setup step 0: Docker Engine + Compose plugin from Ubuntu's own repository (asks for the sudo password once).
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
{
  sudo apt-get update -y && sudo apt-get install -y docker.io docker-compose-v2 unzip \
    && sudo systemctl enable --now docker && sudo usermod -aG docker "$USER" \
    && echo "INSTALL_OK" && docker --version && sudo docker compose version
} 2>&1 | tee logs/00_docker.log | tail -8
echo; echo "끝나면: 터미널 창을 닫고 새로 열어 주세요 (docker 그룹 적용). 또는 지금 창에서: newgrp docker"
