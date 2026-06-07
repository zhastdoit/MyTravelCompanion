"use client";

import { useCallback, useMemo, useRef } from "react";
import { Share2 } from "lucide-react";
import { useCopilotChat } from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import {
  AgentSpeakerProvider,
  useAgentSpeaker,
} from "./chat/agent-speaker-context";
import { AgentAssistantMessage } from "./chat/agent-assistant-message";
import { ACTIVE_FORM_COMPONENT, type TripState } from "@/types/trip";
import { AGENT_STATUSES } from "@/types/agent";
import {
  AGENT_IDS,
  INITIAL_AGENT_STATUS,
  type AgentId,
  type AgentStatusMap,
} from "@/lib/agents";
import { MOCK_TRIP } from "@/lib/mock-trip";
import { usePersistedTrip } from "@/lib/use-persisted-trip";
import { toFrontendTripState } from "@/lib/trip-bridge";
import { useTripBackendState } from "@/lib/use-trip-backend-state";
import { Header } from "./header";
import { AgentCrew } from "./agent-crew";
import { TripMap } from "./trip-map";
import { ItineraryTimeline } from "./itinerary-timeline";
import { MembersStrip } from "./members-strip";
import { ShareDialog, type ShareDialogHandle } from "./share-dialog";
import { NotificationToaster } from "./notification-toaster";
import { OnboardingCard } from "./onboarding-card";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { FlightCheckoutCard } from "./generative/flight-checkout-card";
import { GroupAgreementForm } from "./generative/group-agreement-form";

interface DashboardProps {
  /** Stable session id, mirrored as the FastAPI `session_id` and CopilotKit `threadId`. */
  sessionId?: string;
}

export const Dashboard = ({ sessionId }: DashboardProps = {}) => (
  <AgentSpeakerProvider>
    <DashboardContent sessionId={sessionId} />
  </AgentSpeakerProvider>
);

const FORM_COMPONENT_TO_AGENT: Partial<Record<TripState["copilot_ui_hooks"]["active_form_component"], AgentId>> = {
  [ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT]: AGENT_IDS.DIPLOMAT,
  [ACTIVE_FORM_COMPONENT.FLIGHT_PICKER]: AGENT_IDS.LOGISTICIAN,
};

