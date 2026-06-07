"""Tests for `_real_decision` — the OpenAI Responses-API orchestrator path.

We don't hit the OpenAI API. The OpenAI client is monkeypatched to a tiny stub
that returns canned `responses.create` payloads, so the orchestrator's
parsing + transcript bookkeeping + cost metering are exercised deterministically.

Covers the three Decision shapes the LLM can produce:
  1. tool call (`update_constraints`) — `Decision("tool", ...)`
  2. handoff (`transfer_to_supervisor`) — `Decision("transfer", ...)`
  3. plain text reply — `Decision("message", ...)`
Plus error paths (missing API key, malformed args, raised exception) and the
new `web_search_call` cost-accounting path.
"""
from __future__ import annotations
import os
import json
import sys
from types import SimpleNamespace

# Force real-LLM mode BEFORE we import the orchestrator module so its
# module-level `USE_MOCK_LLM` flag is `False` for these tests.
os.environ["USE_MOCK_LLM"] = "0"
os.environ.setdefault("OPENAI_API_KEY", "test-key-for-monkeypatch")

# Drop any cached import from earlier mock-mode test modules so the
# orchestrator picks up the new env above.
for mod in ("orchestrator", "main"):
    sys.modules.pop(mod, None)

import pytest

import orchestrator
import cost
from state import TripState

SID = "test-real-llm"


# ----------------------------- output-item builders ------------------------

def _function_call_item(*, name: str, arguments: str, call_id: str):
    return SimpleNamespace(type="function_call", name=name,
                           arguments=arguments, call_id=call_id, id=call_id)


def _message_item(text: str):
    """Mimic the SDK shape: a `message` item with a list of `output_text` parts."""
    part = SimpleNamespace(type="output_text", text=text)
    return SimpleNamespace(type="message", role="assistant", content=[part])


def _web_search_item(call_id: str = "ws_1"):
    return SimpleNamespace(type="web_search_call", id=call_id, status="completed")


def _usage(prompt: int = 100, completion: int = 50):
    return SimpleNamespace(input_tokens=prompt, output_tokens=completion,
                           total_tokens=prompt + completion)


def _resp(output_items, *, usage=None, output_text: str | None = None):
    """Build a fake Responses-API response object."""
    if output_text is None:
        output_text = "".join(
            getattr(p, "text", "") for it in output_items
            if getattr(it, "type", "") == "message"
            for p in (it.content or [])
        )
    return SimpleNamespace(output=output_items, usage=usage or _usage(),
                           output_text=output_text)


# ----------------------------- fake client ---------------------------------

class _FakeResponses:
    def __init__(self, response, *, raises: Exception | None = None):
        self._response = response
        self._raises = raises
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises is not None:
            raise self._raises
        return self._response


class _FakeOpenAI:
    def __init__(self, response, *, raises: Exception | None = None):
        self.responses = _FakeResponses(response, raises=raises)


# -------------------------- fixtures ---------------------------------------

@pytest.fixture(autouse=True)
def reset_state():
    """Wipe the orchestrator's per-process caches between tests."""
    orchestrator._openai_client = None
    orchestrator._transcripts.pop(SID, None)
    cost.reset(SID)
    yield
    orchestrator._openai_client = None


def _stub_client(monkeypatch, response, *, raises: Exception | None = None) -> _FakeOpenAI:
    fake = _FakeOpenAI(response, raises=raises)
    monkeypatch.setattr(orchestrator, "_get_openai_client", lambda: fake)
    return fake


# ----------------------------- tests ---------------------------------------

def test_real_decision_handles_tool_call(monkeypatch):
    args = {"budget_ceiling_usd": 1500, "destination": "Paris"}
    response = _resp([_function_call_item(
        name="update_constraints", arguments=json.dumps(args), call_id="call_1")])
    _stub_client(monkeypatch, response)

    transcript: list[dict] = []
    state = TripState.new(SID)
    decision = orchestrator._real_decision(
        active="diplomat", state=state, executed=set(),
        transcript=transcript, session_id=SID)

    assert decision.kind == "tool"
    assert decision.tool == "update_constraints"
    assert decision.args == args
    assert decision.content == "call_1"
    assert transcript[0]["role"] == "assistant"
    assert transcript[0]["tool_calls"][0]["id"] == "call_1"
    assert transcript[0]["tool_calls"][0]["function"]["name"] == "update_constraints"
    assert cost.tokens(SID)["calls"] == 1


def test_real_decision_handles_transfer(monkeypatch):
    response = _resp([_function_call_item(
        name="transfer_to_supervisor", arguments="", call_id="call_2")])
    _stub_client(monkeypatch, response)

    transcript: list[dict] = []
    decision = orchestrator._real_decision(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=transcript, session_id=SID)

    assert decision.kind == "transfer"
    assert decision.target == "supervisor"
    # Both the assistant tool-call and the matching tool reply should be queued
    # so the next OpenAI turn sees a well-formed conversation.
    assert transcript[0]["role"] == "assistant"
    assert transcript[1]["role"] == "tool"
    assert transcript[1]["tool_call_id"] == "call_2"


def test_real_decision_handles_text_message(monkeypatch):
    response = _resp([_message_item("All set.")])
    _stub_client(monkeypatch, response)

    transcript: list[dict] = []
    decision = orchestrator._real_decision(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=transcript, session_id=SID)

    assert decision.kind == "message"
    assert decision.content == "All set."
    assert transcript[-1] == {"role": "assistant", "content": "All set."}


