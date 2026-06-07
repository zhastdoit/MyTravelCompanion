"""Golden scenarios for the agent crew.

Each scenario is one canonical user prompt + a set of post-conditions that
should hold against the resulting ``TripState`` regardless of route taken
(mock vs real LLM, mock vs live external APIs).

The set is intentionally small (3 scenarios) — these are smoke evaluations,
not a full benchmark. Add a scenario whenever a regression bites in the wild.
"""
from __future__ import annotations
import math
from dataclasses import dataclass, field
from typing import Callable

# Approximate city centers — used to assert the Logistician put POIs near the
# user's actual destination, not in some other city. Tolerances are generous
# (200 km) to allow for nearby suburbs / airports.
CITY_CENTERS = {
    "Paris": (48.8566, 2.3522),
    "Tokyo": (35.6762, 139.6503),
    "Lisbon": (38.7223, -9.1393),
}


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1 = math.radians(a[0]), math.radians(a[1])
    lat2, lon2 = math.radians(b[0]), math.radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


@dataclass
class EvalCheck:
    name: str
    passed: bool
    detail: str = ""

    def __bool__(self) -> bool:  # pragma: no cover (rarely used)
        return self.passed


@dataclass
class Scenario:
    id: str
    prompt: str
    expected_destination: str
    expected_origin: str
    expected_min_blocks: int
    expected_budget_usd: float
    geo_tolerance_km: float = 200.0
    expected_must_include: list[str] = field(default_factory=list)


SCENARIOS: list[Scenario] = [
    Scenario(
        id="paris-3day-jfk",
        prompt=("Plan a relaxed 3-day trip from JFK to Paris, $2500 budget, "
                "we love museums, art, and local food."),
        expected_destination="Paris",
        expected_origin="JFK",
        expected_min_blocks=3,
        expected_budget_usd=2500,
        expected_must_include=["food", "art"],
    ),
    Scenario(
        id="tokyo-4day-sfo",
        prompt=("Plan an intense 4-day trip from SFO to Tokyo with $1800 "
                "budget, must include local food and historic sites."),
        expected_destination="Tokyo",
        expected_origin="SFO",
        expected_min_blocks=3,
        expected_budget_usd=1800,
        expected_must_include=["food", "historic"],
    ),
    Scenario(
        id="lisbon-2day-lhr",
        prompt=("Plan a relaxed 2-day Lisbon trip from LHR with $1200 budget, "
                "must include food and historic spots."),
        expected_destination="Lisbon",
        expected_origin="LHR",
        expected_min_blocks=3,
        expected_budget_usd=1200,
        expected_must_include=["food", "historic"],
    ),
]


def evaluate(scenario: Scenario, state: dict) -> list[EvalCheck]:
    itin = state.get("itinerary_manifest", {}) or {}
    constraints = (state.get("group_profile", {}) or {}).get("compiled_constraints", {}) or {}
    blocks = itin.get("calendar_blocks") or []
    checks: list[EvalCheck] = []

    dest = (itin.get("destination") or "").lower()
    checks.append(EvalCheck(
        name="destination",
        passed=scenario.expected_destination.lower() in dest,
        detail=f"got={itin.get('destination')!r}",
    ))

    origin = (itin.get("origin") or "").lower()
    checks.append(EvalCheck(
        name="origin",
        passed=scenario.expected_origin.lower() in origin,
        detail=f"got={itin.get('origin')!r}",
    ))

    checks.append(EvalCheck(
        name="block_count",
        passed=len(blocks) >= scenario.expected_min_blocks,
        detail=f"got={len(blocks)} expected>={scenario.expected_min_blocks}",
    ))

    budget = float(constraints.get("budget_ceiling_usd", 0))
    checks.append(EvalCheck(
        name="budget",
        passed=abs(budget - scenario.expected_budget_usd) < 100,
        detail=f"got=${budget:.0f} expected=${scenario.expected_budget_usd:.0f}",
    ))

    if scenario.expected_must_include:
        got = constraints.get("must_include_tags") or []
        missing = [t for t in scenario.expected_must_include if t not in got]
        checks.append(EvalCheck(
            name="must_include",
            passed=not missing,
            detail=f"got={got!r} missing={missing!r}",
        ))

    center = CITY_CENTERS.get(scenario.expected_destination)
    if center is not None and blocks:
        far = []
        for b in blocks:
            coords = b.get("coordinates") or []
            if len(coords) < 2:
                continue
            d = haversine_km(center, (float(coords[0]), float(coords[1])))
            if d > scenario.geo_tolerance_km:
                far.append((b.get("activity_name", "?"), round(d)))
        checks.append(EvalCheck(
            name="geo_proximity",
            passed=not far,
            detail=("all blocks within tol" if not far
                    else f"far blocks (>{scenario.geo_tolerance_km}km): {far}"),
        ))
    return checks


def summarize(scenario: Scenario, checks: list[EvalCheck]) -> str:
    """Compact one-liner per scenario for log output."""
    n = sum(1 for c in checks if c.passed)
    glyph = "PASS" if n == len(checks) else "FAIL"
    body = " ".join(f"{c.name}={'ok' if c.passed else 'fail'}" for c in checks)
    return f"[{glyph}] {scenario.id}  {n}/{len(checks)}  {body}"


def all_passed(checks: list[EvalCheck]) -> bool:
    return all(c.passed for c in checks)


# Scenarios act on `run_turn` from `orchestrator`. We keep the import lazy so
# importing this module from `evals.run` doesn't need the orchestrator's heavy
# OpenAI deps at module load.
def runner_factory() -> Callable[[str, str], dict]:
    from orchestrator import reset, run_turn

    def _run(session_id: str, prompt: str) -> dict:
        reset(session_id)
        return run_turn(session_id, prompt)

    return _run
