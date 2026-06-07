"use client";

import { useCallback, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import {
  useCopilotAction,
  useCopilotChat,
  useCopilotChatSuggestions,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-ui";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import {
  AgentSpeakerProvider,
  useAgentSpeaker,
} from "./chat/agent-speaker-context";
import { AgentAssistantMessage } from "./chat/agent-assistant-message";
import {
  ACTIVE_FORM_COMPONENT,
  ACTIVITY_TYPES,
  type ActivityType,
  type Pacing,
  type TripState,
} from "@/types/trip";
import { AGENT_STATUSES, type AgentStatus } from "@/types/agent";
import {
  AGENT_IDS,
  AGENTS,
  INITIAL_AGENT_STATUS,
  isAgentId,
  isAgentStatus,
  type AgentId,
  type AgentStatusMap,
} from "@/lib/agents";
import { MOCK_TRIP } from "@/lib/mock-trip";
import { usePersistedTrip } from "@/lib/use-persisted-trip";
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
import {
  GroupAgreementForm,
  type GroupAgreementResult,
} from "./generative/group-agreement-form";
import {
  WeatherAlertBanner,
  WEATHER_SEVERITIES,
  isWeatherSeverity,
  type WeatherSeverity,
} from "./generative/weather-alert-banner";
import {
  ReshuffleProposal,
  type ReshuffleProposalResult,
} from "./generative/reshuffle-proposal";

const isActivityType = (value: string): value is ActivityType =>
  value === ACTIVITY_TYPES.OUTDOOR ||
  value === ACTIVITY_TYPES.INDOOR ||
  value === ACTIVITY_TYPES.TRANSIT;

const normalizePacing = (raw: string): Pacing =>
  raw.toUpperCase() === "INTENSE" ? "INTENSE" : "RELAXED";

const toCoordinates = (value: number[] | undefined): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("coordinates must be a [longitude, latitude] tuple.");
  }
  return [value[0], value[1]];
};

interface DashboardProps {
  /** Optional session id; when provided, state is persisted to localStorage. */
  sessionId?: string;
}

export const Dashboard = ({ sessionId }: DashboardProps = {}) => (
  <AgentSpeakerProvider>
    <DashboardContent sessionId={sessionId} />
  </AgentSpeakerProvider>
);

