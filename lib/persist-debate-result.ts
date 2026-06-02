import { Prisma } from "@/app/generated/prisma/client";
import { AI_MODEL_ERROR_VERDICT } from "@/lib/debate-constants";
import { prisma } from "@/lib/prisma";

export type DebateEngineAgent = {
  name: string;
  position: string;
};

export type DebateEnginePayload = {
  debateId: string;
  verdict: string;
  confidence: number;
  agents: DebateEngineAgent[];
  runtime: number;
  cost: number;
  agentCount: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeVerdict(verdict: string): string {
  const trimmed = verdict.trim();
  if (!trimmed) {
    console.warn("[persist-debate-result] empty verdict -> AI_MODEL_ERROR_VERDICT");
    return AI_MODEL_ERROR_VERDICT;
  }
  return trimmed;
}

export function parseDebateEnginePayload(
  body: unknown,
): { ok: true; data: DebateEnginePayload } | { ok: false; error: string } {
  if (!isRecord(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const debateId =
    typeof body.debate_id === "string"
      ? body.debate_id.trim()
      : typeof body.debateId === "string"
        ? body.debateId.trim()
        : "";

  if (!debateId) {
    return { ok: false, error: "debate_id is required" };
  }

  const status =
    typeof body.status === "string" ? body.status.trim().toLowerCase() : "";

  if (
    status &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "failure"
  ) {
    return { ok: false, error: `Unsupported status: ${status}` };
  }

  if (status === "failed" || status === "failure") {
    return {
      ok: true,
      data: {
        debateId,
        verdict: AI_MODEL_ERROR_VERDICT,
        confidence: 0,
        agents: [
          {
            name: "CEO Synthesizer",
            position: AI_MODEL_ERROR_VERDICT,
          },
        ],
        runtime: 1,
        cost: 0,
        agentCount: 1,
      },
    };
  }

  const rawVerdict =
    typeof body.verdict === "string" ? body.verdict : "";
  const verdict = sanitizeVerdict(rawVerdict);

  const confidenceRaw = body.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)
      ? Math.max(0, Math.min(100, Math.trunc(confidenceRaw)))
      : 0;

  let agents: DebateEngineAgent[] = [];
  if (Array.isArray(body.agents) && body.agents.length > 0) {
    for (const item of body.agents) {
      if (!isRecord(item)) {
        return { ok: false, error: "Each agent must be an object" };
      }
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const position =
        typeof item.position === "string"
          ? item.position.trim()
          : typeof item.stance === "string"
            ? item.stance.trim()
            : "";
      if (!name) {
        return { ok: false, error: "Each agent requires a name" };
      }
      agents.push({
        name,
        position: position || "No position recorded.",
      });
    }
  } else {
    agents = [
      {
        name: "CEO Synthesizer",
        position: verdict.slice(0, 500),
      },
    ];
  }

  const runtime =
    typeof body.runtime === "number" && Number.isFinite(body.runtime)
      ? Math.max(1, Math.trunc(body.runtime))
      : 1;

  const cost =
    typeof body.cost === "number" && Number.isFinite(body.cost)
      ? body.cost
      : 0;

  const agentCount =
    typeof body.agentCount === "number" && Number.isFinite(body.agentCount)
      ? Math.max(1, Math.trunc(body.agentCount))
      : agents.length;

  return {
    ok: true,
    data: {
      debateId,
      verdict,
      confidence,
      agents,
      runtime,
      cost,
      agentCount,
    },
  };
}

/**
 * Persist canonical debate completion from the Python engine.
 */
export async function persistDebateEngineResult(
  payload: DebateEnginePayload,
): Promise<void> {
  const debateId = payload.debateId;
  const verdict = sanitizeVerdict(payload.verdict);
  const confidence = payload.confidence;
  const agents = payload.agents.length
    ? payload.agents
    : [{ name: "CEO Synthesizer", position: verdict.slice(0, 500) }];
  const { runtime, cost, agentCount } = payload;

  console.log("[persistDebateEngineResult] start", {
    debateId,
    verdictLen: verdict.length,
    confidence,
    agentCount: agents.length,
  });

  const existing = await prisma.swarm.findUnique({
    where: { id: debateId },
    include: { messages: { select: { id: true } } },
  });

  if (!existing) {
    throw new Error(`Debate not found: ${debateId}`);
  }

  const agentProfiles = agents.map((agent) => ({
    name: agent.name,
    role: agent.name,
    position: agent.position,
  }));

  const debateTranscript = agents.map((agent, index) => ({
    agentName: agent.name,
    role: agent.name,
    text: agent.position,
    timestamp: `T+00:0${index}`,
  }));

  const resultData = {
    verdict,
    confidence,
    agents,
  } satisfies Prisma.InputJsonObject;

  await prisma.$transaction(async (tx) => {
    if (existing.messages.length === 0) {
      await tx.message.create({
        data: {
          swarmId: debateId,
          role: "Verdict",
          text: verdict,
        },
      });

      for (const agent of agents) {
        await tx.message.create({
          data: {
            swarmId: debateId,
            role: agent.name,
            text: agent.position,
          },
        });
      }
    }

    await tx.swarm.update({
      where: { id: debateId },
      data: {
        status: "COMPLETED",
        confidence,
        runtime,
        cost,
        agentCount,
        agentProfiles: agentProfiles as Prisma.InputJsonValue,
        debateTranscript: debateTranscript as Prisma.InputJsonValue,
        resultData: resultData as Prisma.InputJsonValue,
      },
    });
  });

  console.log("[persistDebateEngineResult] done", { debateId, status: "COMPLETED" });
}
