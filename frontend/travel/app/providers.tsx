"use client";

import { CopilotKit } from "@copilotkit/react-core";
import type { ReactNode } from "react";

interface ProvidersProps {
  children: ReactNode;
}

export const Providers = ({ children }: ProvidersProps) => {
  const publicApiKey = process.env.NEXT_PUBLIC_COPILOTKIT_PUBLIC_API_KEY;

  return (
    <CopilotKit runtimeUrl="/api/copilotkit" publicApiKey={publicApiKey}>
      {children}
    </CopilotKit>
  );
};
