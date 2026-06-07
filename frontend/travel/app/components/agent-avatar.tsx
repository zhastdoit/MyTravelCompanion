import Image from "next/image";
import { AGENTS, type AgentId } from "@/lib/agents";
import { cn } from "@/lib/utils";

interface AgentAvatarProps {
  agentId: AgentId;
  size?: number;
  className?: string;
}

export const AgentAvatar = ({
  agentId,
  size = 24,
  className,
}: AgentAvatarProps) => {
  const agent = AGENTS[agentId];

  return (
    <span
      className={cn(
        "inline-block shrink-0 overflow-hidden rounded-full bg-muted-surface",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Image
        src={agent.avatarSrc}
        alt=""
        width={size}
        height={size}
        aria-hidden
        className="block h-full w-full scale-110 object-cover"
      />
    </span>
  );
};
