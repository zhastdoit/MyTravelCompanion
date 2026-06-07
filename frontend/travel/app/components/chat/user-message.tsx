"use client";

import type { UserMessageProps } from "@copilotkit/react-ui";
import { Check } from "lucide-react";

type Content = NonNullable<UserMessageProps["message"]>["content"];

const getText = (content: Content | undefined): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && p.type === "text" ? p.text : ""))
      .join(" ")
      .trim();
  }
  return "";
};

/** Form submissions are sent as `[form: NAME] …` user messages. Show a friendly
 * chip instead of the raw encoded string. */
const prettyForm = (text: string): string | null => {
  if (!text.startsWith("[form:")) return null;
  if (text.includes("GROUP_AGREEMENT")) {
    return text.includes("Approved") ? "Approved the group plan" : "Sent the plan back";
  }
  if (text.includes("FLIGHT_PICKER")) return "Confirmed the flight";
  return "Submitted";
};

/** Right-aligned WhatsApp-style user bubble. */
export const ChatUserMessage = ({ message }: UserMessageProps) => {
  const text = getText(message?.content);
  if (!text) return null;

  const pretty = prettyForm(text);
  if (pretty) {
    return (
      <div className="flex justify-end px-3 py-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted">
          <Check className="size-3 text-[color:var(--color-outdoor)]" aria-hidden />
          {pretty}
        </span>
      </div>
    );
  }

  return (
    <div className="flex justify-end px-3 py-1">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm leading-relaxed text-primary-foreground shadow-sm">
        {text}
      </div>
    </div>
  );
};
