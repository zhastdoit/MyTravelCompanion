import { randomUUID } from "node:crypto";
import { Observable } from "rxjs";
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import type { BackendChatResponse } from "@/lib/trip-bridge";

interface FastApiAgentOptions {
  /** Base URL of the FastAPI agent server (e.g. `http://localhost:8000`). */
  backendUrl: string;
  /** Optional injected `fetch` for tests. */
  fetchImpl?: typeof fetch;
  /** Stable agent id used by `/info` and the React provider. */
  agentId?: string;
}

const CHAT_PATH = "/api/chat";
const DEFAULT_AGENT_ID = "default";

const trimTrailingSlash = (url: string): string =>
  url.endsWith("/") ? url.slice(0, -1) : url;

/** Shape of the assistant message produced by the FastAPI bridge. */
interface ReplyResult {
  text: string;
  isError: boolean;
}

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

  constructor(options: FastApiAgentOptions) {
    super({
      agentId: options.agentId ?? DEFAULT_AGENT_ID,
      description: "SyncTrip FastAPI agent crew",
    });
    this.options = options;
    this.backendUrl = trimTrailingSlash(options.backendUrl);
    this.fetchImpl = options.fetchImpl ?? fetch;
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
      const userMessage = pickLatestUserText(input.messages);
      const messageId = randomUUID();

      const cancelled = { current: false };

      (async () => {
        try {
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });

          const { text, isError } = await this.requestReply(
            sessionId,
            userMessage,
          );

          if (cancelled.current) return;

          subscriber.next({
            type: EventType.TEXT_MESSAGE_START,
            messageId,
            role: "assistant",
          });
          subscriber.next({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta: text,
          });
          subscriber.next({
            type: EventType.TEXT_MESSAGE_END,
            messageId,
          });

          if (isError) {
            subscriber.next({
              type: EventType.RUN_ERROR,
              message: text,
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
    try {
      res = await this.fetchImpl(`${this.backendUrl}${CHAT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message }),
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        text: `Backend unreachable at ${this.backendUrl}: ${detail}`,
        isError: true,
      };
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        text: `Backend error ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
        isError: true,
      };
    }

    let data: BackendChatResponse;
    try {
      data = (await res.json()) as BackendChatResponse;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { text: `Malformed backend response: ${detail}`, isError: true };
    }

    return { text: data.reply ?? "", isError: false };
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
