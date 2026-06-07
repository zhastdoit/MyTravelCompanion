#!/usr/bin/env bash
# Verifies that the env vars required for the active mode are present.
#
# Usage:
#   bash scripts/check-env.sh                    # default: full prod check
#   bash scripts/check-env.sh --mode=demo        # only LLM-mock essentials
#   bash scripts/check-env.sh --mode=ci          # what GitHub Actions needs
#
# Reads .env files first (backend/.env, frontend/travel/.env.local) so it
# matches what `uvicorn` / `next dev` will actually see at runtime.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="prod"
MISSING=()

for arg in "$@"; do
  case "$arg" in
    --mode=*) MODE="${arg#--mode=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# Source .env files non-destructively so existing shell exports win.
load_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^[A-Z_][A-Z0-9_]*=' "$file" | sed 's/^/export /')
  set +a
}
load_env "$ROOT/backend/.env"
load_env "$ROOT/frontend/travel/.env.local"

require() {
  local name="$1" reason="$2"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then
    MISSING+=("$name — $reason")
  fi
}

# Always required, regardless of mode.
require ALLOWED_ORIGIN "FastAPI CORS origin"
require BACKEND_URL "Next.js gateway target"

case "$MODE" in
  demo)
    require USE_MOCK_LLM "set to 1 to short-circuit OpenAI"
    ;;
  ci)
    require USE_MOCK_LLM "CI runs free / mock"
    ;;
  prod)
    require OPENAI_API_KEY "real LLM mode"
    require AMADEUS_API_KEY "real flight search"
    require AMADEUS_API_SECRET "real flight search"
    require GEOAPIFY_API_KEY "real POI + geocode"
    require OPENWEATHER_API_KEY "real weather"
    require REDIS_URL "Upstash Redis HOT store"
    require SUPABASE_URL "Supabase auth + cold trips"
    require SUPABASE_SERVICE_ROLE_KEY "Supabase server-side writes"
    require SUPABASE_JWT_SECRET "verify user-issued JWTs"
    require NEXT_PUBLIC_SUPABASE_URL "Supabase browser client"
    require NEXT_PUBLIC_SUPABASE_ANON_KEY "Supabase browser client"
    require NEXT_PUBLIC_MAPBOX_TOKEN "live map tiles"
    require NEXT_PUBLIC_APP_URL "auth redirect / share links"
    ;;
  *)
    echo "unknown mode: $MODE (use demo|ci|prod)" >&2
    exit 2
    ;;
esac

if (( ${#MISSING[@]} == 0 )); then
  echo "[check-env] OK — mode=$MODE"
  exit 0
fi

echo "[check-env] FAIL — mode=$MODE — ${#MISSING[@]} missing key(s):" >&2
for entry in "${MISSING[@]}"; do
  echo "  - $entry" >&2
done
exit 1
