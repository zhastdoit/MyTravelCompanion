# SyncTrip: Multi-Agent Travel Orchestration Engine

## 1. Project Goals & Vision

Standard travel planners are static text wrappers. **SyncTrip** is a dynamic, consumer-centric travel dashboard that acts as a group mediator, logistics broker, and real-time trip fixer.

Our goals for this build are:

- **Eliminate Friction:** Use AI to negotiate conflicting group preferences mathematically.
- **Bridge AI with UI:** Move beyond text chatbots by using CopilotKit to render functional booking forms and interactive maps directly in the UI.
- **Real-Time Adaptability:** Prove that a multi-agent swarm can monitor live weather/infrastructure APIs and autonomously reroute a trip without human panic.
- **Live Multiplayer State:** Support shared session links so multiple friends can watch the itinerary build live simultaneously.

---

## 2. The Tech Stack

- **Frontend:** Next.js v16.2 (App Router), Tailwind CSS, Shadcn UI.
- **UI/AI Bridge:** CopilotKit v0.1.94 (Handles the chat interface, state synchronization, and component injection).
- **Backend Framework:** Python FastAPI v0.136.1 (Handles fast API execution and WebSocket/SSE streaming).
- **Orchestration:** LangGraph (Perfect for multi-agent loops and tool calling).
- **Data Storage / State Management:** **Redis**.
  - _Why Redis?_ We need lightning-fast reads and writes for live map updates. By using LangGraph's `RedisSaver` (or standard Redis hash sets), the agents can asynchronously update the `TripState` in the background. It provides instant session persistence, allows pub/sub event broadcasting to the UI, and prevents data loss if the browser refreshes.

- **External Data APIs (The Knowledge Layer):**
  - _Flights & Transit:_ **Amadeus Travel API** (core flight/rail booking) and **AeroDataBox** (real-time flight tracking, delay indexes, and aviation data).
  - _Mapping & Pathing:_ **Mapbox GL JS / Directions API** (drawing visual vector paths on the dashboard).
  - _Attractions & POIs:_ **Geoapify Places API** (for powerful "distance-reachable" points of interest) and **Amadeus Tours & Activities API** (fetching real-world museum/sightseeing availability).
  - _Accommodations:_ **Booking.com API** or **Expedia Rapid API**.
  - _Environment:_ **OpenWeatherMap API** (triggering weather disruptions).

---

## 3. System Architecture

The application runs on a centralized Redis state mutation pattern. The frontend displays the state, CopilotKit acts as the courier, and the Python backend acts as the brain.

1. **User Input:** User types a message or clicks a UI button in Next.js.
2. **State Transfer:** CopilotKit packages the prompt and sends it to the FastAPI backend along with the user's `session_id`.
3. **Agent Swarm:** The LangGraph Supervisor pulls the current `TripState` from **Redis** using the `session_id`, evaluates the missing parameters, and routes execution to the correct worker agent (e.g., Diplomat, Logistician).
4. **Tool Execution:** The agent calls external travel APIs (Amadeus, Geoapify, etc.).
5. **State Mutation:** The agent overwrites the updated `TripState` JSON block back into **Redis**.
6. **UI Injection:** FastAPI streams the updated state back via CopilotKit. The Next.js dashboard instantly updates the Mapbox UI, Calendar UI, and renders native React components (like a booking form) inside the chat.

---

## 4. Shared State Schema (`TripState`)

This JSON object is the absolute contract between the frontend, the backend, and Redis. All agents read from and write to this exact structure.

```json
{
  "session_id": "uuid-1234",
  "group_profile": {
    "compiled_constraints": {
      "budget_ceiling_usd": 0,
      "pacing": "RELAXED | INTENSE",
      "must_include_tags": [],
      "avoid_tags": []
    }
  },
  "itinerary_manifest": {
    "origin": "",
    "destination": "",
    "calendar_blocks": [
      {
        "id": "block_id_string",
        "timestamp_start": "ISO_STRING",
        "activity_name": "Louvre Museum",
        "type": "OUTDOOR | INDOOR | TRANSIT",
        "coordinates": [48.8606, 2.3376]
      }
    ]
  },
  "copilot_ui_hooks": {
    "active_form_component": "NONE | GROUP_AGREEMENT | FLIGHT_PICKER",
    "system_notifications": []
  }
}
```

5. The Agent Cast (The Swarm)

The backend logic is divided into specialized roles to prevent LLM context pollution.

- The Supervisor Agent: The deterministic traffic controller. It checks the Redis TripState and routes execution to the next worker based on missing data.

- The Consensual Diplomat: The peer planner. Takes chaotic chat inputs from multiple users, negotiates conflicting budgets/interests, and locks in a unified group_profile.

- The Multi-Modal Logistician: The booking agent. Takes the compiled constraints, hits Amadeus for flights and Geoapify for local routes. It triggers CopilotKit to render flight checkout forms.

- The Weather & Event Sentinel: The background monitor. Queries OpenWeatherMap and AeroDataBox against the active itinerary. If it detects rain during an OUTDOOR block or a flight delay, it flags the Redis state.

- The Adaptive Reshuffler: The live fixer. Triggered by the Sentinel. It queries Amadeus Tours & Activities for nearby INDOOR alternatives, rewrites the calendar block in Redis, and pushes a UI notification to the user.