const DashboardContent = ({ sessionId }: DashboardProps) => {
  const persistKey = sessionId ?? "demo";
  const [tripState, setTripState] = usePersistedTrip(persistKey);
  const { appendMessage } = useCopilotChat();
  const { setCurrentAgent } = useAgentSpeaker();

  const handleBackendState = useCallback(
    (next: Parameters<typeof toFrontendTripState>[0]) => {
      setTripState((prev) => toFrontendTripState(next, prev));
    },
    [setTripState],
  );

  const { lastError } = useTripBackendState({
    sessionId,
    onState: handleBackendState,
  });

  const activeForm = tripState.copilot_ui_hooks.active_form_component;
  const inferredAgent = FORM_COMPONENT_TO_AGENT[activeForm] ?? null;

  const agentStatus = useMemo<AgentStatusMap>(() => {
    if (!inferredAgent) return INITIAL_AGENT_STATUS;
    return { ...INITIAL_AGENT_STATUS, [inferredAgent]: AGENT_STATUSES.ACTIVE };
  }, [inferredAgent]);

  // setCurrentAgent writes to a ref, not state, so this is safe in render.
  setCurrentAgent(inferredAgent);

  const dismissActiveForm = useCallback(() => {
    setTripState((prev) => ({
      ...prev,
      copilot_ui_hooks: {
        ...prev.copilot_ui_hooks,
        active_form_component: ACTIVE_FORM_COMPONENT.NONE,
      },
    }));
  }, [setTripState]);

  const { itinerary_manifest, group_profile, group_members } = tripState;
  const shareDialogRef = useRef<ShareDialogHandle | null>(null);
  const openShare = useCallback(() => {
    shareDialogRef.current?.open();
  }, []);

  const flightStub = useMemo(
    () => deriveFlightStub(itinerary_manifest.origin, itinerary_manifest.destination),
    [itinerary_manifest.origin, itinerary_manifest.destination],
  );

  const isEmpty = itinerary_manifest.origin === "";

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        itinerary={itinerary_manifest}
        groupProfile={group_profile}
        rightSlot={
          <>
            <MembersStrip members={group_members} />
            {sessionId ? (
              <button
                type="button"
                onClick={openShare}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-semibold transition hover:border-primary/60 hover:text-primary"
              >
                <Share2 className="size-3.5" aria-hidden />
                Share
              </button>
            ) : null}
          </>
        }
      />
      <AgentCrew status={agentStatus} />

      <main className="flex flex-1 flex-col gap-4 px-5 py-4 lg:gap-5">
        {isEmpty ? (
          <OnboardingCard
            onPrompt={(prompt) =>
              void appendMessage(
                new TextMessage({ role: Role.User, content: prompt }),
              )
            }
          />
        ) : (
          <div className="flex flex-1 flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-5">
            <section className="min-h-[420px] lg:min-h-0">
              <TripMap blocks={itinerary_manifest.calendar_blocks} className="h-full" />
            </section>

            <aside className="flex min-w-0 flex-col gap-4">
              {activeForm === ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT ? (
                <GroupAgreementForm
                  proposedBudgetUsd={group_profile.compiled_constraints.budget_ceiling_usd}
                  proposedPacing={group_profile.compiled_constraints.pacing}
                  proposedMustIncludeTags={group_profile.compiled_constraints.must_include_tags}
                  proposedAvoidTags={group_profile.compiled_constraints.avoid_tags}
                  rationale="Diplomat compiled these constraints from the group's last exchange. Approve to lock them in."
                  status="executing"
                  onRespond={dismissActiveForm}
                />
              ) : null}

              {activeForm === ACTIVE_FORM_COMPONENT.FLIGHT_PICKER ? (
                <FlightCheckoutCard
                  airline={flightStub.airline}
                  flightNumber={flightStub.flightNumber}
                  origin={flightStub.origin}
                  destination={flightStub.destination}
                  departure={flightStub.departure}
                  arrival={flightStub.arrival}
                  durationMinutes={flightStub.durationMinutes}
                  priceUsd={flightStub.priceUsd}
                  status="complete"
                />
              ) : null}

              <div className="rounded-md border border-border bg-surface p-3">
                <div className="mb-2.5 flex items-baseline justify-between border-b border-border pb-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Itinerary
                  </h2>
                  <span className="font-mono text-[11px] text-muted tabular-nums">
                    {itinerary_manifest.calendar_blocks.length} blocks
                  </span>
                </div>
                <ItineraryTimeline blocks={itinerary_manifest.calendar_blocks} />
              </div>
            </aside>
          </div>
        )}
      </main>

      <CopilotSidebar
        defaultOpen
        clickOutsideToClose={false}
        labels={{
          title: "SyncTrip Crew",
          initial:
            "Hey! I'm your travel crew. Ask: 'Plan a relaxed 3-day trip from JFK to Paris under $1500.'",
        }}
        AssistantMessage={AgentAssistantMessage}
      />

      {sessionId ? (
        <ShareDialog ref={shareDialogRef} sessionId={sessionId} />
      ) : null}

      <NotificationToaster
        notifications={tripState.copilot_ui_hooks.system_notifications}
      />

      {lastError ? (
        <div
          role="status"
          className="pointer-events-none fixed bottom-4 left-4 max-w-sm rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 shadow-sm"
        >
          Backend sync error: {lastError}
        </div>
      ) : null}

      <KeyboardShortcuts
        bindings={[
          {
            keys: "c",
            description: "Focus the chat input",
            action: () => {
              const input = document.querySelector<HTMLTextAreaElement>(
                ".copilotKitInput textarea",
              );
              input?.focus();
            },
          },
          {
            keys: "s",
            description: "Open share dialog",
            action: openShare,
          },
          {
            keys: "g i",
            description: "Copy session id",
            action: () => {
              if (sessionId) {
                void navigator.clipboard?.writeText(sessionId);
              }
            },
          },
        ]}
      />
    </div>
  );
};

interface FlightStub {
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  durationMinutes: number;
  priceUsd: number;
}

const FALLBACK_FLIGHT: FlightStub = {
  airline: "TBD Airlines",
  flightNumber: "—",
  origin: MOCK_TRIP.itinerary_manifest.origin,
  destination: MOCK_TRIP.itinerary_manifest.destination,
  departure: "",
  arrival: "",
  durationMinutes: 0,
  priceUsd: 0,
};

/**
 * Baseline placeholder values for the flight card. Real flight data lives in
 * the backend's `tools.search_flights` output and isn't yet plumbed into
 * `TripState`; once it is, this helper goes away.
 */
const deriveFlightStub = (origin: string, destination: string): FlightStub =>
  origin && destination
    ? { ...FALLBACK_FLIGHT, origin, destination }
    : FALLBACK_FLIGHT;
