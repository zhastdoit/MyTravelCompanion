import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  OpenAIAdapter,
  type CopilotServiceAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: { runtime: CopilotRuntime; adapter: CopilotServiceAdapter } | null = null;

const getRuntime = (): { runtime: CopilotRuntime; adapter: CopilotServiceAdapter } => {
  if (cached) return cached;

  const backendUrl = process.env.COPILOT_BACKEND_URL;
  const openaiKey = process.env.OPENAI_API_KEY;

  const copilotRuntime = new CopilotRuntime({
    remoteEndpoints: backendUrl ? [{ url: backendUrl }] : [],
  });

  const adapter: CopilotServiceAdapter = openaiKey
    ? new OpenAIAdapter({
        openai: new OpenAI({ apiKey: openaiKey }),
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      })
    : new ExperimentalEmptyAdapter();

  cached = { runtime: copilotRuntime, adapter };
  return cached;
};

export const POST = async (req: NextRequest): Promise<Response> => {
  const { runtime, adapter } = getRuntime();
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime,
    serviceAdapter: adapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};
