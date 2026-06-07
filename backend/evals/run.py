"""Run the golden-scenario eval harness.

    python -m evals.run                   # mock LLM, mock externals (free, fast)
    python -m evals.run --real            # real OpenAI (paid; needs OPENAI_API_KEY)
    python -m evals.run --report run.md   # also dump a markdown report

The mock variant runs in CI on every PR. The `--real` variant runs nightly so
production agent-quality regressions surface before users hit them.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import uuid
from pathlib import Path

# Allow running as `python evals/run.py` from the backend dir.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

# CLI before importing the heavy modules so `--mock` can override the env.
parser = argparse.ArgumentParser()
parser.add_argument("--real", action="store_true",
                    help="Use real OpenAI (otherwise USE_MOCK_LLM=1).")
parser.add_argument("--report", type=Path, default=None,
                    help="Path to write a markdown report.")
args = parser.parse_args()

if args.real:
    os.environ["USE_MOCK_LLM"] = "0"
    os.environ.setdefault("MOCK_EXTERNAL_APIS", "0")
else:
    os.environ["USE_MOCK_LLM"] = "1"
    os.environ.setdefault("MOCK_EXTERNAL_APIS", "1")

from evals.scenarios import (  # noqa: E402
    SCENARIOS,
    EvalCheck,
    Scenario,
    all_passed,
    evaluate,
    runner_factory,
    summarize,
)


def _markdown_row(scenario: Scenario, checks: list[EvalCheck], duration_ms: int) -> str:
    n_pass = sum(1 for c in checks if c.passed)
    glyph = "PASS" if n_pass == len(checks) else "FAIL"
    detail = "; ".join(
        f"`{c.name}`: {'ok' if c.passed else 'fail'} ({c.detail})"
        for c in checks
    )
    return f"| **{glyph}** | `{scenario.id}` | {n_pass}/{len(checks)} | {duration_ms}ms | {detail} |"


def main() -> int:
    runner = runner_factory()
    failures = 0
    rows: list[str] = []

    print(f"== synctrip evals (mode={'real' if args.real else 'mock'}) ==")
    for scenario in SCENARIOS:
        sid = f"eval_{scenario.id}_{uuid.uuid4().hex[:6]}"
        t0 = time.perf_counter()
        out = runner(sid, scenario.prompt)
        elapsed_ms = int((time.perf_counter() - t0) * 1000)
        checks = evaluate(scenario, out["state"])
        if not all_passed(checks):
            failures += 1
        line = summarize(scenario, checks)
        print(f"{line}  ({elapsed_ms}ms)")
        rows.append(_markdown_row(scenario, checks, elapsed_ms))

    if args.report:
        args.report.write_text(
            "# SyncTrip eval report\n\n"
            f"- mode: **{'real OpenAI' if args.real else 'mock'}**\n"
            f"- scenarios: {len(SCENARIOS)}; failures: {failures}\n\n"
            "| status | scenario | checks | latency | detail |\n"
            "|--------|----------|--------|---------|--------|\n"
            + "\n".join(rows) + "\n"
        )
        print(f"-> wrote report to {args.report}")

    if failures:
        print(f"== {failures} scenario(s) failed", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
