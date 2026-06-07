"use client";

import { CopilotKit } from "@copilotkit/react-core";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
  /**
   * The CopilotKit thread id. We pin it to the URL `sessionId` so the
   * `FastApiAgent` in `app/api/copilotkit/fastapi-agent.ts` can use it as the
   * backend `session_id` and keep transcripts coherent across page reloads.
   */
  threadId?: string;
}

/**
 * SyncTrip uses a *self-hosted* CopilotKit runtime: `app/api/copilotkit/route.ts`
 * mounts `CopilotRuntime` and bridges chat into FastAPI via `FastApiAgent`.
 * Because `runtimeUrl` is set, we do NOT need a CopilotKit Cloud API key —
 * that env var is only relevant if you swap this for `https://api.cloud.copilotkit.ai`.
 */
export const Providers = ({ children, threadId }: ProvidersProps) => (
  <CopilotKit runtimeUrl="/api/copilotkit" threadId={threadId}>
    {children}
  </CopilotKit>
);
