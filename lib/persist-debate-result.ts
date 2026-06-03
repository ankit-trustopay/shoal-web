import { Prisma } from "@/app/generated/prisma/client";
import { AI_MODEL_ERROR_VERDICT } from "@/lib/debate-constants";
import { prisma } from "@/lib/prisma";

export type DebateEngineAgent = {
  name: string;
  position: string;
};

export type DebateFrictionEntry = {
  name: string;
  stance: "AGREES" | "DISAGREES" | "NEUTRAL";
  argument: string;
};

export type DebatePreMortem = {
  failureModes: string[];
  criticalUnknowns: string[];
};

export type DebateExecutionRoadmap = {
  immediateAction: string;
  planB: string;
};

export type DebateEnginePayload = {
  debateId: string;
  verdict: string;
  confidence: number;
  agents: DebateEngineAgent[];
  tldr: string[];
  frictionMatrix: DebateFrictionEntry[];
  preMortem: DebatePreMortem;
  executionRoadmap: DebateExecutionRoadmap;
  runtime: number;
  cost: number;
  agentCount: number;
};

const VALID_STANCES = new Set(["AGREES", "DISAGREES", "NEUTRAL"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function normalizeStance(value: unknown): DebateFrictionEntry["stance"] | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  if (VALID_STANCES.has(upper)) {
    return upper as DebateFrictionEntry["stance"];
  }
  const lower = value.trim().toLowerCase();
  if (lower === "agrees" || lower === "agree") return "AGREES";
  if (lower === "disagrees" || lower === "disagree") return "DISAGREES";
  if (lower === "neutral") return "NEUTRAL";
  return null;
}

function parseFrictionMatrix(body: Record<string, unknown>): DebateFrictionEntry[] {
  const raw = body.friction_matrix ?? body.frictionMatrix;

  if (!Array.isArray(raw)) return [];

  const entries: DebateFrictionEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const name = readString(item.name);
    const argument =
      readString(item.argument) ??
      readString(item.summary) ??
      readString(item.position);
    const stance = normalizeStance(item.stance);
    if (!name || !argument || !stance) continue;
    entries.push({ name, stance, argument });
  }
  return entries;
}

function parsePreMortem(body: Record<string, unknown>): DebatePreMortem | null {
  const raw = body.pre_mortem ?? body.preMortem;
  if (!isRecord(raw)) return null;

  const failureModes = readStringArray(
    raw.failure_modes ?? raw.failureModes ?? raw.topFailureModes,
  );
  const criticalUnknowns = readStringArray(
    raw.critical_unknowns ?? raw.criticalUnknowns ?? raw.unknowns,
  );

  if (failureModes.length === 0 || criticalUnknowns.length === 0) {
    return null;
  }

  return { failureModes, criticalUnknowns };
}

function parseExecutionRoadmap(
  body: Record<string, unknown>,
): DebateExecutionRoadmap | null {
  const raw = body.execution_roadmap ?? body.executionRoadmap;
  if (!isRecord(raw)) return null;

  const immediateAction =
    readString(raw.immediate_action) ?? readString(raw.immediateAction);
  const planB = readString(raw.plan_b) ?? readString(raw.planB);

  if (!immediateAction || !planB) return null;
  return { immediateAction, planB };
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
      data: buildFallbackPayload(debateId, AI_MODEL_ERROR_VERDICT),
    };
  }

  const rawVerdict = typeof body.verdict === "string" ? body.verdict : "";
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

  const tldr = readStringArray(body.tldr);
  const frictionMatrix = parseFrictionMatrix(body);
  const preMortem = parsePreMortem(body);
  const executionRoadmap = parseExecutionRoadmap(body);

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

  const hasExecutiveFields =
    tldr.length >= 3 &&
    frictionMatrix.length > 0 &&
    preMortem !== null &&
    executionRoadmap !== null;

  if (!hasExecutiveFields) {
    console.warn("[persist-debate-result] missing executive fields; using fallbacks", {
      debateId,
      tldrLen: tldr.length,
      frictionLen: frictionMatrix.length,
      hasPreMortem: Boolean(preMortem),
      hasRoadmap: Boolean(executionRoadmap),
    });
  }

  const payload = buildPayloadFromParts({
    debateId,
    verdict,
    confidence,
    agents,
    tldr,
    frictionMatrix,
    preMortem,
    executionRoadmap,
    runtime,
    cost,
    agentCount,
  });

  return { ok: true, data: payload };
}

function buildFallbackPayload(
  debateId: string,
  verdict: string,
): DebateEnginePayload {
  return buildPayloadFromParts({
    debateId,
    verdict,
    confidence: 0,
    agents: [
      { name: "CEO Synthesizer", position: verdict.slice(0, 500) },
    ],
    tldr: [],
    frictionMatrix: [],
    preMortem: null,
    executionRoadmap: null,
    runtime: 1,
    cost: 0,
    agentCount: 1,
  });
}

