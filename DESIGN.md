SyncTrip: Multi-Agent Travel Orchestration Engine

1. Project Goals & Vision

Standard travel planners are static text wrappers. SyncTrip is a dynamic, consumer-centric travel dashboard that acts as a group mediator, logistics broker, and real-time trip fixer.

Our goals for this hackathon build are:

    Eliminate Friction: Use AI to negotiate conflicting group preferences mathematically.

    Bridge AI with UI: Move beyond text chatbots by using CopilotKit to render functional booking forms and interactive maps directly in the UI.

    Real-Time Adaptability: Prove that a multi-agent system can monitor live weather/infrastructure APIs and autonomously reroute a trip without human panic.

    Enterprise State Persistence: Implement a professional Hot/Cold database pipeline so users can collaborate live without lag, and securely save trips to their accounts.

2. The Tech Stack

We are optimizing for extreme speed, production-grade observability, and a strict App/Agent server boundary using native LLM tool calling.

    Frontend: Next.js (App Router), Tailwind CSS, Shadcn UI.

    App Server (The Gateway): Next.js API Routes running CopilotRuntime. Handles secure frontend bridging.

    Agent Server (The Brain): Python FastAPI running copilotkit-python (CopilotKit's Agent SDK). This exposes the Python backend to the Next.js UI.

    Orchestration & Cognitive Engine: OpenAI Python SDK. We are skipping external orchestration frameworks and using OpenAI's native tool-calling and agent-handoff patterns. Agents are defined as system prompts with specific Python functions, and they pass the active context to one another dynamically.

    Observability & Evals: Weights & Biases (Weave). Wraps the FastAPI endpoints to trace token usage, agent latency, and tool-call success rates.

    Data Storage (Hot/Cold Pipeline): * HOT DB (Redis): Instant session state management.

        COLD DB (Supabase / PostgreSQL): Long-term trip saving and user auth.

    External Data APIs:

        Flights & Transit: Amadeus Travel API and AeroDataBox.

        Mapping & Pathing: Mapbox GL JS & Mapbox Directions API.

        Attractions & POIs: Geoapify Places API.

        Environment: OpenWeatherMap API.

3. System Architecture & Tracing Flow

This system enforces a strict boundary between the user interface, the secure routing gateway, and the agentic execution environment.

    User Input: User sends a prompt via the CopilotKit chat in Next.js.

    Gateway Pass: Next.js CopilotRuntime passes the request to the FastAPI Agent Server.

    Hot State Retrieval: FastAPI pulls the current TripState JSON from Redis.

    OpenAI Handoff Routing: The FastAPI server uses the OpenAI SDK. The Supervisor Agent evaluates the TripState and uses a tool call (e.g., transfer_to_diplomat()) to hand the thread over to the specialized agent.

    Tool Execution: The active OpenAI agent requests external travel data. FastAPI executes the Python wrappers for Amadeus or Geoapify and returns the data to the model.

    State Mutation: The agent outputs the new valid JSON, and FastAPI overwrites the TripState in Redis.

    UI Injection: FastAPI streams the updated state back via CopilotKit. The Next.js dashboard instantly updates the Mapbox UI and renders native React booking components.

    Cold Storage Sync: When the user clicks "Save Trip," a background task commits the Redis JSON to Supabase.

4. Shared State Schema (TripState)

This exact JSON structure is stored in Redis. All OpenAI agents are instructed via their system prompts to read from and write to this schema format exclusively.
JSON

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
"timestamp_start": "2026-06-10T09:00:00Z",
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

5. The Agent Cast (OpenAI SDK Definitions)

Instead of a complex graph, these are defined as standalone OpenAI Assistant personas equipped with specific tools.

    The Supervisor Agent: The lightweight router. Prompted to only evaluate missing data in the JSON and execute the transfer_to_x tool to call the right worker.

    The Consensual Diplomat: The peer planner. Powered by gpt-4o. Takes chaotic chat inputs from multiple users, negotiates conflicting budgets, and updates the compiled_constraints.

    The Multi-Modal Logistician: The data broker. Equipped with query_amadeus and query_geoapify tools. Takes the constraints, fetches live data, and triggers CopilotKit to render flight checkout forms.

    The Weather & Event Sentinel: The background monitor. Powered by gpt-4o-mini for speed. Periodically checks OpenWeatherMap against the calendar_blocks. If it detects rain during an OUTDOOR block, it transfers control to the Reshuffler.

    The Adaptive Reshuffler: The live fixer. Swaps compromised outdoor events for nearby INDOOR alternatives, rewrites the calendar block in Redis, and pushes a notification string to system_notifications.

6. Observability & Evaluation Strategy

We utilize Weights & Biases (Weave) to mathematically prove the reliability of our native OpenAI integration:

    Trace Logging: Every FastAPI function that calls the OpenAI SDK is decorated with @weave.op(). This creates a beautiful waterfall trace of every API call, tool execution, and handoff.

    Metrics Tracked:

        JSON Adherence: How often the OpenAI output perfectly matches our TripState schema without Pydantic validation errors.

        Routing Latency: Time taken for the Supervisor to successfully hand off to the Logistician.

        API Resiliency: Tracking how agents handle simulated 404 errors from the Amadeus sandbox.
