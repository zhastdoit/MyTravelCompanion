import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import type { BackendChatLine, BackendChatResponse } from "@/lib/trip-bridge";

interface FastApiAgentOptions {
  /** Base URL of the FastAPI agent server (e.g. `http://localhost:8000`). */
  backendUrl: string;
  /** Optional injected `fetch` for tests. */
  fetchImpl?: typeof fetch;
  /** Stable agent id used by `/info` and the React provider. */
  agentId?: string;
  /** Supabase access token to forward as `Authorization: Bearer ...`. */
  accessToken?: string | null;
}

const CHAT_PATH = "/api/chat";
const DEFAULT_AGENT_ID = "default";

/**
 * How long each agent appears to "think" before its message lands. The backend
 * returns the whole crew transcript at once; we reveal it line-by-line so the
 * UI feels like the agents are deliberating in turn. CopilotKit shows its
 * typing indicator during these gaps (the run stays active).
 */
const THINKING_DELAY_MS = 900;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const trimTrailingSlash = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;

/** Shape of the assistant message(s) produced by the FastAPI bridge.
 *
 * `lines` is the per-agent breakdown when the backend supplies a `chat[]`
 * array; on error or older responses it collapses to a single line carrying
 * the legacy `reply` string.
 */
interface ReplyResult {
  lines: BackendChatLine[];
  isError: boolean;
  /**
   * A generative-UI form the backend wants rendered inline in the chat. Mapped
   * to a CopilotKit action (`useCopilotAction`) the frontend registers; we emit
   * it as an AGUI tool call so CopilotKit renders the action's UI in-stream.
   */
  form?: { name: string; args: Record<string, unknown> } | null;
}

/** Detect a form the backend wants surfaced from its returned TripState. */
const detectForm = (data: BackendChatResponse): ReplyResult["form"] => {
  const hooks = data.state?.copilot_ui_hooks;
  const c = data.state?.group_profile?.compiled_constraints;
  if (hooks?.active_form_component === "GROUP_AGREEMENT" && c) {
    return {
      name: "group_agreement",
      args: {
        budget_ceiling_usd: c.budget_ceiling_usd,
        pacing: c.pacing,
        must_include_tags: c.must_include_tags ?? [],
        avoid_tags: c.avoid_tags ?? [],
      },
    };
  }
  return null;
};

/** Format a per-agent chat line as a markdown bubble for the chat UI. */
const formatChatLine = (line: BackendChatLine): string =>
  `**${line.emoji} ${line.name}** — ${line.text}`;

/** Build a one-line `ReplyResult` from a fallback string (errors / legacy responses). */
const singleLineResult = (text: string, isError: boolean): ReplyResult => ({
  lines: [{ agent: "system", emoji: "", name: "", text }],
  isError,
});

/**
 * AGUI agent that bridges CopilotKit's chat protocol to the FastAPI agent
 * server. Each `run` call extracts the latest user message from the input
 * thread, posts `{ session_id, message }` to `${backendUrl}/api/chat`, and
 * emits a single assistant text message back through the AGUI event stream.
 *
 * Streaming is single-chunk for now (FastAPI returns the full reply as one
 * JSON body); when the backend exposes SSE we'll split the reply into
 * `TEXT_MESSAGE_CONTENT` deltas.
 */
export class FastApiAgent extends AbstractAgent {
  // Regular `private` (TS) instead of `#` so the runtime's `clone()` flow
  // — which uses `Object.create(Object.getPrototypeOf(...))` — keeps the
  // agent functional after cloning. The fields are still hidden at the
  // type level for consumers.
  private readonly backendUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly options: FastApiAgentOptions;
  private readonly accessToken: string | null;

