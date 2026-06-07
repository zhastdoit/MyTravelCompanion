<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

1. The Frontend Mission

In a standard app, users click buttons to mutate database states. In SyncTrip, the user chats with the AI, the AI mutates the state, and the React frontend instantly reacts to those changes.

Your mission as the frontend engineer is to:

    Build a beautiful, reactive dashboard (Mapbox + Calendar).

    Give the AI "eyes" to read the dashboard using useCopilotReadable.

    Give the AI "hands" to click buttons, update state, and render custom components using useCopilotAction.

2. The Golden Contract (React Local State)

You do not need to wait for the backend database to be ready. You will store the entire application state in a single React useState hook at the top level of your dashboard.

Create this dummy initial state to build your UI against:
TypeScript

// types/trip.ts
export interface TripState {
session_id: string;
group_profile: {
compiled_constraints: {
budget_ceiling_usd: number;
pacing: "RELAXED" | "INTENSE";
must_include_tags: string[];
};
};
itinerary_manifest: {
origin: string;
destination: string;
calendar_blocks: Array<{
id: string;
timestamp_start: string;
activity_name: string;
type: "OUTDOOR" | "INDOOR" | "TRANSIT";
coordinates: [number, number]; // [Longitude, Latitude] for Mapbox
}>;
};
}

// In your Dashboard.tsx
const [tripState, setTripState] = useState<TripState>(mockTripData);

Pass tripState.itinerary_manifest as props to your Mapbox and Calendar components so they re-render whenever the data changes. 3. Giving the AI "Eyes": useCopilotReadable

The AI agents running on the backend have no idea what the user is looking at unless you explicitly tell them. By passing your React state into useCopilotReadable, CopilotKit silently syncs it to the backend on every chat prompt.

If a user types "Change the first activity to something cheaper," the AI automatically knows what the "first activity" is.

Implementation:
TypeScript

import { useCopilotReadable } from "@copilotkit/react-core";

// Place this inside your main Dashboard component
useCopilotReadable({
description: "The current state of the travel itinerary, including the active calendar blocks and group budget constraints.",
value: tripState,
});

4. Giving the AI "Hands": useCopilotAction

This is how the backend agents manipulate the frontend. You define actions (functions) that the AI is allowed to execute. When the OpenAI agent triggers a tool on the backend, CopilotKit fires the corresponding action in your React code.

You need to define actions for State Mutations and Component Injection.
Action A: Mutating the Dashboard (State Updates)

When the "Reshuffler Agent" swaps a rained-out outdoor event for an indoor museum, it needs a way to update your React state so the map redraws.
TypeScript

import { useCopilotAction } from "@copilotkit/react-core";

useCopilotAction({
name: "updateItineraryBlock",
description: "Updates a specific calendar block in the UI, usually due to weather or user preference changes.",
parameters: [
{ name: "blockId", type: "string", description: "The ID of the block to replace", required: true },
{ name: "newActivityName", type: "string", required: true },
{ name: "newType", type: "string", required: true }, // "INDOOR" | "OUTDOOR"
{ name: "newCoordinates", type: "number[]", description: "[lng, lat]", required: true }
],
handler: async ({ blockId, newActivityName, newType, newCoordinates }) => {
// This executes locally in React when the AI fires the tool
setTripState((prev) => {
const updatedBlocks = prev.itinerary_manifest.calendar_blocks.map(block =>
block.id === blockId
? { ...block, activity_name: newActivityName, type: newType, coordinates: newCoordinates }
: block
);
return { ...prev, itinerary_manifest: { ...prev.itinerary_manifest, calendar_blocks: updatedBlocks } };
});
},
});

Action B: Generative UI (Rendering Components in Chat)

If the AI finds a flight, it shouldn't just paste text. It should drop a functional native React <CheckoutForm /> component directly into the chat sidebar.
TypeScript

useCopilotAction({
name: "renderFlightCheckout",
description: "Renders an interactive checkout form when the user is ready to book a flight.",
parameters: [
{ name: "airline", type: "string", required: true },
{ name: "price", type: "number", required: true },
{ name: "flightNumber", type: "string", required: true }
],
// Instead of a handler, we use 'render' to inject a component
render: ({ args }) => (
<div className="p-4 border rounded-lg bg-slate-900 text-white">
<h3 className="font-bold">{args.airline} - {args.flightNumber}</h3>
<p className="text-xl">${args.price}</p>
<button
className="mt-2 w-full bg-blue-600 hover:bg-blue-500 py-2 rounded"
onClick={() => alert(`Purchasing ${args.flightNumber} locally!`)} >
Confirm Booking
</button>
</div>
),
});

5. Mocking the API (How to test without the Backend)

Because CopilotKit expects a real backend endpoint (/api/copilotkit), testing your UI before Track 2 finishes the FastAPI server can be tricky.

The Hackathon Trick:
In your layout.tsx, wrap the app in the provider, but leave the runtimeUrl blank or point it to a simple local Next.js mock API route during development.
TypeScript

// app/layout.tsx
import { CopilotKit } from "@copilotkit/react-core";
import "@copilotkit/react-ui/styles.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="en">
<body>
<CopilotKit runtimeUrl="/api/copilotkit">
{children}
</CopilotKit>
</body>
</html>
);
}

To test your UI components visually without an AI triggering them, just temporarily render <CheckoutForm airline="MockAir" price={500} flightNumber="M123"/> directly in your Dashboard JSX until the UI is pixel-perfect. Once it looks good, move it inside the useCopilotAction render block.

<!-- END:nextjs-agent-rules -->
