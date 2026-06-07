import {
  CopilotRuntime,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { NextRequest } from "next/server";
import { getSessionAccessToken } from "@/lib/supabase/server";
import { FastApiAgent } from "./fastapi-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

const getBackendUrl = (): string =>
  process.env.BACKEND_URL ?? DEFAULT_BACKEND_URL;

/**
 * Build a fresh CopilotRuntime per request. We can't safely cache it across
 * requests now that the agent embeds the user's Supabase access token —
 * caching would leak tokens between users.
 */
const buildRuntime = async (): Promise<CopilotRuntime> => {
  const backendUrl = getBackendUrl();
  const accessToken = await getSessionAccessToken();
  return new CopilotRuntime({
    agents: {
      default: new FastApiAgent({ backendUrl, accessToken }),
    },
  });
};

const handle = async (req: NextRequest): Promise<Response> => {
  const copilotRuntime = await buildRuntime();
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};

export const POST = handle;
export const GET = handle;