const DashboardContent = ({ sessionId }: DashboardProps) => {
  const [persisted, setPersisted] = usePersistedTrip(sessionId ?? "demo");
  const [ephemeral, setEphemeral] = useState<TripState>(MOCK_TRIP);
  const tripState = sessionId ? persisted : ephemeral;
  const setTripState = sessionId ? setPersisted : setEphemeral;
  const [agentStatus, setAgentStatus] =
    useState<AgentStatusMap>(INITIAL_AGENT_STATUS);
  const { appendMessage } = useCopilotChat();
  const { setCurrentAgent } = useAgentSpeaker();

  useCopilotReadable({
    description:
      "The current state of the travel itinerary, including the active calendar blocks, group budget constraints, and origin/destination.",
    value: tripState,
  });

  useCopilotReadable({
    description:
      "Status of each backend agent in the SyncTrip crew (idle/thinking/active/done).",
    value: agentStatus,
  });

  useCopilotChatSuggestions({
    available: "before-first-message",
    suggestions: [
      { title: "Trim the budget", message: "Make this trip 20% cheaper without dropping must-include tags." },
      { title: "Rain plan", message: "Swap any rainy outdoor block to an indoor alternative within 1 km." },
      { title: "Find a flight", message: "Find a direct flight from JFK to CDG under $600 in early June." },
      { title: "Sunset dinner", message: "Add a sunset dinner spot near the Seine after Day 1." },
    ],
  });

  const updateBlock = useCallback(
    (
      blockId: string,
      patch: { activity_name: string; type: ActivityType; coordinates: [number, number] },
    ) => {
      setTripState((prev) => ({
        ...prev,
        itinerary_manifest: {
          ...prev.itinerary_manifest,
          calendar_blocks: prev.itinerary_manifest.calendar_blocks.map((block) =>
            block.id === blockId ? { ...block, ...patch } : block,
          ),
        },
      }));
    },
    [setTripState],
  );

  const setAgentStatusAt = useCallback(
    (agentId: AgentId, status: AgentStatus) => {
      setAgentStatus((prev) => {
        const next: AgentStatusMap = { ...prev, [agentId]: status };
        if (status === AGENT_STATUSES.ACTIVE || status === AGENT_STATUSES.THINKING) {
          for (const id of Object.keys(prev) as AgentId[]) {
            if (id !== agentId && prev[id] === AGENT_STATUSES.ACTIVE) {
              next[id] = AGENT_STATUSES.IDLE;
            }
          }
        }
        return next;
      });
      if (status === AGENT_STATUSES.ACTIVE) {
        setCurrentAgent(agentId);
      }
    },
    [setCurrentAgent],
  );

  const pushNotification = useCallback(
    (message: string) => {
      setTripState((prev) => ({
        ...prev,
        copilot_ui_hooks: {
          ...prev.copilot_ui_hooks,
          system_notifications: [
            ...prev.copilot_ui_hooks.system_notifications,
            message,
          ],
        },
      }));
    },
    [setTripState],
  );

  const setActiveForm = useCallback(
    (active: TripState["copilot_ui_hooks"]["active_form_component"]) => {
      setTripState((prev) => ({
        ...prev,
        copilot_ui_hooks: { ...prev.copilot_ui_hooks, active_form_component: active },
      }));
    },
    [setTripState],
  );

  useCopilotAction({
    name: "updateItineraryBlock",
    description:
      "Replace the activity in a specific calendar block. Use when reshuffling for weather, budget, or user preference changes.",
    parameters: [
      { name: "blockId", type: "string", description: "ID of the block to replace.", required: true },
      { name: "newActivityName", type: "string", required: true },
      { name: "newType", type: "string", description: "OUTDOOR | INDOOR | TRANSIT.", required: true },
      { name: "newCoordinates", type: "number[]", description: "[longitude, latitude].", required: true },
    ],
    handler: ({ blockId, newActivityName, newType, newCoordinates }) => {
      const normalizedType = String(newType).toUpperCase();
      if (!isActivityType(normalizedType)) {
        throw new Error(`Invalid type "${newType}". Expected OUTDOOR, INDOOR, or TRANSIT.`);
      }
      updateBlock(blockId, {
        activity_name: newActivityName,
        type: normalizedType,
        coordinates: toCoordinates(newCoordinates as number[]),
      });
      return `Updated ${blockId} to "${newActivityName}".`;
    },
  });

  useCopilotAction({
    name: "setAgentStatus",
    description:
      "Mark which agent is currently active. Call this immediately before a worker agent (Diplomat, Logistician, Sentinel, Reshuffler) responds, and again with status='idle' or 'done' after a hand-off.",
    parameters: [
      { name: "agentId", type: "string", description: "supervisor | diplomat | logistician | sentinel | reshuffler.", required: true },
      { name: "status", type: "string", description: "idle | thinking | active | done.", required: true },
    ],
    handler: ({ agentId, status }) => {
      const id = String(agentId).toLowerCase();
      const s = String(status).toLowerCase();
      if (!isAgentId(id)) throw new Error(`Unknown agentId "${agentId}".`);
      if (!isAgentStatus(s)) throw new Error(`Unknown status "${status}".`);
      setAgentStatusAt(id, s);
      return `${AGENTS[id].label} is now ${s}.`;
    },
  });

  useCopilotAction({
    name: "pushSystemNotification",
    description:
      "Append a short notification (e.g. weather warning, swap completed) to the user-visible notification stream. Use for ambient updates, not for asking the user a question.",
    parameters: [
      { name: "message", type: "string", required: true },
      { name: "severity", type: "string", description: "info | watch | warning. Optional." },
    ],
    handler: ({ message, severity }) => {
      const tag = severity ? `[${String(severity).toUpperCase()}] ` : "";
      pushNotification(`${tag}${message}`);
      return `Notified: ${message}`;
    },
  });

  useCopilotAction({
    name: "renderFlightCheckout",
    description:
      "Render a flight checkout card in the chat (Logistician). Use when proposing a specific flight to book.",
    parameters: [
      { name: "airline", type: "string", required: true },
      { name: "flightNumber", type: "string", required: true },
      { name: "origin", type: "string", required: true, description: "Origin IATA code or city." },
      { name: "destination", type: "string", required: true, description: "Destination IATA code or city." },
      { name: "departure", type: "string", description: "ISO timestamp." },
      { name: "arrival", type: "string", description: "ISO timestamp." },
      { name: "durationMinutes", type: "number", description: "Total flight time in minutes." },
      { name: "priceUsd", type: "number", required: true },
    ],
    handler: ({ flightNumber, airline }) =>
      `Drafted flight checkout for ${airline} ${flightNumber}; awaiting user confirmation.`,
    render: ({ status, args }) => (
      <FlightCheckoutCard
        airline={String(args.airline ?? "")}
        flightNumber={String(args.flightNumber ?? "")}
        origin={String(args.origin ?? "")}
        destination={String(args.destination ?? "")}
        departure={args.departure ? String(args.departure) : undefined}
        arrival={args.arrival ? String(args.arrival) : undefined}
        durationMinutes={
          typeof args.durationMinutes === "number" ? args.durationMinutes : undefined
        }
        priceUsd={typeof args.priceUsd === "number" ? args.priceUsd : 0}
        status={status}
      />
    ),
  });

  useCopilotAction({
    name: "renderGroupAgreement",
    description:
      "Render a group agreement form (Diplomat) so the user can approve, reject, or tweak proposed budget/pacing/tag constraints. Resolves with the final approved constraints.",
    parameters: [
      { name: "proposedBudgetUsd", type: "number", required: true },
      { name: "proposedPacing", type: "string", description: "RELAXED | INTENSE.", required: true },
      { name: "proposedMustIncludeTags", type: "string[]", description: "Tags the trip should include." },
      { name: "proposedAvoidTags", type: "string[]", description: "Tags the trip should avoid." },
      { name: "rationale", type: "string", description: "One-sentence reason for this proposal." },
    ],
    renderAndWaitForResponse: ({ status, args, respond }) => {
      const isExecuting = status === "executing";
      if (isExecuting) {
        setActiveForm(ACTIVE_FORM_COMPONENT.GROUP_AGREEMENT);
      }
      return (
        <GroupAgreementForm
          proposedBudgetUsd={
            typeof args.proposedBudgetUsd === "number" ? args.proposedBudgetUsd : 0
          }
          proposedPacing={normalizePacing(String(args.proposedPacing ?? "RELAXED"))}
          proposedMustIncludeTags={
            Array.isArray(args.proposedMustIncludeTags)
              ? (args.proposedMustIncludeTags as string[])
              : []
          }
          proposedAvoidTags={
            Array.isArray(args.proposedAvoidTags)
              ? (args.proposedAvoidTags as string[])
              : []
          }
          rationale={args.rationale ? String(args.rationale) : undefined}
          status={status}
          onRespond={(result: GroupAgreementResult) => {
            if (result.approved) {
              setTripState((prev) => ({
                ...prev,
                group_profile: {
                  compiled_constraints: {
                    budget_ceiling_usd: result.budget_ceiling_usd,
                    pacing: result.pacing,
                    must_include_tags: result.must_include_tags,
                    avoid_tags: result.avoid_tags,
                  },
                },
              }));
              pushNotification("Group constraints sealed by Diplomat.");
            }
            setActiveForm(ACTIVE_FORM_COMPONENT.NONE);
            respond?.(result);
          }}
        />
      );
    },
  });

  useCopilotAction({
    name: "renderWeatherAlert",
    description:
      "Render a Sentinel weather alert in the chat. Use when monitoring detects a forecast that endangers an OUTDOOR block. The user may click 'Reroute' to ask the Reshuffler.",
    parameters: [
      { name: "blockId", type: "string", required: true },
      { name: "blockName", type: "string", required: true },
      { name: "severity", type: "string", description: "info | watch | warning.", required: true },
      { name: "forecast", type: "string", required: true },
    ],
    handler: ({ blockId, severity }) =>
      `Posted ${String(severity).toUpperCase()} weather alert for ${blockId}.`,
    render: ({ args }) => {
      const sev = String(args.severity ?? "watch").toLowerCase();
      const severity: WeatherSeverity = isWeatherSeverity(sev)
        ? sev
        : WEATHER_SEVERITIES.WATCH;
      const blockId = String(args.blockId ?? "");
      const blockName = String(args.blockName ?? "");
      return (
        <WeatherAlertBanner
          blockId={blockId}
          blockName={blockName}
          severity={severity}
          forecast={String(args.forecast ?? "")}
          onReroute={() => {
            pushNotification(`Reroute requested for ${blockId}.`);
            void appendMessage(
              new TextMessage({
                role: Role.User,
                content: `Please reroute ${blockId} ("${blockName}") to a comparable indoor alternative nearby.`,
              }),
            );
          }}
        />
      );
    },
  });

  useCopilotAction({
    name: "renderReshuffleProposal",
    description:
      "Render a Reshuffler swap proposal in the chat. Resolves when the user accepts or rejects. On accept, automatically applies the swap to the itinerary.",
    parameters: [
      { name: "blockId", type: "string", required: true },
      { name: "reason", type: "string", required: true },
      { name: "oldActivityName", type: "string", required: true },
      { name: "oldType", type: "string", required: true, description: "OUTDOOR | INDOOR | TRANSIT." },
      { name: "newActivityName", type: "string", required: true },
      { name: "newType", type: "string", required: true, description: "OUTDOOR | INDOOR | TRANSIT." },
      { name: "newCoordinates", type: "number[]", required: true, description: "[longitude, latitude]." },
    ],
    renderAndWaitForResponse: ({ status, args, respond }) => {
      const oldType = String(args.oldType ?? "INDOOR").toUpperCase();
      const newType = String(args.newType ?? "INDOOR").toUpperCase();
      if (!isActivityType(oldType) || !isActivityType(newType)) {
        return (
          <div className="text-xs text-red-600">
            Invalid activity type in reshuffle proposal.
          </div>
        );
      }
      const blockId = String(args.blockId ?? "");
      const newCoords = toCoordinates(
        Array.isArray(args.newCoordinates) ? (args.newCoordinates as number[]) : [0, 0],
      );

      return (
        <ReshuffleProposal
          blockId={blockId}
          reason={String(args.reason ?? "")}
          oldActivity={{
            activity_name: String(args.oldActivityName ?? ""),
            type: oldType,
          }}
          newActivity={{
            activity_name: String(args.newActivityName ?? ""),
            type: newType,
            coordinates: newCoords,
          }}
          status={status}
          onRespond={(result: ReshuffleProposalResult) => {
            if (result.approved) {
              updateBlock(blockId, {
                activity_name: String(args.newActivityName ?? ""),
                type: newType,
                coordinates: newCoords,
              });
              pushNotification(
                `Reshuffler swapped ${blockId} → ${args.newActivityName}.`,
              );
            }
            respond?.(result);
          }}
        />
      );
    },
  });

  const { itinerary_manifest, group_profile, group_members } = tripState;
  const shareDialogRef = useRef<ShareDialogHandle | null>(null);
  const openShare = useCallback(() => {
    shareDialogRef.current?.open();
  }, []);

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
        {itinerary_manifest.origin === "" ? (
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

            <aside className="min-w-0">
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
            "Hey! I'm your travel crew. Try: 'Swap block_001 to the Louvre' or 'Find a cheaper flight under $600.'",
        }}
        instructions={INSTRUCTIONS}
        AssistantMessage={AgentAssistantMessage}
      />

      {sessionId ? (
        <ShareDialog ref={shareDialogRef} sessionId={sessionId} />
      ) : null}

      <NotificationToaster
        notifications={tripState.copilot_ui_hooks.system_notifications}
      />

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
                pushNotification(`Session id copied: ${sessionId.slice(0, 8)}…`);
              }
            },
          },
        ]}
      />
    </div>
  );
};

