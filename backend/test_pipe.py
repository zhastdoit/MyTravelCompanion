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
    out1 = run_turn(SID, "Plan a relaxed trip from SFO to Tokyo, budget $1500, we love food and history.")
    show("Turn 1 — plan the trip", out1)

    out2 = run_turn(SID, "Will the weather mess up our outdoor plans?")
    show("Turn 2 — weather disruption", out2)

    print("\n=== Final TripState ===")
    print(json.dumps(out2["state"], indent=2))

    c = out2["state"]["group_profile"]["compiled_constraints"]
    blocks = out2["state"]["itinerary_manifest"]["calendar_blocks"]
    notes = out2["state"]["copilot_ui_hooks"]["system_notifications"]
    assert c["budget_ceiling_usd"] == 1500, "budget not set by Diplomat"
    assert out2["state"]["itinerary_manifest"]["destination"] == "Tokyo"
    assert len(blocks) >= 3, "Logistician did not add itinerary blocks"
    assert any("INDOOR" == b["type"] for b in blocks)
    assert notes, "Reshuffler did not push a reroute notification"
    print("\n✅ ALL ASSERTIONS PASSED — full handoff chain works end-to-end.")


if __name__ == "__main__":
    main()
