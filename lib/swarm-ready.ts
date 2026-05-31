import type { SwarmStatus } from "@/app/generated/prisma/client";

/** Minimal swarm shape for readiness checks (API JSON). */
export type SwarmSnapshot = {
  status: SwarmStatus;
  confidence?: number | null;
  messages?: { role: string }[] | null;
};

export function isSwarmReady(swarm: SwarmSnapshot): boolean {
  if (swarm.status === "FAILED") {
    return true;
  }

  const messages = swarm.messages ?? [];
  const hasManager = messages.some((message) => message.role === "Manager");
  const hasConfidence =
    typeof swarm.confidence === "number" && swarm.confidence > 0;

  return hasManager && hasConfidence;
}

export function isSwarmProcessing(swarm: SwarmSnapshot): boolean {
  return swarm.status !== "FAILED" && !isSwarmReady(swarm);
}
