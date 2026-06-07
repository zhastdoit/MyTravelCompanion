# SyncTrip — The Agent Cast

Five specialised AI agents plan, book, and adapt a trip together. One lead routes;
four specialists do the work. They coordinate through a shared `TripState` and hand
control to each other — never stepping on each other's job.

> Internal routing keys (used by `transfer_to_*`) are in parentheses; the display names
> below are what users see. Avatars live in `frontend/travel/public/agents/`.
> Definitions live in `backend/agents.py`; tool schemas in `backend/tools.py`.

---

### Chief Chrono — *Advisor Lead* (`supervisor`)
The lead. Does no work itself; reads the current trip state, figures out what's missing,
and routes the request to the right specialist. Every request enters here unless the user
`@`-mentioned a specialist.
- **Avatar:** indigo robot, headset, glowing baton, radar.
- **Model:** `gpt-4o-mini` (fast)
- **Tools:** routing only (`transfer_to_diplomat`, `transfer_to_logistician`,
  `transfer_to_sentinel`, `transfer_to_reshuffler`)
- **Reads:** entire `TripState`. **Writes:** nothing.

### Mingle Max — *Group Mediator* (`diplomat`)
The group peace-keeper. Takes messy, conflicting inputs from multiple travellers and
negotiates them into one agreed set of constraints (budget fights default to the lower
ceiling). Captures user-named landmarks into `must_include_places` so the Logistician
can't drop them later.
- **Avatar:** green robot, open hands, balance scale.
- **Model:** `gpt-4o` (smart)
- **Tools:** `update_constraints`, **`web_search_preview`** (built-in, used at most
  once/turn for feasibility spot-checks like *"average daily cost in Lisbon 2026"*).
- **Writes:** `compiled_constraints.{budget_ceiling_usd, pacing, must_include_tags,
  avoid_tags, must_include_places, duration_days, start_date}`,
  `itinerary_manifest.{origin, destination}`.

### Route Rudy — *Itinerary Builder* (`logistician`)
The data hustler. Composes a complete day-by-day itinerary — pulling **live flights** and
attractions, filling 5–9 blocks per day across 7 time slots (breakfast / morning / lunch /
afternoon / coffee / dinner / evening), enforcing geographic spread and must-include
places, and surfacing a booking form. Hands back to the Supervisor with a summary of the
spread.
- **Avatar:** blue robot, world map + plane ticket + tool belt.
- **Model:** `gpt-4o` (smart)
- **Tools:**
  - **`add_activity_block`** — hand-curated composer; called many times per turn (≈ 5×
    `duration_days` for RELAXED, 7× for INTENSE). Args: `name`, `day_index`, `time_slot`,
    `type`, `neighborhood`, `duration_minutes`, `category`. Each call geocodes via
    Geoapify (neighborhood-biased) and falls back through a curated neighborhood map +
    per-day anchor walk if Geoapify can't ground the place.
  - `query_amadeus` — SerpApi / Google Flights (called once if no `TRANSIT` block exists).
  - `query_geoapify` — bulk fallback (5-block days across multiple anchors); used only if
    the LLM can't compose hand-curated.
  - **`web_search_preview`** — once per turn for unfamiliar destinations; used to identify
    real neighborhood names + signature places before composing.
- **Writes:** `itinerary_manifest.calendar_blocks`, `itinerary_manifest.flight_options`,
  `copilot_ui_hooks.{active_form_component, form_payload}` (`FLIGHT_PICKER`).

### Radar Rusty — *Conditions Monitor* (`sentinel`)
The lookout. Checks live weather against outdoor plans and raises the alarm the moment
something threatens the trip.
- **Avatar:** orange robot, binoculars, rain cloud.
- **Model:** `gpt-4o-mini` (fast)
- **Tools:** `check_weather` (OpenWeather 5-day forecast against the first OUTDOOR block).
- **Reads:** outdoor `calendar_blocks`. Routes to Reshuffler on rain / thunderstorm / snow.

### Patchy Pivot — *Recovery Planner* (`reshuffler`)
The save-the-day specialist. When weather (or any disruption) breaks the plan, it swaps
the compromised activity for a nearby indoor alternative and notifies the traveller.
- **Avatar:** purple robot, glowing cards + shuffle arrows.
- **Model:** `gpt-4o` (smart)
- **Tools:** `reshuffle_block`.
- **Writes:** updated block (OUTDOOR → INDOOR, new coords/name) +
  `copilot_ui_hooks.system_notifications`.

---

**One-liner each:**

- Chief Chrono = *who speaks next*
- Mingle Max = *settles the group + locks in must-haves*
- Route Rudy = *builds a comprehensive, spread-out, named-place itinerary*
- Radar Rusty = *watches for trouble*
- Patchy Pivot = *fixes the plan*

The roster (with avatars + descriptions) is served at `GET /api/agents`, and every
`chat[]` message carries `name`, `role`, `emoji`, `avatar`, `desc` for hover tooltips.

## How handoffs flow

```
user "Plan a 3-day Paris trip from JFK, $4k, museums + food, include the Louvre"
 │
 ▼
Supervisor ─transfer_to_diplomat→ Diplomat
                                    │ web_search? (optional)
                                    │ update_constraints(
                                    │   destination="Paris", duration_days=3,
                                    │   must_include_tags=["museums","food"],
                                    │   must_include_places=["Louvre"], …)
                                    ▼
Supervisor ─transfer_to_logistician→ Logistician
                                       │ web_search? (optional, neighborhoods)
                                       │ query_amadeus(JFK→CDG)
                                       │ add_activity_block × N (5–9 / day, all 3 days,
                                       │   Louvre on day with anchor=Louvre/Le Marais)
                                       ▼
Supervisor (turn ends; FLIGHT_PICKER form rendered, map updates, day filter enabled)
```

Subsequent turn: *"Will the weather hurt us?"* enters at Supervisor → Sentinel
(`check_weather`) → if rain on an OUTDOOR block, hands to Reshuffler
(`reshuffle_block`) → notification toast.
