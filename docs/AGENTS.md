# SyncTrip — The Agent Cast

Five specialized AI agents plan, book, and adapt a trip together. One supervisor routes;
four specialists do the work. They coordinate through a shared `TripState` and hand control
to each other — never stepping on each other's job.

---

### 🧭 Supervisor — *the dispatcher*
The traffic controller. It does no work itself; it reads the current trip state, figures out
what's missing, and routes the request to the right specialist. Every request enters here.
- **Personality:** calm, decisive, economical with words.
- **Model:** `gpt-4o-mini` (fast) · **Tools:** routing only (`transfer_to_*`)

### 🤝 Consensual Diplomat — *the mediator*
The group peace-keeper. It takes messy, conflicting inputs from multiple travelers and
negotiates them into one agreed set of constraints (resolving budget fights by default to the
lower ceiling).
- **Personality:** warm, diplomatic, fair.
- **Model:** `gpt-4o` (smart) · **Tools:** `update_constraints` · **Writes:** budget, pace, tags, route

### 🧰 Multi-Modal Logistician — *the broker*
The data hustler. It turns the agreed constraints into a real plan — pulling flight options and
attractions and filling in the day-by-day itinerary, then surfacing a booking form to the user.
- **Personality:** efficient, resourceful, all business.
- **Model:** `gpt-4o` (smart) · **Tools:** `query_amadeus`, `query_geoapify` · **Writes:** itinerary blocks

### 🌦️ Weather & Event Sentinel — *the watchdog*
The lookout. It continuously checks live weather against outdoor plans and raises the alarm the
moment something threatens the trip.
- **Personality:** vigilant, alert, quick.
- **Model:** `gpt-4o-mini` (fast) · **Tools:** `check_weather` · **Reads:** outdoor itinerary blocks

### 🔀 Adaptive Reshuffler — *the fixer*
The save-the-day specialist. When weather (or any disruption) breaks the plan, it swaps the
compromised activity for a nearby indoor alternative and notifies the traveler — no panic.
- **Personality:** agile, calm-under-pressure, solution-first.
- **Model:** `gpt-4o` (smart) · **Tools:** `reshuffle_block` · **Writes:** updated blocks + notifications

---

**One-liner each:** Supervisor = *who speaks next* · Diplomat = *settles the group* ·
Logistician = *finds the data* · Sentinel = *watches for trouble* · Reshuffler = *fixes the plan*.
