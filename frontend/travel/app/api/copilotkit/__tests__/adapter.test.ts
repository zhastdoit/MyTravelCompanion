import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstValueFrom, toArray } from "rxjs";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { FastApiAgent, pickLatestUserText } from "../fastapi-agent";
import type { BackendChatResponse } from "@/lib/trip-bridge";

const makeBackendResponse = (
  reply: string,
  overrides: Partial<BackendChatResponse> = {},
): BackendChatResponse => ({
  session_id: "sid_xyz",
  reply,
  active_agent: "supervisor",
  trail: [],
  state: {
    session_id: "sid_xyz",
    user_auth_id: "",
    group_profile: {
      compiled_constraints: {
        budget_ceiling_usd: 0,
        pacing: "RELAXED",
        must_include_tags: [],
        avoid_tags: [],
      },
    },
    itinerary_manifest: { origin: "", destination: "", calendar_blocks: [] },
    copilot_ui_hooks: {
      active_form_component: "NONE",
      system_notifications: [],
    },
  },
  store_backend: "memory",
  llm_mode: "mock",
  entry_agent: "supervisor",
  usd_spent: 0,
  usd_cap: 1.0,
  ...overrides,
});

const buildInput = (
  threadId: string,
  userText: string,
): RunAgentInput =>
  ({
    threadId,
    runId: "run_abc",
    state: undefined,
    messages: [
      { id: "m1", role: "user", content: userText },
    ],
    tools: [],
    context: [],
    forwardedProps: {},
  }) as unknown as RunAgentInput;

const collectEvents = async (agent: FastApiAgent, input: RunAgentInput) =>
  firstValueFrom(agent.run(input).pipe(toArray()));

describe("pickLatestUserText", () => {
  it("returns the most recent user message content", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "hello back" },
      { role: "user", content: "second" },
    ];
    expect(pickLatestUserText(messages)).toBe("second");
  });

  it("returns empty string when there are no user turns", () => {
    expect(pickLatestUserText([{ role: "system", content: "boot" }])).toBe(
      "",
    );
  });

  it("flattens an array-of-parts user content", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Plan a trip" },
          { type: "text", text: " to Tokyo" },
        ],
      },
    ];
    expect(pickLatestUserText(messages)).toBe("Plan a trip to Tokyo");
  });
});

describe("FastApiAgent.run", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POSTs the latest user message and falls back to the legacy reply when chat[] is absent", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(makeBackendResponse("hello from agents")),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const agent = new FastApiAgent({
      backendUrl: "http://backend.test/",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const events = (await collectEvents(
      agent,
      buildInput("sid_xyz", "Plan a trip to Tokyo"),
    )) as BaseEvent[];

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://backend.test/api/chat");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      session_id: "sid_xyz",
      message: "Plan a trip to Tokyo",
    });

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);

    const contentEvent = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string } | undefined;
    expect(contentEvent?.delta).toBe("hello from agents");
  });

  it("fans chat[] entries out into one assistant message per agent", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          makeBackendResponse("ignored when chat[] is present", {
            chat: [
              { agent: "supervisor", emoji: "🧭", name: "Supervisor",
                text: "Bringing in the Diplomat 🤝…" },
              { agent: "diplomat", emoji: "🤝", name: "Diplomat",
                text: "Locked in: $1500, Tokyo, food + history." },
              { agent: "logistician", emoji: "🧰", name: "Logistician",
                text: "✈️ 3 flight options, $560–$740." },
            ],
          }),
        ),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const agent = new FastApiAgent({
      backendUrl: "http://backend.test",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const events = (await collectEvents(
      agent,
      buildInput("sid_xyz", "Plan a trip to Tokyo"),
    )) as BaseEvent[];

    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types[types.length - 1]).toBe(EventType.RUN_FINISHED);
    // Three lines × (START + CONTENT + END) = 9 message events.
    const messageEvents = types.filter((t) =>
      t === EventType.TEXT_MESSAGE_START ||
      t === EventType.TEXT_MESSAGE_CONTENT ||
      t === EventType.TEXT_MESSAGE_END,
    );
    expect(messageEvents).toHaveLength(9);

    const contentEvents = events.filter(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string }[];
    expect(contentEvents.map((e) => e.delta)).toEqual([
      "**🧭 Supervisor** — Bringing in the Diplomat 🤝…",
      "**🤝 Diplomat** — Locked in: $1500, Tokyo, food + history.",
      "**🧰 Logistician** — ✈️ 3 flight options, $560–$740.",
    ]);

    // Each line should use a fresh messageId so the chat UI treats them
    // as separate bubbles.
    const startIds = (events.filter((e) => e.type === EventType.TEXT_MESSAGE_START) as { messageId: string }[])
      .map((e) => e.messageId);
    expect(new Set(startIds).size).toBe(3);
  });

  it("emits RUN_ERROR when the backend is unreachable", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const agent = new FastApiAgent({
      backendUrl: "http://backend.test",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const events = (await collectEvents(
      agent,
      buildInput("sid_xyz", "hello"),
    )) as BaseEvent[];

    const types = events.map((e) => e.type);
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types).toContain(EventType.RUN_ERROR);
    expect(types).not.toContain(EventType.RUN_FINISHED);

    const contentEvent = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string } | undefined;
    expect(contentEvent?.delta).toContain("Backend unreachable");
    expect(contentEvent?.delta).toContain("ECONNREFUSED");
  });

  it("forwards the Supabase access token as a Bearer when configured", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeBackendResponse("hi")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const agent = new FastApiAgent({
      backendUrl: "http://backend.test",
      fetchImpl: fetchSpy as unknown as typeof fetch,
      accessToken: "jwt-abc",
    });

    await collectEvents(agent, buildInput("sid_xyz", "hi"));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      authorization: "Bearer jwt-abc",
    });
  });

  it("omits the Authorization header when no token is configured", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(makeBackendResponse("hi")), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const agent = new FastApiAgent({
      backendUrl: "http://backend.test",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    await collectEvents(agent, buildInput("sid_xyz", "hi"));

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("emits a non-2xx error including the upstream status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("kaboom", { status: 503 }));
    const agent = new FastApiAgent({
      backendUrl: "http://backend.test",
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    const events = (await collectEvents(
      agent,
      buildInput("sid_xyz", "hello"),
    )) as BaseEvent[];

    const contentEvent = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    ) as { delta: string } | undefined;
    expect(contentEvent?.delta).toContain("Backend error 503");
    expect(contentEvent?.delta).toContain("kaboom");
  });
});
