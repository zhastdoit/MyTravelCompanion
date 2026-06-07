# SyncTrip — The Agent Cast

Five specialized AI agents plan, book, and adapt a trip together. One lead routes;
four specialists do the work. They coordinate through a shared `TripState` and hand control
to each other — never stepping on each other's job.

> Internal routing keys (used by `transfer_to_*`) are in parentheses; the display names below
> are what users see. Avatars live in `frontend/travel/public/agents/`.

---

### 🧭 Chief Chrono — *Advisor Lead* (`supervisor`)
The lead. Does no work itself; reads the current trip state, figures out what's missing, and
routes the request to the right specialist. Every request enters here.
- **Avatar:** indigo robot, headset, glowing baton, radar.
- **Model:** `gpt-4o-mini` (fast) · **Tools:** routing only (`transfer_to_*`)

### 🤝 Mingle Max — *Group Mediator* (`diplomat`)
The group peace-keeper. Takes messy, conflicting inputs from multiple travelers and negotiates
them into one agreed set of constraints (budget fights default to the lower ceiling).
- **Avatar:** green robot, open hands, balance scale.
- **Model:** `gpt-4o` (smart) · **Tools:** `update_constraints` · **Writes:** budget, pace, tags, route

### 🧰 Route Rudy — *Itinerary Builder* (`logistician`)
The data hustler. Turns agreed constraints into a real plan — pulling **live flights** and
attractions, filling the day-by-day itinerary, and surfacing a booking form.
- **Avatar:** blue robot, world map + plane ticket + tool belt.
- **Model:** `gpt-4o` (smart) · **Tools:** `query_amadeus` (SerpApi), `query_geoapify` · **Writes:** itinerary, flight options

### 🌦️ Radar Rusty — *Conditions Monitor* (`sentinel`)
The lookout. Checks live weather against outdoor plans and raises the alarm the moment
something threatens the trip.
- **Avatar:** orange robot, binoculars, rain cloud.
- **Model:** `gpt-4o-mini` (fast) · **Tools:** `check_weather` · **Reads:** outdoor itinerary blocks

### 🔀 Patchy Pivot — *Recovery Planner* (`reshuffler`)
The save-the-day specialist. When weather (or any disruption) breaks the plan, it swaps the
compromised activity for a nearby indoor alternative and notifies the traveler.
- **Avatar:** purple robot, glowing cards + shuffle arrows.
- **Model:** `gpt-4o` (smart) · **Tools:** `reshuffle_block` · **Writes:** updated blocks + notifications

---

**One-liner each:** Chief Chrono = *who speaks next* · Mingle Max = *settles the group* ·
Route Rudy = *builds the plan* · Radar Rusty = *watches for trouble* · Patchy Pivot = *fixes the plan*.

The roster (with avatars + descriptions) is served at `GET /api/agents`, and every `chat[]`
message carries `name`, `role`, `emoji`, `avatar`, `desc` for hover tooltips.
