import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_ID_LIST, AGENTS, getAgentAvatarSrc } from "@/lib/agents";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(testDir, "..", "..", "public");

describe("agent avatars", () => {
  it("maps every agent to an existing public PNG", () => {
    for (const id of AGENT_ID_LIST) {
      const avatarSrc = AGENTS[id].avatarSrc;
      expect(avatarSrc).toBe(getAgentAvatarSrc(id));
      expect(existsSync(path.join(publicDir, avatarSrc.slice(1)))).toBe(true);
    }
  });
});
