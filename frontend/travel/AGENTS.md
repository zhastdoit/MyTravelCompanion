<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ
from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before
writing any code. Heed deprecation notices.

## 1. The frontend mission

In a standard app, users click buttons to mutate database states. In SyncTrip, the user
chats with the AI, the AI mutates the state on the **FastAPI agent server**, and the React
frontend re-fetches `TripState` and reactively re-renders.

Your mission as the frontend engineer is to:

- Build a beautiful, reactive dashboard (Mapbox + day-grouped timeline + day filter).
- Give the AI "eyes" — pass `TripState` into `useCopilotReadable` so backend agents always
  know what the user is looking at.
- Render generative UI (`GROUP_AGREEMENT`, `FLIGHT_PICKER`) inline beside the itinerary
  whenever `state.copilot_ui_hooks.active_form_component` is set.

## 2. The Golden Contract — `TripState` lives in React state, **synced from the backend**

Backend is the source of truth. `lib/use-trip-backend-state.ts` re-fetches
`/api/trip/{sid}/state` on mount and after every CopilotKit `isLoading` falling edge,
storing it in a single `useState<TripState>` at the dashboard root. The current schema
(see `types/trip.ts`) is:

```ts
// types/trip.ts
export interface TripState {
  session_id: string;
  user_auth_id?: string;

  group_profile: {
    compiled_constraints: {
      budget_ceiling_usd: number;
      pacing: "RELAXED" | "INTENSE";
      must_include_tags: string[];
      avoid_tags: string[];
      must_include_places: string[];   // user-named landmarks (e.g. ["Louvre"])
      duration_days: number;
      start_date: string;              // ISO YYYY-MM-DD
    };
  };

  group_members: GroupMember[];        // frontend-only

  itinerary_manifest: {
    origin: string;
    destination: string;
    calendar_blocks: Array<{
      id: string;
      timestamp_start: string;         // ISO 8601 UTC
      activity_name: string;
      type: "OUTDOOR" | "INDOOR" | "TRANSIT";
      coordinates: [number, number];   // [lng, lat] — Mapbox order (flipped at the bridge)
      duration_minutes: number;        // drives start–end time + ICS DTEND
      category: "" | "MEAL" | "SIGHT" | "ACTIVITY" | "REST"
              | "TRANSIT" | "NIGHTLIFE" | "SHOPPING";
    }>;
    flight_options: FlightOption[];
    selected_flight_id: string;
  };

  copilot_ui_hooks: {
    active_form_component: "NONE" | "GROUP_AGREEMENT" | "FLIGHT_PICKER";
    system_notifications: string[];
  };
}
```

Pass `tripState.itinerary_manifest` as props to `TripMap` and `ItineraryTimeline` so they
re-render whenever the data changes. Apply the day filter at the dashboard level and pass
the chosen `selectedDate` into both components — they preserve trip-wide day numbering
when isolated.

## 3. Giving the AI "eyes": `useCopilotReadable`

Backend agents have no idea what the user is looking at unless you explicitly tell them.
By passing your React state into `useCopilotReadable`, CopilotKit silently syncs it to
the backend on every chat prompt.

If a user types *"Change the first activity to something cheaper,"* the AI automatically
knows what the "first activity" is.

```tsx
import { useCopilotReadable } from "@copilotkit/react-core";

useCopilotReadable({
  description:
    "The current state of the travel itinerary, including active calendar blocks and group constraints.",
  value: tripState,
});
```

## 4. Generative UI driven by `copilot_ui_hooks`

The Logistician sets `state.copilot_ui_hooks.active_form_component = "FLIGHT_PICKER"`
(or the Diplomat sets `"GROUP_AGREEMENT"`) when a form is needed. The dashboard renders
the matching React card inline beside the timeline. `form_payload` carries the data — for
`FLIGHT_PICKER`, that's `{ title, options: [FlightOption…] }` where each option has a
`book_url`. When the user picks a flight, `POST /api/trip/{sid}/select` clears the form
and sets `selected_flight_id`.

```tsx
{activeForm === "FLIGHT_PICKER" ? (
  <FlightCheckoutCard {...flightStub} onConfirm={handleFlightCheckout} />
) : null}
```

`system_notifications` (e.g. weather reroute toasts) drive the `<NotificationToaster />`.

## 5. Mocking the backend for local UI work

CopilotKit expects a real backend at `/api/copilotkit`. To work on UI without the FastAPI
crew running, set `BACKEND_URL` to an unreachable host and rely on `lib/mock-trip.ts` —
the dashboard renders the mock fixture in unauthenticated demo mode. To preview generative
UI cards in isolation, render them directly in JSX with stub props until they're
pixel-perfect, then move them inside the conditional that watches `active_form_component`.

```tsx
// app/layout.tsx — runtimeUrl is local because we self-host CopilotRuntime
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CopilotKit runtimeUrl="/api/copilotkit">{children}</CopilotKit>
      </body>
    </html>
  );
}
```

## 6. Per-day routing & time math

`lib/use-trip-routes.ts` calls Mapbox Directions once per session, caches in
`sessionStorage`, and returns `{ routes: DayRoute[], geojson: FeatureCollection }`.
Walking under 1.5 km, driving otherwise. **It excludes TRANSIT blocks** so flight pins
don't draw routes from airports — keep that invariant if you refactor.

The timeline uses `block.duration_minutes` to compute the end time
(`new Date(start.getTime() + durationMin * 60_000)`) and renders `HH:mm–HH:mm` plus a
duration label ("2h", "1h 30m"). The same field flows into `lib/ics.ts` so calendar
exports have correct `DTEND`.

## 7. Auth + Google Calendar

`/login` does email/password + Google OAuth. The Google flow asks for the
`https://www.googleapis.com/auth/calendar.events` scope with `access_type=offline` so
Supabase keeps a `provider_token` for direct Calendar API pushes. `AddToCalendarButton`
falls back to ICS download (`lib/ics.ts`) when the token is missing or expired.

<!-- END:nextjs-agent-rules -->
