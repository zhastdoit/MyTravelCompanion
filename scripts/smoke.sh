#!/usr/bin/env bash
# End-to-end smoke for the FastAPI backend + Next.js gateway.
#
# What it does:
#   1. Boots the FastAPI agent server on :8000 (mock-LLM mode, no key needed).
#   2. Boots Next.js dev on :3000.
#   3. Hits the Next.js proxy `/api/trip/{sid}/state` for a fresh sid and checks
#      that it round-trips through to FastAPI.
#   4. Sends a /api/chat request directly to the backend and re-checks state.
#   5. Tears down both servers.
#
# Requires: python venv at backend/.venv, frontend deps installed, uuidgen,
# curl, jq.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend/travel"
LOG_DIR="$(mktemp -d)"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

cleanup() {
  local code=$?
  set +e
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null
  fi
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null
  fi
  if [[ "$code" -ne 0 ]]; then
    echo "--- backend.log (last 40) ---" >&2
    tail -n 40 "$BACKEND_LOG" >&2 || true
    echo "--- frontend.log (last 40) ---" >&2
    tail -n 40 "$FRONTEND_LOG" >&2 || true
  fi
  rm -rf "$LOG_DIR"
  exit "$code"
}
trap cleanup EXIT INT TERM

wait_for() {
  local url="$1" name="$2" attempts=60
  for ((i = 1; i <= attempts; i++)); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "[smoke] $name ready ($url)"
      return 0
    fi
    sleep 1
  done
  echo "[smoke] $name failed to start within ${attempts}s" >&2
  return 1
}

echo "[smoke] starting backend..."
(
  cd "$BACKEND"
  if [[ -f .venv/bin/activate ]]; then
    # shellcheck disable=SC1091
    source .venv/bin/activate
  fi
  USE_MOCK_LLM=1 uvicorn main:app --port 8000 --log-level warning >"$BACKEND_LOG" 2>&1
) &
BACKEND_PID=$!
wait_for "http://localhost:8000/health" "backend"

echo "[smoke] starting frontend..."
(
  cd "$FRONTEND"
  BACKEND_URL="http://localhost:8000" npm run dev -- --port 3000 >"$FRONTEND_LOG" 2>&1
) &
FRONTEND_PID=$!
wait_for "http://localhost:3000" "frontend"

SID="smoke_$(uuidgen | tr -d - | cut -c1-12)"
echo "[smoke] sid=$SID"

echo "[smoke] GET /api/trip/{sid}/state via gateway..."
curl -sf "http://localhost:3000/api/trip/$SID/state" | jq . >/dev/null

echo "[smoke] POST /api/chat directly to backend..."
curl -sf -X POST "http://localhost:8000/api/chat" \
  -H "content-type: application/json" \
  -d "{\"session_id\":\"$SID\",\"message\":\"Plan a relaxed trip from SFO to Tokyo for 3 days, \$1500 budget.\"}" \
  | jq -e '.state.itinerary_manifest.destination | length > 0' >/dev/null

echo "[smoke] GET /api/trip/{sid}/state via gateway, expect populated destination..."
curl -sf "http://localhost:3000/api/trip/$SID/state" \
  | jq -e '.itinerary_manifest.destination | length > 0' >/dev/null

echo "[smoke] GET /api/trip/{sid}/telemetry via gateway, expect llm_mode + cost fields..."
curl -sf "http://localhost:3000/api/trip/$SID/telemetry" \
  | jq -e '.llm_mode == "mock" and (.usd_cap | type == "number") and (.tokens.calls | type == "number")' >/dev/null

echo "[smoke] OK"