  constructor(options: FastApiAgentOptions) {
    super({
      agentId: options.agentId ?? DEFAULT_AGENT_ID,
      description: "My Travel Companion FastAPI agent crew",
    });
    this.options = options;
    this.backendUrl = trimTrailingSlash(options.backendUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.accessToken = options.accessToken ?? null;
  }

  /**
   * The runtime clones the agent per-request (see
   * `cloneAgentForRequest` in `@copilotkit/runtime/v2`). The base
   * implementation returns a shallow proto clone that doesn't preserve our
   * own properties, so we re-instantiate explicitly.
   */
  clone(): FastApiAgent {
    return new FastApiAgent(this.options);
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const sessionId = input.threadId;
      // A trailing tool result (a generative-UI form submission via respond())
      // carries the encoded message; otherwise use the latest user text.
      const lastMsg = input.messages[input.messages.length - 1] as
        | { role?: string; content?: unknown }
        | undefined;
      const userMessage =
        lastMsg?.role === "tool"
          ? flattenContent(lastMsg.content)
          : pickLatestUserText(input.messages);

      const cancelled = { current: false };

      (async () => {
        try {
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });

          const { lines, isError, form } = await this.requestReply(
            sessionId,
            userMessage,
          );

          if (cancelled.current) return;

          // Fan the per-agent chat lines out into separate assistant
          // messages so the chat UI can render the crew talking. Each line
          // gets its own messageId triplet (START / CONTENT / END) per the
          // AGUI protocol. A short "thinking" pause before each line staggers
          // them so the crew appears to deliberate one at a time, instead of
          // dumping every message at once.
          for (const line of lines) {
            // Don't make hard errors wait behind a thinking animation.
            if (!isError) {
              await sleep(THINKING_DELAY_MS);
              if (cancelled.current) return;
            }

            const messageId = randomUUID();
            const delta = line.emoji ? formatChatLine(line) : line.text;
            subscriber.next({
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              role: "assistant",
            });
            subscriber.next({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta,
            });
            subscriber.next({
              type: EventType.TEXT_MESSAGE_END,
              messageId,
            });
          }

          // Surface a generative-UI form as an AGUI tool call so CopilotKit
          // renders the registered action inline in the chat. Attach it to a
          // short assistant message that introduces the card.
          if (form && !isError && !cancelled.current) {
            const parentMessageId = randomUUID();
            const toolCallId = randomUUID();
            subscriber.next({
              type: EventType.TEXT_MESSAGE_START,
              messageId: parentMessageId,
              role: "assistant",
            });
            subscriber.next({
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId: parentMessageId,
              delta: "Here's the group's plan — confirm or tweak it below 👇",
            });
            subscriber.next({
              type: EventType.TEXT_MESSAGE_END,
              messageId: parentMessageId,
            });
            subscriber.next({
              type: EventType.TOOL_CALL_START,
              toolCallId,
              toolCallName: form.name,
              parentMessageId,
            });
            subscriber.next({
              type: EventType.TOOL_CALL_ARGS,
              toolCallId,
              delta: JSON.stringify(form.args),
            });
            subscriber.next({
              type: EventType.TOOL_CALL_END,
              toolCallId,
            });
          }

          if (isError) {
            subscriber.next({
              type: EventType.RUN_ERROR,
              message: lines[lines.length - 1]?.text ?? "agent error",
            });
          } else {
            subscriber.next({
              type: EventType.RUN_FINISHED,
              threadId: input.threadId,
              runId: input.runId,
            });
          }
          subscriber.complete();
        } catch (err) {
          subscriber.error(err);
        }
      })();

      return () => {
        cancelled.current = true;
      };
    });
  }

  private async requestReply(
    sessionId: string,
    message: string,
  ): Promise<ReplyResult> {
    let res: Response;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (this.accessToken) {
      headers.authorization = `Bearer ${this.accessToken}`;
    }
    try {
      res = await this.fetchImpl(`${this.backendUrl}${CHAT_PATH}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: sessionId, message }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return singleLineResult(
        `Backend unreachable at ${this.backendUrl}: ${detail}`,
        true,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return singleLineResult(
        `Backend error ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        true,
      );
    }

    let data: BackendChatResponse;
    try {
      data = (await res.json()) as BackendChatResponse;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return singleLineResult(`Malformed backend response: ${detail}`, true);
    }

    // Prefer the structured `chat[]` payload so each agent gets its own
    // bubble; fall back to the legacy single-line `reply` for older
    // backends or if the orchestrator returned no chat events.
    const form = detectForm(data);
    const lines = (data.chat ?? []).filter((l) => l.text?.trim().length > 0);
    if (lines.length > 0) {
      return { lines, isError: false, form };
    }
    return { ...singleLineResult(data.reply ?? "", false), form };
  }
}

interface MessageLike {
  role?: string;
  content?: unknown;
}

const flattenContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .join("");
};

/**
 * Walk the message list backwards and return the most recent user-authored
 * text. Empty string when the conversation has no user turns yet (e.g. the
 * initial provider warmup call).
 */
export const pickLatestUserText = (messages: readonly MessageLike[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const text = flattenContent(m.content);
    if (text) return text;
  }
  return "";
};