function buildPayloadFromParts(parts: {
  debateId: string;
  verdict: string;
  confidence: number;
  agents: DebateEngineAgent[];
  tldr: string[];
  frictionMatrix: DebateFrictionEntry[];
  preMortem: DebatePreMortem | null;
  executionRoadmap: DebateExecutionRoadmap | null;
  runtime: number;
  cost: number;
  agentCount: number;
}): DebateEnginePayload {
  const verdict = sanitizeVerdict(parts.verdict);
  const agents = parts.agents.length
    ? parts.agents
    : [{ name: "CEO Synthesizer", position: verdict.slice(0, 500) }];

  const tldr =
    parts.tldr.length >= 3
      ? parts.tldr.slice(0, 5)
      : deriveTldr(verdict, agents);

  const frictionMatrix =
    parts.frictionMatrix.length > 0
      ? parts.frictionMatrix
      : deriveFrictionMatrix(agents);

  const preMortem = parts.preMortem ?? derivePreMortem(verdict);
  const executionRoadmap =
    parts.executionRoadmap ?? deriveExecutionRoadmap(verdict);

  return {
    debateId: parts.debateId,
    verdict,
    confidence: parts.confidence,
    agents,
    tldr,
    frictionMatrix,
    preMortem,
    executionRoadmap,
    runtime: parts.runtime,
    cost: parts.cost,
    agentCount: parts.agentCount,
  };
}

function deriveTldr(verdict: string, agents: DebateEngineAgent[]): string[] {
  const fromVerdict = verdict
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);
  if (fromVerdict.length >= 3) return fromVerdict.slice(0, 3);

  const fromAgents = agents
    .map((a) => `${a.name}: ${a.position}`)
    .filter((s) => s.length > 15);
  const merged = [...fromVerdict, ...fromAgents];
  while (merged.length < 3) {
    merged.push(
      "Swarm synthesis weighted market evidence against downside scenarios.",
    );
  }
  return merged.slice(0, 3);
}

function inferStanceFromText(
  text: string,
  index: number,
): DebateFrictionEntry["stance"] {
  const lower = text.toLowerCase();
  if (
    /\b(against|oppose|skeptic|risk|concern|unlikely|reject|do not|caution)\b/.test(
      lower,
    )
  ) {
    return "DISAGREES";
  }
  if (
    /\b(support|favor|agree|recommend|proceed|positive|viable|bullish)\b/.test(
      lower,
    )
  ) {
    return "AGREES";
  }
  if (index === 1) return "DISAGREES";
  if (index === 0) return "AGREES";
  return "NEUTRAL";
}

function deriveFrictionMatrix(agents: DebateEngineAgent[]): DebateFrictionEntry[] {
  if (agents.length === 0) {
    return [
      {
        name: "Market Researcher",
        stance: "AGREES",
        argument:
          "Market tailwinds support moving forward with disciplined execution.",
      },
      {
        name: "Skeptical Debater",
        stance: "DISAGREES",
        argument:
          "Unit economics and competition may erode returns within 12 months.",
      },
      {
        name: "CEO Synthesizer",
        stance: "NEUTRAL",
        argument:
          "Proceed only if near-term KPIs are gated and downside triggers are defined.",
      },
    ];
  }

  return agents.slice(0, 5).map((agent, index) => ({
    name: agent.name,
    stance: inferStanceFromText(`${agent.name} ${agent.position}`, index),
    argument:
      agent.position.length > 500
        ? `${agent.position.slice(0, 497)}…`
        : agent.position,
  }));
}

function derivePreMortem(verdict: string): DebatePreMortem {
  return {
    failureModes: [
      "Demand assumptions prove optimistic within two quarters of launch.",
      "Customer acquisition costs exceed modeled payback under competitive pressure.",
      "Regulatory or supply-chain friction delays go-to-market timeline.",
      verdict.length > 40
        ? `Verdict risk: ${verdict.slice(0, 120)}…`
        : "Key partnership or channel dependency fails to materialize on schedule.",
    ].slice(0, 4),
    criticalUnknowns: [
      "Verified willingness-to-pay across the target segment at scale.",
      "True customer acquisition cost under current channel mix.",
      "Regulatory or compliance exposure in priority geographies.",
      "Speed and cost of the critical path hire or vendor dependency.",
    ],
  };
}

function deriveExecutionRoadmap(verdict: string): DebateExecutionRoadmap {
  return {
    immediateAction:
      "Validate the top three assumptions with a 48-hour customer signal sprint (pricing, channel, and conversion).",
    planB:
      "Pivot to a narrower ICP with a lower CAC wedge offer while pausing full-scale launch spend.",
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
    tldrCount: payload.tldr.length,
    frictionCount: payload.frictionMatrix.length,
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

  const tldrJson = payload.tldr as Prisma.InputJsonValue;
  const frictionJson = payload.frictionMatrix.map((entry) => ({
    name: entry.name,
    stance: entry.stance,
    argument: entry.argument,
  })) as Prisma.InputJsonValue;
  const preMortemJson = {
    failureModes: payload.preMortem.failureModes,
    criticalUnknowns: payload.preMortem.criticalUnknowns,
  } satisfies Prisma.InputJsonObject;
  const roadmapJson = {
    immediateAction: payload.executionRoadmap.immediateAction,
    planB: payload.executionRoadmap.planB,
  } satisfies Prisma.InputJsonObject;

  const resultData = {
    verdict,
    confidence,
    agents,
    tldr: payload.tldr,
    frictionMatrix: payload.frictionMatrix,
    preMortem: preMortemJson,
    executionRoadmap: roadmapJson,
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
        tldr: tldrJson,
        frictionMatrix: frictionJson,
        preMortem: preMortemJson as Prisma.InputJsonValue,
        executionRoadmap: roadmapJson as Prisma.InputJsonValue,
      },
    });
  });

  console.log("[persistDebateEngineResult] done", { debateId, status: "COMPLETED" });
}
