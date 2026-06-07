"""Smoke test for the agent pipe — runs in mock mode, no keys/infra needed.

    python test_pipe.py

Proves: Supervisor → Diplomat (constraints) → Supervisor → Logistician (flights+POIs),
then a weather turn: Supervisor → Sentinel → Reshuffler (OUTDOOR→INDOOR reroute).
"""
import os
os.environ.setdefault("USE_MOCK_LLM", "1")

import json
from orchestrator import run_turn, reset

SID = "demo-session"


def show(title, out):
    print(f"\n=== {title} ===")
    print("active:", out["active_agent"], "| store:", out["store_backend"], "| llm:", out["llm_mode"])
    print("trail:")
    for t in out["trail"]:
        line = f"  {t['agent']:<11} {t['action']}"
        if t.get("result"):
            line += f"  — {t['result'][:80]}"
        print(line)
    print("reply:", out["reply"])


def main():
    reset(SID)
    out1 = run_turn(SID, "Plan a relaxed 3-day trip from SFO to Tokyo, budget $1500, we love food and history.")
    show("Turn 1 — plan the trip", out1)

    out2 = run_turn(SID, "Will the weather mess up our outdoor plans?")
    show("Turn 2 — weather disruption", out2)

    print("\n=== Final TripState ===")
    print(json.dumps(out2["state"], indent=2))

    c = out2["state"]["group_profile"]["compiled_constraints"]
    blocks = out2["state"]["itinerary_manifest"]["calendar_blocks"]
    notes = out2["state"]["copilot_ui_hooks"]["system_notifications"]
    assert c["budget_ceiling_usd"] == 1500, "budget not set by Diplomat"
    assert c["duration_days"] == 3, f"duration_days not extracted: {c['duration_days']}"
    assert out2["state"]["itinerary_manifest"]["destination"] == "Tokyo"
    # 3 days × 3 slots = 9 activity blocks. Plus TRANSIT flight blocks if any.
    activity_blocks = [b for b in blocks if b["type"] != "TRANSIT"]
    assert len(activity_blocks) >= 6, (
        f"Logistician produced too few activity blocks ({len(activity_blocks)})")
    distinct_dates = {b["timestamp_start"][:10] for b in activity_blocks}
    assert len(distinct_dates) >= 2, (
        f"Itinerary should span multiple days, got dates={distinct_dates}")
    assert any("INDOOR" == b["type"] for b in blocks)
    assert notes, "Reshuffler did not push a reroute notification"
    print("\n✅ ALL ASSERTIONS PASSED — full handoff chain works end-to-end.")


if __name__ == "__main__":
    main()
