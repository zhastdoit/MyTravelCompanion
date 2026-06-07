"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen, Share2, X } from "lucide-react";
import { useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import {
  AgentSpeakerProvider,
  useAgentSpeaker,
} from "./chat/agent-speaker-context";
import { AgentAssistantMessage } from "./chat/agent-assistant-message";
import {
  ACTIVE_FORM_COMPONENT,
  type FlightOption,
  type TripState,
} from "@/types/trip";
import { AGENT_STATUSES } from "@/types/agent";
import {
  AGENT_IDS,
  INITIAL_AGENT_STATUS,
  type AgentId,
  type AgentStatusMap,
} from "@/lib/agents";
import { usePersistedTrip } from "@/lib/use-persisted-trip";
import { toFrontendTripState } from "@/lib/trip-bridge";
import { useTripBackendState } from "@/lib/use-trip-backend-state";
import { useTripTelemetry } from "@/lib/use-trip-telemetry";
import { Header } from "./header";
import { TelemetryStrip } from "./telemetry-strip";
import { AgentCrew } from "./agent-crew";
import { TripMap } from "./trip-map";
import { ItineraryTimeline } from "./itinerary-timeline";
import { MembersStrip } from "./members-strip";
import { ShareDialog, type ShareDialogHandle } from "./share-dialog";
import { NotificationToaster } from "./notification-toaster";
import { OnboardingCard } from "./onboarding-card";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { FlightPickerModal } from "./generative/flight-picker-modal";
import { FlightsSummaryCard } from "./generative/flights-summary-card";
import {
  GroupAgreementForm,
  type GroupAgreementResult,
} from "./generative/group-agreement-form";
import type { FlightCheckoutResult } from "./generative/flight-checkout-card";
import {
  encodeFlightCheckoutMessage,
  encodeGroupAgreementMessage,
} from "@/lib/form-message";
import { AuthMenu } from "./auth-menu";
import { SaveTripButton } from "./save-trip-button";
import { TripsMenu } from "./trips-menu";

interface DashboardProps {
  /** Stable session id, mirrored as the FastAPI `session_id` and CopilotKit `threadId`. */
  sessionId?: string;
  /** Authenticated user's Supabase id, when signed in. */
  userAuthId?: string;
  /** Resolved group members (currently the signed-in user only). Server-rendered. */
  groupMembers?: TripState["group_members"];
}

export const Dashboard = ({ sessionId, userAuthId, groupMembers }: DashboardProps = {}) => (
  <AgentSpeakerProvider>
    <DashboardContent
      sessionId={sessionId}
      userAuthId={userAuthId}
      groupMembers={groupMembers}
    />
  </AgentSpeakerProvider>
);

const FORM_COMPONENT_TO_AGENT: Partial<Record<TripState["copilot_ui_hooks"]["active_form_component"], AgentId>> = {
  [ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT]: AGENT_IDS.DIPLOMAT,
  [ACTIVE_FORM_COMPONENT.FLIGHT_PICKER]: AGENT_IDS.LOGISTICIAN,
};

const DashboardContent = ({ sessionId, userAuthId, groupMembers }: DashboardProps) => {
  const persistKey = sessionId ?? "demo";
  const [tripState, setTripState] = usePersistedTrip(persistKey, {
    userAuthId,
    groupMembers,
  });
  const { appendMessage } = useCopilotChat();
  const { setCurrentAgent } = useAgentSpeaker();

  // The left trip panel is collapsible — it pops up once a road is planned,
  // and the user can hide it to give the conversation the full width.
  const [panelHidden, setPanelHidden] = useState(false);

  // Shared highlight between the map markers and the itinerary list: clicking
  // either side lights up the matching stop on the other.
  const [highlightedBlockId, setHighlightedBlockId] = useState<string | null>(
    null,
  );

  // The flight picker modal's open state is local so the user can reopen it
  // from the panel and dismissing it sticks (independent of the backend's
  // active_form, which a re-fetch would otherwise revert).
  const [flightPickerOpen, setFlightPickerOpen] = useState(false);

  // The group-agreement form pops up inside the chat (agent dialog). Local
  // open-state so it can be dismissed and reopened independently of the
  // backend's active_form.
  const [groupAgreementOpen, setGroupAgreementOpen] = useState(false);

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

  const { telemetry } = useTripTelemetry({ sessionId });

  const activeForm = tripState.copilot_ui_hooks.active_form_component;
  const inferredAgent = FORM_COMPONENT_TO_AGENT[activeForm] ?? null;

  // Auto-open the matching form when an agent surfaces it. Keyed on the form
  // value, so it fires on the transition but not on every re-fetch — once the
  // user closes it, it stays closed.
  useEffect(() => {
    if (activeForm === ACTIVE_FORM_COMPONENT.FLIGHT_PICKER) {
      setFlightPickerOpen(true);
    } else if (activeForm === ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT) {
      setGroupAgreementOpen(true);
    }
  }, [activeForm]);

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

  const sendUserMessage = useCallback(
    (content: string) => {
      void appendMessage(new TextMessage({ role: Role.User, content }));
    },
    [appendMessage],
  );

  const handleGroupAgreement = useCallback(
    (result: GroupAgreementResult) => {
      sendUserMessage(encodeGroupAgreementMessage(result));
      dismissActiveForm();
      setGroupAgreementOpen(false);
    },
    [sendUserMessage, dismissActiveForm],
  );

  const handleFlightCheckout = useCallback(
    (result: FlightCheckoutResult) => {
      sendUserMessage(encodeFlightCheckoutMessage(result));
      dismissActiveForm();
    },
    [sendUserMessage, dismissActiveForm],
  );

  const handleFlightSelect = useCallback(
    (option: FlightOption) => {
      handleFlightCheckout({
        airline: option.airline,
        flightNumber:
          option.stops === 0 ? "Nonstop" : `${option.stops} stops`,
        origin: option.depart,
        destination: option.arrive,
        priceUsd: option.price_usd,
      });
      setFlightPickerOpen(false);
    },
    [handleFlightCheckout],
  );

  const { itinerary_manifest, group_profile, group_members } = tripState;
  const shareDialogRef = useRef<ShareDialogHandle | null>(null);
  const openShare = useCallback(() => {
    shareDialogRef.current?.open();
  }, []);

  const isEmpty = itinerary_manifest.origin === "";

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Header
        itinerary={itinerary_manifest}
        groupProfile={group_profile}
        rightSlot={
          <>
            <TelemetryStrip telemetry={telemetry} />
            <MembersStrip members={group_members} />
            {sessionId ? (
              <>
                <SaveTripButton
                  sessionId={sessionId}
                  defaultName={
                    itinerary_manifest.origin && itinerary_manifest.destination
                      ? `${itinerary_manifest.origin} → ${itinerary_manifest.destination}`
                      : undefined
                  }
                />
                <TripsMenu />
                <button
                  type="button"
                  onClick={openShare}
                  className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-surface px-2.5 py-1 text-xs font-semibold transition hover:border-primary/60 hover:text-primary"
                >
                  <Share2 className="size-3.5" aria-hidden />
                  Share
                </button>
              </>
            ) : null}
            <AuthMenu />
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        {/* LEFT — the trip "navigation" panel. Collapsible: it pops up with the
            crew + map + itinerary once a road is planned, and hides on demand.
            Before any plan exists it shows the onboarding welcome. */}
        {/* LEFT — itinerary list, Google-Maps style. Collapsible; pops up
            once a road is planned and can be hidden to give the map more room. */}
        {!isEmpty && !panelHidden ? (
          <aside className="flex w-[21rem] min-w-0 shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold uppercase tracking-wider">
                Itinerary
              </h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted tabular-nums">
                  {itinerary_manifest.calendar_blocks.length} blocks
                </span>
                <button
                  type="button"
                  onClick={() => setPanelHidden(true)}
                  title="Hide itinerary"
                  className="inline-flex items-center text-muted transition hover:text-primary"
                >
                  <PanelLeftClose className="size-4" aria-hidden />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
              <FlightsSummaryCard
                options={itinerary_manifest.flight_options}
                selectedId={itinerary_manifest.selected_flight_id}
                onOpen={() => setFlightPickerOpen(true)}
              />

              <ItineraryTimeline
                blocks={itinerary_manifest.calendar_blocks}
                highlightedId={highlightedBlockId}
                onSelectBlock={setHighlightedBlockId}
              />
            </div>
          </aside>
        ) : null}

        {/* CENTER — the map (or onboarding before any plan). The agent crew
            rides along the top, like a Maps search bar. Grows to fill the
            space freed when the itinerary panel is hidden. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {isEmpty ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <OnboardingCard
                onPrompt={(prompt) =>
                  void appendMessage(
                    new TextMessage({ role: Role.User, content: prompt }),
                  )
                }
              />
            </div>
          ) : (
            <>
              <AgentCrew status={agentStatus} />
              <div className="relative min-h-0 flex-1 p-3">
                {panelHidden ? (
                  <button
                    type="button"
                    onClick={() => setPanelHidden(false)}
                    title="Show itinerary"
                    className="absolute left-5 top-5 z-10 inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted shadow-sm transition hover:text-primary"
                  >
                    <PanelLeftOpen className="size-3.5" aria-hidden />
                    Itinerary
                  </button>
                ) : null}
                <TripMap
                  blocks={itinerary_manifest.calendar_blocks}
                  className="h-full w-full"
                  highlightedId={highlightedBlockId}
                  onSelectBlock={setHighlightedBlockId}
                />
              </div>
            </>
          )}
        </div>

        {/* RIGHT — the conversation. Permanent, docked: this is the hero
            feature (talking with friends + agents). */}
        <div className="relative flex w-full min-w-0 shrink-0 flex-col border-l border-border bg-surface lg:w-[30rem] xl:w-[34rem]">
          <CopilotChat
            className="flex h-full min-h-0 flex-col"
            labels={{
              title: "My Travel Companion Crew",
              initial:
                "Hey! I'm your travel crew. Ask: 'Plan a relaxed 3-day trip from JFK to Paris under $1500.'",
            }}
            AssistantMessage={AgentAssistantMessage}
          />

          {/* Group-agreement form — pops up inside the agent dialog (over the
              chat) when the Diplomat compiles the group's constraints. */}
          {groupAgreementOpen ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
              <div
                className="absolute inset-0 bg-black/20"
                onClick={() => setGroupAgreementOpen(false)}
                aria-hidden
              />
              <div className="relative z-10 w-full max-w-sm">
                <button
                  type="button"
                  onClick={() => setGroupAgreementOpen(false)}
                  aria-label="Dismiss"
                  className="absolute right-2 top-2 z-10 inline-flex size-6 items-center justify-center rounded-sm text-muted transition hover:bg-muted-surface hover:text-foreground"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
                <GroupAgreementForm
                  proposedBudgetUsd={group_profile.compiled_constraints.budget_ceiling_usd}
                  proposedPacing={group_profile.compiled_constraints.pacing}
                  proposedMustIncludeTags={group_profile.compiled_constraints.must_include_tags}
                  proposedAvoidTags={group_profile.compiled_constraints.avoid_tags}
                  rationale="Diplomat compiled these constraints from the group's last exchange. Approve to lock them in."
                  status="executing"
                  onRespond={handleGroupAgreement}
                />
              </div>
            </div>
          ) : null}

          {/* Flight picker — also pops up inside the agent dialog. The user can
              compare options and book, or skip for now. */}
          {flightPickerOpen && itinerary_manifest.flight_options.length > 0 ? (
            <FlightPickerModal
              inline
              title={`Flights ${itinerary_manifest.origin} → ${itinerary_manifest.destination}`}
              options={itinerary_manifest.flight_options}
              selectedId={itinerary_manifest.selected_flight_id}
              onSelect={handleFlightSelect}
              onClose={() => setFlightPickerOpen(false)}
            />
          ) : null}
        </div>
      </div>

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
