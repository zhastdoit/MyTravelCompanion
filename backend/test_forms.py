"""Tests for the `[form: ...]` generative-UI submit recognition.

Both halves of the pipeline are exercised:
  - `detect_form_submit` extracts (name, body) from a user message
  - the mock orchestrator's diplomat branch consumes the body to bypass
    the regex-based constraint parsing
"""
from __future__ import annotations

import os

os.environ.setdefault("USE_MOCK_LLM", "1")

from orchestrator import (
    _parse_form_constraints,
    detect_form_submit,
    reset,
    run_turn,
)

SID = "form-test"


def setup_function(_func):
    reset(SID)


def test_detect_form_submit_extracts_name_and_body():
    msg = "[form: GROUP_AGREEMENT] Approved budget=$1500 pacing=RELAXED"
    out = detect_form_submit(msg.lower())
    assert out is not None
    name, body = out
    assert name == "GROUP_AGREEMENT"
    assert "budget=$1500" in body


def test_detect_form_submit_returns_none_for_normal_text():
    assert detect_form_submit("Plan me a trip to Tokyo") is None


def test_parse_form_constraints_pulls_out_typed_fields():
    body = "Approved budget=$2200 pacing=INTENSE must_include=food,art avoid=nightlife"
    args = _parse_form_constraints(body)
    assert args == {
        "budget_ceiling_usd": 2200.0,
        "pacing": "INTENSE",
        "must_include_tags": ["food", "art"],
        "avoid_tags": ["nightlife"],
    }


def test_parse_form_constraints_skips_none_sentinels():
    body = "Approved budget=$0 pacing=RELAXED must_include=none avoid=none"
    args = _parse_form_constraints(body)
    assert "must_include_tags" not in args
    assert "avoid_tags" not in args


def test_group_agreement_form_routes_through_diplomat():
    out = run_turn(
        SID,
        "[form: GROUP_AGREEMENT] Approved budget=$2000 pacing=INTENSE "
        "must_include=food avoid=none",
    )
    state = out["state"]
    c = state["group_profile"]["compiled_constraints"]
    assert c["budget_ceiling_usd"] == 2000.0
    assert c["pacing"] == "INTENSE"
    assert c["must_include_tags"] == ["food"]


def test_flight_picker_confirmation_resolves_to_supervisor_message():
    # Pre-load the trip so the supervisor doesn't bounce to the diplomat.
    run_turn(SID, "Plan a relaxed trip from SFO to Tokyo, budget $1500, food.")
    out = run_turn(
        SID,
        '[form: FLIGHT_PICKER] Confirmed booking airline="MockAir" '
        "flight=MA123 route=SFO->TYO price=$612",
    )
    assert out["active_agent"] == "supervisor"
    assert "Booking confirmed" in out["reply"]
