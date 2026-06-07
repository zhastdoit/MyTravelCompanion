import { AGENTS, type AgentId } from "@/lib/agents";
import { cn } from "@/lib/utils";

interface AgentCardProps {
  agentId: AgentId;
  /** Override the default agent label, e.g. "Flight booking" instead of "Logistician". */
  title?: string;
  status?: string;
  className?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const AgentCard = ({
  agentId,
  title,
  status,
  className,
  children,
  footer,
}: AgentCardProps) => {
  const agent = AGENTS[agentId];
  const Icon = agent.icon;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-surface text-foreground",
        className,
      )}
      style={{ borderColor: agent.accent }}
    >
      <header
        className="flex items-center gap-2 border-b px-3 py-1.5"
        style={{
          borderColor: agent.accent,
          backgroundColor: `${agent.accent}0d`,
        }}
      >
        <span
          className="grid size-5 place-items-center rounded-sm"
          style={{ backgroundColor: agent.accent, color: "#fff" }}
        >
          <Icon className="size-3" aria-hidden />
        </span>
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: agent.accent }}
        >
          {title ?? agent.label}
        </span>
        {status ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted">
            {status}
          </span>
        ) : null}
      </header>
      <div className="px-3 py-2.5 text-sm">{children}</div>
      {footer ? (
        <footer className="flex items-center gap-2 border-t border-border bg-muted-surface/40 px-3 py-2">
          {footer}
        </footer>
      ) : null}
    </div>
  );
};
