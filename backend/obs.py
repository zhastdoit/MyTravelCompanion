"""Observability shim — W&B Weave, made optional.

Decorate any function with @op so it shows up as a span in the Weave trace waterfall.
If weave isn't installed or WEAVE_PROJECT isn't set, @op becomes a no-op so the server
still runs. Set WEAVE_PROJECT=your-entity/synctrip (and `weave login`) to turn it on.
"""
from __future__ import annotations
import os
import functools

WEAVE_ON = False
_weave = None
try:
    if os.getenv("WEAVE_PROJECT"):
        import weave  # type: ignore
        weave.init(os.environ["WEAVE_PROJECT"])
        _weave = weave
        WEAVE_ON = True
except Exception as e:  # pragma: no cover
    print(f"[obs] Weave disabled: {e}")
    WEAVE_ON = False


def op(fn=None, *, name: str | None = None):
    """@op or @op(name=...) — traces with Weave when on, else passthrough."""
    def wrap(f):
        if WEAVE_ON:
            return _weave.op(name=name)(f) if name else _weave.op()(f)
        @functools.wraps(f)
        def inner(*a, **k):
            return f(*a, **k)
        return inner
    return wrap(fn) if fn else wrap
