"use client";

import { CopilotKit } from "@copilotkit/react-core";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
  /**
   * The CopilotKit thread id. We pin it to the URL `sessionId` so the FastAPI
   * adapter (`app/api/copilotkit/fastapi-adapter.ts`) can use it as the
   * backend `session_id` and keep transcripts coherent across page reloads.
   */
  threadId?: string;
}

export const Providers = ({ children, threadId }: ProvidersProps) => {
  const publicApiKey = process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY;

  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      publicApiKey={publicApiKey}
      threadId={threadId}
    >
      {children}
    </CopilotKit>
  );
};
