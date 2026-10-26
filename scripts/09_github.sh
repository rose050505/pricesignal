#!/usr/bin/env bash
# Create the public GitHub repo and push. Refuses to push if a secret-looking string is tracked.
# Usage: bash scripts/09_github.sh            (repo name: pricesignal)
cd "$(dirname "$0")/.." || exit 1; mkdir -p logs
NAME="${1:-pricesignal}"
{
  [ -d .git ] || git init -q -b main
  git add -A
  echo "== files to be committed"; git diff --cached --name-only | head -60
  if git diff --cached --name-only | grep -E '(^|/)\.env$|\.zetaris_admin|^logs/|^out/|^vendor/|node_modules' ; then echo "STOP: ignored file staged"; exit 1; fi
  if git grep --cached -nE 'sk-or-v1-[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|ZETARIS_API_KEY=[^ ]+[A-Za-z0-9]{10}|METERLESS_RUNTIME_TOKEN=[A-Za-z0-9]{10}' ; then echo "STOP: secret-looking string tracked"; exit 1; fi
  git -c user.name="${GIT_NAME:-Miyeong Park}" -c user.email="${GIT_EMAIL:-bmy31513151@gmail.com}" commit -qm "PriceSignal: cross-border inflation agent (Zetaris + Meterless Nightshift + H-MEM)" || echo "(nothing new to commit)"
  if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
    if git remote get-url origin >/dev/null 2>&1; then git push -u origin main; else gh repo create "$NAME" --public --source . --push --description "Cross-border inflation agent for exporters - Open Agent Hackathon 2026 (Zetaris + Meterless)"; fi
    echo "REPO: $(gh repo view --json url -q .url 2>/dev/null)"
  else
    echo "gh CLI not logged in. Either run: gh auth login   (then this script again)"
    echo "or create an empty public repo named $NAME on github.com and run:"
    echo "  git remote add origin https://github.com/<your-id>/$NAME.git && git push -u origin main"
  fi
} 2>&1 | tee logs/09_github.log
