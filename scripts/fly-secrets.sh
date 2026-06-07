#!/usr/bin/env bash
# Push every secret in backend/.env up to a Fly.io app in one shot.
#
# Usage:
#   bash scripts/fly-secrets.sh                      # uses fly.toml's app name
#   bash scripts/fly-secrets.sh -a synctrip-backend  # explicit app
#
# Skips empty / commented lines and any var listed in `_NEVER_PUSH` below.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"
APP_FLAG=()

# Vars that should NEVER be pushed (purely local-dev knobs that would override
# the production fly.toml [env] block).
_NEVER_PUSH=("PORT" "SYNCTRIP_ENV")

while [[ $# -gt 0 ]]; do
  case "$1" in
    -a|--app) APP_FLAG=("--app" "$2"); shift 2 ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — copy backend/.env.example and fill it in first" >&2
  exit 1
fi

if ! command -v fly >/dev/null 2>&1; then
  echo "fly CLI not found. Install: https://fly.io/docs/flyctl/install/" >&2
  exit 1
fi

declare -a kvs=()
while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  [[ "$line" =~ ^[A-Z_][A-Z0-9_]*= ]] || continue
  name="${line%%=*}"
  value="${line#*=}"
  [[ -z "$value" ]] && continue
  skip=0
  for skip_name in "${_NEVER_PUSH[@]}"; do
    [[ "$name" == "$skip_name" ]] && skip=1 && break
  done
  (( skip )) && continue
  kvs+=("$name=$value")
done < "$ENV_FILE"

if (( ${#kvs[@]} == 0 )); then
  echo "[fly-secrets] no values found in $ENV_FILE" >&2
  exit 1
fi

echo "[fly-secrets] pushing ${#kvs[@]} secret(s) to fly"
fly secrets set "${APP_FLAG[@]}" "${kvs[@]}"