const INSTRUCTIONS = `You are SyncTrip, a multi-agent travel planning crew. The cast:
- Supervisor (id: ${AGENT_IDS.SUPERVISOR}): routes the user request to a worker.
- Diplomat (id: ${AGENT_IDS.DIPLOMAT}): negotiates group constraints; renders a GROUP_AGREEMENT form via renderGroupAgreement.
- Logistician (id: ${AGENT_IDS.LOGISTICIAN}): finds flights and places; renders FLIGHT_PICKER cards via renderFlightCheckout.
- Sentinel (id: ${AGENT_IDS.SENTINEL}): monitors weather/events; renders alerts via renderWeatherAlert and pushSystemNotification.
- Reshuffler (id: ${AGENT_IDS.RESHUFFLER}): swaps compromised blocks; renders proposals via renderReshuffleProposal.

Rules:
1. Before any worker speaks, call setAgentStatus(workerId, 'active'); after handing off, mark them 'idle' or 'done'.
2. Prefer rendering generative UI (the four render* tools) over plain text when proposing a flight, constraint set, weather alert, or swap.
3. The user's full TripState and current agent status are already provided as readable context — read them before acting.
4. To change a calendar block directly, call updateItineraryBlock with valid Mapbox [longitude, latitude] coordinates.`;
