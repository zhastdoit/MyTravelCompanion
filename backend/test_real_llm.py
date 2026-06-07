"""Tests for `_real_decision` — the OpenAI-backed orchestrator path.

We don't hit the OpenAI API. The OpenAI client is monkeypatched to a tiny stub
that returns canned `chat.completions.create` responses, so the orchestrator's
parsing + transcript bookkeeping + cost metering are exercised deterministically.

Covers the three Decision shapes the LLM can produce:
  1. tool call (`update_constraints`) — `Decision("tool", ...)`
  2. handoff (`transfer_to_supervisor`) — `Decision("transfer", ...)`
  3. plain text reply — `Decision("message", ...)`
Plus error paths (missing API key, malformed args, raised exception).
"""
from __future__ import annotations
import os
import json
import sys

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


# ----------------------------- fakes ---------------------------------------

class _FakeFunction:
    def __init__(self, name: str, arguments: str):
        self.name = name
        self.arguments = arguments


class _FakeToolCall:
    def __init__(self, *, id: str, name: str, arguments: str):
        self.id = id
        self.type = "function"
        self.function = _FakeFunction(name, arguments)

    def model_dump(self) -> dict:
        return {
            "id": self.id, "type": "function",
            "function": {"name": self.function.name,
                         "arguments": self.function.arguments},
        }


class _FakeMessage:
    def __init__(self, *, content: str | None = None,
                 tool_calls: list[_FakeToolCall] | None = None):
        self.content = content
        self.tool_calls = tool_calls


class _FakeChoice:
    def __init__(self, message: _FakeMessage):
        self.message = message


class _FakeUsage:
    def __init__(self, prompt: int = 100, completion: int = 50):
        self.prompt_tokens = prompt
        self.completion_tokens = completion


class _FakeCompletions:
    def __init__(self, response: _FakeMessage, usage: _FakeUsage | None = None,
                 *, raises: Exception | None = None):
        self._response = response
        self._usage = usage or _FakeUsage()
        self._raises = raises
        self.calls: list[dict] = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._raises is not None:
            raise self._raises
        return type("FakeResp", (), {
            "choices": [_FakeChoice(self._response)],
            "usage": self._usage,
        })()


class _FakeChat:
    def __init__(self, completions: _FakeCompletions):
        self.completions = completions


class _FakeOpenAI:
    def __init__(self, response: _FakeMessage, usage: _FakeUsage | None = None,
                 *, raises: Exception | None = None):
        self.completions = _FakeCompletions(response, usage, raises=raises)
        self.chat = _FakeChat(self.completions)


# -------------------------- fixtures ---------------------------------------

@pytest.fixture(autouse=True)
def reset_state():
    """Wipe the orchestrator's per-process caches between tests."""
    orchestrator._openai_client = None
    orchestrator._transcripts.pop(SID, None)
    cost.reset(SID)
    yield
    orchestrator._openai_client = None


def _stub_client(monkeypatch, response: _FakeMessage,
                 usage: _FakeUsage | None = None, *,
                 raises: Exception | None = None) -> _FakeOpenAI:
    fake = _FakeOpenAI(response, usage, raises=raises)
    monkeypatch.setattr(orchestrator, "_get_openai_client", lambda: fake)
    return fake


# ----------------------------- tests ---------------------------------------

def test_real_decision_handles_tool_call(monkeypatch):
    args = {"budget_ceiling_usd": 1500, "destination": "Paris"}
    response = _FakeMessage(tool_calls=[_FakeToolCall(
        id="call_1", name="update_constraints", arguments=json.dumps(args))])
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
    assert cost.tokens(SID)["calls"] == 1


def test_real_decision_handles_transfer(monkeypatch):
    response = _FakeMessage(tool_calls=[_FakeToolCall(
        id="call_2", name="transfer_to_supervisor", arguments="")])
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
    response = _FakeMessage(content="All set ✅", tool_calls=None)
    _stub_client(monkeypatch, response)

    transcript: list[dict] = []
    decision = orchestrator._real_decision(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=transcript, session_id=SID)

    assert decision.kind == "message"
    assert decision.content == "All set ✅"
    assert transcript[-1] == {"role": "assistant", "content": "All set ✅"}


def test_real_decision_swallows_malformed_tool_args(monkeypatch):
    response = _FakeMessage(tool_calls=[_FakeToolCall(
        id="call_3", name="update_constraints", arguments="{invalid json")])
    _stub_client(monkeypatch, response)

    decision = orchestrator._real_decision(
        active="diplomat", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "tool"
    assert decision.tool == "update_constraints"
    assert decision.args == {}


def test_decide_converts_openai_errors_into_terminal_message(monkeypatch):
    boom = RuntimeError("openai down")
    fake = _FakeOpenAI(_FakeMessage(content=""), raises=boom)
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

    def flaky(*_a, **_k):
        calls["count"] += 1
        if calls["count"] == 1:
            raise InternalServerError("boom 503")
        from types import SimpleNamespace
        return SimpleNamespace(
            choices=[SimpleNamespace(message=_FakeMessage(content="recovered"))],
            usage=_FakeUsage(prompt=10, completion=5),
        )

    fake = _FakeOpenAI(_FakeMessage(content=""))
    fake.chat.completions.create = flaky  # type: ignore[assignment]
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

    def always_fails(*_a, **_k):
        raise APIConnectionError("dns dead")

    fake = _FakeOpenAI(_FakeMessage(content=""))
    fake.chat.completions.create = always_fails  # type: ignore[assignment]
    monkeypatch.setattr(orchestrator, "_get_openai_client", lambda: fake)
    monkeypatch.setattr(orchestrator, "RETRY_BACKOFFS", (0.0, 0.0))

    decision = orchestrator._decide(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    assert decision.kind == "message"
    assert "Crew unavailable" in decision.content
    assert "dns dead" in decision.content


def test_real_decision_meters_token_cost(monkeypatch):
    response = _FakeMessage(content="ok")
    _stub_client(monkeypatch, response, _FakeUsage(prompt=200, completion=80))

    orchestrator._real_decision(
        active="supervisor", state=TripState.new(SID), executed=set(),
        transcript=[], session_id=SID)

    tokens = cost.tokens(SID)
    assert tokens["prompt"] == 200
    assert tokens["completion"] == 80
    assert tokens["calls"] == 1
    assert cost.spent(SID) > 0  # supervisor uses gpt-4o-mini, priced at >0
