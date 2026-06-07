import type { GroupMember } from "@/types/trip";

interface MembersStripProps {
  members: GroupMember[];
  max?: number;
}

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("") || "?";

export const MembersStrip = ({ members, max = 4 }: MembersStripProps) => {
  if (members.length === 0) return null;

  const visible = members.slice(0, max);
  const overflow = members.length - visible.length;

  return (
    <div
      className="flex items-center"
      role="list"
      aria-label={`${members.length} group ${members.length === 1 ? "member" : "members"}`}
    >
      {visible.map((member, idx) => (
        <span
          key={member.id}
          role="listitem"
          title={member.name}
          style={{
            backgroundColor: member.color,
            zIndex: visible.length - idx,
            marginLeft: idx === 0 ? 0 : -8,
          }}
          className="grid size-7 place-items-center rounded-full border-2 border-surface text-[11px] font-semibold text-white"
        >
          {initials(member.name)}
        </span>
      ))}
      {overflow > 0 ? (
        <span
          className="ml-[-8px] grid size-7 place-items-center rounded-full border-2 border-surface bg-muted-surface font-mono text-[10px] font-semibold text-muted"
          aria-label={`${overflow} more`}
        >
          +{overflow}
        </span>
      ) : null}
    </div>
  );
};
