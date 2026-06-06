# SyncTrip: Multi-Agent Travel Orchestration Engine

## 1. Project Goals & Vision

Standard travel planners are static text wrappers. **SyncTrip** is a dynamic, consumer-centric travel dashboard that acts as a group mediator, logistics broker, and real-time trip fixer.

Our goals for this hackathon build are:

- **Eliminate Friction:** Use AI to negotiate conflicting group preferences mathematically.
- **Bridge AI with UI:** Move beyond text chatbots by using CopilotKit to render functional booking forms and interactive maps directly in the UI.
- **Real-Time Adaptability:** Prove that a multi-agent swarm can monitor live weather/infrastructure APIs and autonomously reroute a trip without human panic.
- **Enterprise State Persistence:** Implement a professional Hot/Cold database pipeline so users can collaborate live without lag, and securely save trips to their accounts permanently.

---

## 2. The Tech Stack

We are optimizing for extreme speed during active sessions, reliable long-term storage, and deep React integration.

- **Frontend:** Next.js (App Router), Tailwind CSS, Shadcn UI.
- **UI/AI Bridge:** CopilotKit (Handles the chat interface, state synchronization, and component injection).
- **Backend Framework:** Python FastAPI (Handles fast API execution and WebSocket/SSE streaming).
- **Orchestration:** LangGraph (Using `langgraph-checkpoint-redis` for active threads).
- **Data Storage (The Hot/Cold Pipeline):** \* **HOT DB (Redis):** Acts as the high-speed checkpointer for LangGraph. As agents debate and write state updates every millisecond, Redis prevents I/O bottlenecks and streams changes instantly to the UI.
  - **COLD DB (PostgreSQL via Supabase):** Acts as the long-term relational database. When a trip is finalized, the JSON payload is moved from Redis to a permanent `trips` table in Postgres, linked to the user's Auth ID.
- **External Data APIs (The Knowledge Layer):**
  - _Flights & Transit:_ Amadeus Travel API and AeroDataBox.
  - _Mapping & Pathing:_ Mapbox GL JS & Mapbox Directions API.
  - _Attractions & POIs:_ Geoapify Places API.
  - _Environment:_ OpenWeatherMap API.

---

## 3. System Architecture (The Data Flow)

The application decouples active AI reasoning from permanent data storage to maintain a fluid user experience.

1. **User Input:** User sends a prompt via the CopilotKit chat in Next.js.
2. **Hot Processing:** FastAPI receives the prompt. LangGraph pulls the active thread from **Redis**, evaluates the missing constraints, and routes the task to a specific agent.
3. **Tool Execution:** The agent calls external travel APIs (Amadeus, Geoapify).
4. **Hot State Mutation:** The agent overwrites the updated `TripState` in **Redis**.
5. **UI Injection:** FastAPI streams the updated state back via CopilotKit. The Next.js dashboard instantly updates the Mapbox UI and renders native React booking components.
6. **Cold Storage Sync (Action Trigger):** When the user clicks "Save Trip" or the trip starts, a background FastAPI task pulls the final JSON from Redis and commits it to **Supabase (PostgreSQL)** for permanent storage.

---

## 4. Shared State Schema (`TripState`)

This JSON object is the absolute contract between the frontend, the backend, and the databases.

```json
{
  "session_id": "uuid-1234",
  "user_auth_id": "user-5678",
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

#5. The Agent Cast (The Swarm)

The backend logic is divided into specialized roles to prevent LLM context pollution.

- The Supervisor Agent: The deterministic traffic controller. It checks the Redis TripState and routes execution to the next worker based on missing data.

- The Consensual Diplomat: The peer planner. Takes chaotic chat inputs from multiple users, negotiates conflicting budgets/interests, and locks in a unified group_profile.

- The Multi-Modal Logistician: The booking agent. Takes the compiled constraints, hits Amadeus for flights and Geoapify for local routes. It triggers CopilotKit to render flight checkout forms.

- The Weather & Event Sentinel: The background monitor. Queries OpenWeatherMap and AeroDataBox against the active itinerary. If it detects rain during an OUTDOOR block or a flight delay, it flags the Redis state.

- The Adaptive Reshuffler: The live fixer. Triggered by the Sentinel. It queries Amadeus Tours & Activities for nearby INDOOR alternatives, rewrites the calendar block in Redis, and pushes a UI notification to the user.
```
