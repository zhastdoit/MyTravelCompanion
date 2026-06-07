import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { NextRequest } from "next/server";
import { FastApiAgent } from "./fastapi-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

let cached: { runtime: CopilotRuntime; backendUrl: string } | null = null;

const getRuntime = () => {
  const backendUrl = process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;
  if (cached && cached.backendUrl === backendUrl) return cached;

  const fastApiAgent = new FastApiAgent({ backendUrl });
  cached = {
    runtime: new CopilotRuntime({ agents: { default: fastApiAgent } }),
    backendUrl,
  };
  return cached;
};

export const POST = async (req: NextRequest): Promise<Response> => {
  const { runtime: copilotRuntime } = getRuntime();
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
};

export const GET = POST;