def test_real_decision_swallows_malformed_tool_args(monkeypatch):
    response = _resp([_function_call_item(
        name="update_constraints", arguments="{invalid json", call_id="call_3")])
    _stub_client(monkeypatch, response)

    decision = orchestrator._real_decision(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "tool"
    assert decision.tool == "update_constraints"
    assert decision.args == {}


def test_real_decision_meters_web_search_cost(monkeypatch):
    response = _resp(
        [_web_search_item("ws_1"), _web_search_item("ws_2"),
         _message_item("Searched the web.")],
        usage=_usage(prompt=10, completion=10),
    )
    _stub_client(monkeypatch, response)

    decision = orchestrator._real_decision(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "message"
    assert decision.content == "Searched the web."
    assert cost.tokens(SID)["web_searches"] == 2
    # Two searches × $0.025 + tiny token cost > $0.05
    assert cost.spent(SID) >= 2 * cost.WEB_SEARCH_USD


def test_decide_converts_openai_errors_into_terminal_message(monkeypatch):
    boom = RuntimeError("openai down")
    fake = _FakeOpenAI(_resp([]), raises=boom)
    monkeypatch.setattr(orchestrator, "_get_openai_client", lambda: fake)

    decision = orchestrator._decide(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "message"
    assert "Crew unavailable" in decision.content
    assert "openai down" in decision.content


def test_decide_complains_loudly_when_api_key_missing(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    orchestrator._openai_client = None

    decision = orchestrator._decide(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "message"
    assert "OPENAI_API_KEY" in decision.content


def test_decide_retries_transient_openai_5xx(monkeypatch):
    """One transient `InternalServerError` -> success on retry, no user-facing
    error. We monkey-patch a fake exception class with the matching name so
    `_is_retryable` accepts it without dragging the real OpenAI SDK in.
    """
    class InternalServerError(Exception):
        pass

    calls = {"count": 0}

    def flaky(**_kwargs):
        calls["count"] += 1
        if calls["count"] == 1:
            raise InternalServerError("boom 503")
        return _resp([_message_item("recovered")], usage=_usage(10, 5))

    fake = _FakeOpenAI(_resp([]))
    fake.responses.create = flaky  # type: ignore[assignment]
    monkeypatch.setattr(orchestrator, "_get_openai_client", lambda: fake)
    monkeypatch.setattr(orchestrator, "RETRY_BACKOFFS", (0.0, 0.0))

    decision = orchestrator._decide(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "message"
    assert decision.content == "recovered"
    assert calls["count"] == 2


def test_decide_gives_up_after_repeated_transient_errors(monkeypatch):
    class APIConnectionError(Exception):
        pass

    def always_fails(**_kwargs):
        raise APIConnectionError("dns dead")

    fake = _FakeOpenAI(_resp([]))
    fake.responses.create = always_fails  # type: ignore[assignment]
    monkeypatch.setattr(orchestrator, "_get_openai_client", lambda: fake)
    monkeypatch.setattr(orchestrator, "RETRY_BACKOFFS", (0.0, 0.0))

    decision = orchestrator._decide(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "message"
    assert "Crew unavailable" in decision.content
    assert "dns dead" in decision.content


def test_real_decision_meters_token_cost(monkeypatch):
    response = _resp([_message_item("ok")], usage=_usage(prompt=200, completion=80))
    _stub_client(monkeypatch, response)

    orchestrator._real_decision(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    tokens = cost.tokens(SID)
    assert tokens["prompt"] == 200
    assert tokens["completion"] == 80
    assert tokens["calls"] == 1
    assert cost.spent(SID) > 0  # supervisor uses gpt-4o-mini, priced at >0


def test_real_decision_passes_web_search_tool_when_enabled(monkeypatch):
    """Diplomat (web_search=True) should get the built-in tool appended."""
    response = _resp([_message_item("hi")])
    fake = _stub_client(monkeypatch, response)

    orchestrator._real_decision(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    sent_tools = fake.responses.calls[0]["tools"]
    assert any(t.get("type") == "web_search_preview" for t in sent_tools)


def test_real_decision_skips_web_search_tool_when_disabled(monkeypatch):
    """Supervisor (web_search=False) must not see the built-in tool."""
    response = _resp([_message_item("hi")])
    fake = _stub_client(monkeypatch, response)

    orchestrator._real_decision(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    sent_tools = fake.responses.calls[0]["tools"] or []
    assert not any(t.get("type") == "web_search_preview" for t in sent_tools)


def test_to_responses_inputs_translates_chat_completions_transcript():
    transcript = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": None,
         "tool_calls": [{"id": "c1", "type": "function",
                         "function": {"name": "update_constraints", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "c1", "content": "ok"},
        {"role": "assistant", "content": "done"},
    ]
    inputs = orchestrator._to_responses_inputs(transcript)

    assert inputs[0] == {"role": "user", "content": "hello"}
    assert inputs[1] == {"type": "function_call", "name": "update_constraints",
                         "arguments": "{}", "call_id": "c1"}
    assert inputs[2] == {"type": "function_call_output", "call_id": "c1", "output": "ok"}
    assert inputs[3] == {"role": "assistant", "content": "done"}
