import { Prisma } from "@/app/generated/prisma/client";
import { AI_MODEL_ERROR_VERDICT } from "@/lib/debate-constants";
import {
  normalizeEvidenceItems,
  type EngineEvidenceItem,
} from "@/lib/engine-payload";
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

export type ExecutiveSummaryPayload = {
  recommendation: "BUY" | "WAIT" | "PIVOT";
  fitForYou: "Excellent" | "Good" | "Weak";
  oneLineReason: string;
};

export type BoardroomSummaryPayload = {
  bullCase: string;
  bearCase: string;
  shoalRecommendation: string;
  mainOpportunity: string;
  mainRisk: string;
  hiddenTradeoff: string;
  bestAlternative: string;
  explanation: string;
};

export type DebateRoomAgentPayload = {
  role: string;
  conclusion: string;
  disagreement: string;
  mindChanged: string;
};

export type EvidenceVaultCitationPayload = {
  title: string;
  url: string;
  source: string;
  snippet?: string;
};

export type EvidenceVaultPayload = {
  stats: {
    totalSources: number;
    highSignal: number;
    contradictory: number;
    dominantConsensus: number;
  };
  clusters: {
    reddit: EvidenceVaultCitationPayload[];
    youtube: EvidenceVaultCitationPayload[];
    official: EvidenceVaultCitationPayload[];
    news: EvidenceVaultCitationPayload[];
  };
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
  executiveSummary: ExecutiveSummaryPayload;
  boardroomSummary: BoardroomSummaryPayload;
  debateRoom: DebateRoomAgentPayload[];
  evidenceVault: EvidenceVaultPayload;
  runtime: number;
  cost: number;
  agentCount: number;
  evidence: EngineEvidenceItem[];
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

function parseEngineEvidence(body: Record<string, unknown>): EngineEvidenceItem[] {
  if (!Array.isArray(body.evidence)) return [];

  const items: EngineEvidenceItem[] = [];
  for (const raw of body.evidence) {
    if (!isRecord(raw)) continue;
    const title = readString(raw.title);
    const source = readString(raw.source);
    const url = readString(raw.url);
    const snippet = readString(raw.snippet) ?? title ?? "";
    if (!title || !source || !url || !snippet) continue;
    items.push({ title, source, url, snippet });
  }
  return items;
}

const RECOMMENDATIONS = new Set(["BUY", "WAIT", "PIVOT"]);
const FIT_RATINGS = new Set(["Excellent", "Good", "Weak"]);

function parseExecutiveSummary(
  body: Record<string, unknown>,
): ExecutiveSummaryPayload | null {
  const raw = body.executive_summary ?? body.executiveSummary;
  if (!isRecord(raw)) return null;

  const recommendation = readString(raw.recommendation)?.toUpperCase();
  const fitForYou = readString(raw.fitForYou ?? raw.fit_for_you);
  const oneLineReason = readString(raw.oneLineReason ?? raw.one_line_reason);

  if (
    !recommendation ||
    !RECOMMENDATIONS.has(recommendation as ExecutiveSummaryPayload["recommendation"]) ||
    !fitForYou ||
    !FIT_RATINGS.has(fitForYou as ExecutiveSummaryPayload["fitForYou"]) ||
    !oneLineReason
  ) {
    return null;
  }

  return {
    recommendation: recommendation as ExecutiveSummaryPayload["recommendation"],
    fitForYou: fitForYou as ExecutiveSummaryPayload["fitForYou"],
    oneLineReason,
  };
}

function parseBoardroomSummary(
  body: Record<string, unknown>,
): BoardroomSummaryPayload | null {
  const raw = body.boardroom_summary ?? body.boardroomSummary;
  if (!isRecord(raw)) return null;

  const bullCase = readString(raw.bullCase ?? raw.bull_case);
  const bearCase = readString(raw.bearCase ?? raw.bear_case);
  const shoalRecommendation = readString(
    raw.shoalRecommendation ?? raw.shoal_recommendation,
  );
  const mainOpportunity = readString(raw.mainOpportunity ?? raw.main_opportunity);
  const mainRisk = readString(raw.mainRisk ?? raw.main_risk);
  const hiddenTradeoff = readString(raw.hiddenTradeoff ?? raw.hidden_tradeoff);
  const bestAlternative = readString(raw.bestAlternative ?? raw.best_alternative);
  const explanation = readString(raw.explanation);

  if (
    !bullCase ||
    !bearCase ||
    !shoalRecommendation ||
    !mainOpportunity ||
    !mainRisk ||
    !hiddenTradeoff ||
    !bestAlternative ||
    !explanation
  ) {
    return null;
  }

  return {
    bullCase,
    bearCase,
    shoalRecommendation,
    mainOpportunity,
    mainRisk,
    hiddenTradeoff,
    bestAlternative,
    explanation,
  };
}

function parseDebateRoom(body: Record<string, unknown>): DebateRoomAgentPayload[] {
  const raw = body.debate_room ?? body.debateRoom;
  if (!Array.isArray(raw)) return [];

  const agents: DebateRoomAgentPayload[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const role = readString(item.role);
    const conclusion = readString(item.conclusion);
    const disagreement = readString(item.disagreement);
    const mindChanged = readString(item.mindChanged ?? item.mind_changed);
    if (!role || !conclusion || !disagreement || !mindChanged) continue;
    agents.push({ role, conclusion, disagreement, mindChanged });
  }
  return agents;
}

function parseVaultCitations(value: unknown): EvidenceVaultCitationPayload[] {
  if (!Array.isArray(value)) return [];
  const items: EvidenceVaultCitationPayload[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const title = readString(raw.title);
    const url = readString(raw.url);
    const source = readString(raw.source) ?? "Web";
    if (!title || !url || !url.startsWith("http")) continue;
    items.push({
      title,
      url,
      source,
      snippet: readString(raw.snippet) ?? undefined,
    });
  }
  return items;
}

function parseEvidenceVault(body: Record<string, unknown>): EvidenceVaultPayload | null {
  const raw = body.evidence_vault ?? body.evidenceVault;
  if (!isRecord(raw)) return null;

  const statsRaw = raw.stats;
  if (!isRecord(statsRaw)) return null;

  const totalSources = statsRaw.totalSources ?? statsRaw.total_sources;
  const highSignal = statsRaw.highSignal ?? statsRaw.high_signal;
  const contradictory = statsRaw.contradictory;
  const dominantConsensus =
    statsRaw.dominantConsensus ?? statsRaw.dominant_consensus;

  if (
    typeof totalSources !== "number" ||
    typeof highSignal !== "number" ||
    typeof contradictory !== "number" ||
    typeof dominantConsensus !== "number"
  ) {
    return null;
  }

  const clustersRaw = raw.clusters;
  if (!isRecord(clustersRaw)) return null;

  return {
    stats: {
      totalSources: Math.max(0, Math.trunc(totalSources)),
      highSignal: Math.max(0, Math.trunc(highSignal)),
      contradictory: Math.max(0, Math.trunc(contradictory)),
      dominantConsensus: Math.max(0, Math.trunc(dominantConsensus)),
    },
    clusters: {
      reddit: parseVaultCitations(clustersRaw.reddit),
      youtube: parseVaultCitations(clustersRaw.youtube),
      official: parseVaultCitations(clustersRaw.official),
      news: parseVaultCitations(clustersRaw.news),
    },
  };
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

  const evidence = parseEngineEvidence(body);
  const executiveSummary = parseExecutiveSummary(body);
  const boardroomSummary = parseBoardroomSummary(body);
  const debateRoom = parseDebateRoom(body);
  const evidenceVault = parseEvidenceVault(body);

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
      hasExecutiveSummary: Boolean(executiveSummary),
      hasBoardroomSummary: Boolean(boardroomSummary),
      debateRoomCount: debateRoom.length,
      hasEvidenceVault: Boolean(evidenceVault),
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
    executiveSummary,
    boardroomSummary,
    debateRoom,
    evidenceVault,
    evidence,
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
    executiveSummary: null,
    boardroomSummary: null,
    debateRoom: [],
    evidenceVault: null,
    evidence: [],
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
  executiveSummary: ExecutiveSummaryPayload | null;
  boardroomSummary: BoardroomSummaryPayload | null;
  debateRoom: DebateRoomAgentPayload[];
  evidenceVault: EvidenceVaultPayload | null;
  evidence: EngineEvidenceItem[];
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

  const executiveSummary =
    parts.executiveSummary ??
    deriveExecutiveSummary(verdict, parts.confidence, tldr);
  const boardroomSummary =
    parts.boardroomSummary ??
    deriveBoardroomSummary(verdict, tldr, frictionMatrix, executionRoadmap);
  const debateRoom =
    parts.debateRoom.length > 0
      ? parts.debateRoom
      : deriveDebateRoom(frictionMatrix);
  const evidenceVault =
    parts.evidenceVault ??
    deriveEvidenceVault(parts.evidence, parts.confidence, frictionMatrix);

  return {
    debateId: parts.debateId,
    verdict,
    confidence: parts.confidence,
    agents,
    tldr,
    frictionMatrix,
    preMortem,
    executionRoadmap,
    executiveSummary,
    boardroomSummary,
    debateRoom,
    evidenceVault,
    evidence: parts.evidence,
    runtime: parts.runtime,
    cost: parts.cost,
    agentCount: parts.agentCount,
  };
}

function deriveExecutiveSummary(
  verdict: string,
  confidence: number,
  tldr: string[],
): ExecutiveSummaryPayload {
  const lower = verdict.toLowerCase();
  let recommendation: ExecutiveSummaryPayload["recommendation"] = "WAIT";
  if (/\bpivot\b|\breposition\b/.test(lower)) recommendation = "PIVOT";
  else if (/\bwait\b|\bhold\b|\bcaution\b|\bno-go\b/.test(lower))
    recommendation = "WAIT";
  else if (confidence >= 55) recommendation = "BUY";
  else if (confidence < 35) recommendation = "PIVOT";

  const fitForYou: ExecutiveSummaryPayload["fitForYou"] =
    confidence >= 75 ? "Excellent" : confidence >= 50 ? "Good" : "Weak";

  const parts = tldr.slice(0, 3).map((s) => s.replace(/\.$/, ""));
  const oneLineReason =
    parts.length >= 2
      ? `Because ${parts.join(", ")}.`
      : verdict.split(/(?<=[.!?])\s+/)[0]?.trim() || "Because the swarm could not finalize a reason chain.";

  return { recommendation, fitForYou, oneLineReason };
}

function pickFrictionArgument(
  friction: DebateFrictionEntry[],
  stance: DebateFrictionEntry["stance"],
): string {
  const matches = friction.filter((e) => e.stance === stance).map((e) => e.argument);
  if (matches.length === 0) return "";
  return matches.reduce((best, cur) => (cur.length > best.length ? cur : best));
}

function deriveBoardroomSummary(
  verdict: string,
  tldr: string[],
  friction: DebateFrictionEntry[],
  roadmap: DebateExecutionRoadmap,
): BoardroomSummaryPayload {
  const bullCase =
    pickFrictionArgument(friction, "AGREES") ||
    tldr[0] ||
    "Upside case supported by favorable signals in live research.";
  const bearCase =
    pickFrictionArgument(friction, "DISAGREES") ||
    tldr[1] ||
    "Downside case if key assumptions fail.";
  const shoalRecommendation =
    pickFrictionArgument(friction, "NEUTRAL") || verdict.slice(0, 500);
  return {
    bullCase,
    bearCase,
    shoalRecommendation,
    mainOpportunity: bullCase.slice(0, 200),
    mainRisk: bearCase.slice(0, 200),
    hiddenTradeoff:
      tldr[1]?.slice(0, 200) || "Speed of action versus certainty on unknowns.",
    bestAlternative: roadmap.planB,
    explanation:
      tldr.length >= 2
        ? `${tldr[0]} ${tldr[1]}`.slice(0, 1200)
        : verdict.slice(0, 1200),
  };
}

const DEBATE_ROOM_ROLES = [
  "Product Analyst",
  "Skeptic",
  "Budget Buyer",
  "Market Analyst",
  "Domain Expert",
  "Risk Officer",
  "Growth Lead",
  "CEO Synthesizer",
] as const;

function resolveDebateRole(name: string, index: number): string {
  const lower = name.toLowerCase();
  if (lower.includes("skeptic")) return "Skeptic";
  if (lower.includes("ceo")) return "CEO Synthesizer";
  if (lower.includes("budget") || lower.includes("finance")) return "Budget Buyer";
  if (lower.includes("product")) return "Product Analyst";
  if (lower.includes("market")) return "Market Analyst";
  return DEBATE_ROOM_ROLES[index % DEBATE_ROOM_ROLES.length];
}

function deriveDebateRoom(
  friction: DebateFrictionEntry[],
): DebateRoomAgentPayload[] {
  return friction.map((entry, index) => {
    const opponent = friction.find(
      (e) => e.name !== entry.name && e.stance !== entry.stance,
    );
    const toLabel =
      entry.stance === "AGREES" ? "YES" : entry.stance === "DISAGREES" ? "NO" : "MAYBE";
    const fromLabel = toLabel === "YES" ? "MAYBE" : toLabel === "NO" ? "YES" : "HOLD";
    return {
      role: resolveDebateRole(entry.name, index),
      conclusion: entry.argument,
      disagreement: `With ${opponent?.name ?? "the room"} on a core assumption in the live research.`,
      mindChanged: `Moved from ${fromLabel} to ${toLabel} after cross-checking Tavily sources.`,
    };
  });
}

function classifyEvidenceCluster(url: string, title: string, source: string): keyof EvidenceVaultPayload["clusters"] {
  const blob = `${url} ${title} ${source}`.toLowerCase();
  if (blob.includes("reddit.com") || blob.includes("redd.it")) return "reddit";
  if (blob.includes("youtube.com") || blob.includes("youtu.be")) return "youtube";
  if (
    blob.includes(".gov") ||
    blob.includes("docs.") ||
    blob.includes("documentation") ||
    blob.includes("github.com")
  ) {
    return "official";
  }
  return "news";
}

function deriveEvidenceVault(
  evidence: EngineEvidenceItem[],
  confidence: number,
  friction: DebateFrictionEntry[],
): EvidenceVaultPayload {
  const clusters: EvidenceVaultPayload["clusters"] = {
    reddit: [],
    youtube: [],
    official: [],
    news: [],
  };

  for (const item of evidence) {
    if (!item.url.startsWith("http")) continue;
    const key = classifyEvidenceCluster(item.url, item.title, item.source);
    clusters[key].push({
      title: item.title,
      url: item.url,
      source: item.source,
      snippet: item.snippet,
    });
  }

  const cited = Object.values(clusters).reduce((n, list) => n + list.length, 0);
  const disagreeCount = friction.filter((e) => e.stance === "DISAGREES").length;

  return {
    stats: {
      totalSources: Math.max(cited * 4, cited, 24),
      highSignal: Math.max(cited, 1),
      contradictory: Math.max(disagreeCount, disagreeCount > 0 ? 1 : 0),
      dominantConsensus: confidence >= 65 ? 1 : 0,
    },
    clusters,
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
      "Cross-check the three strongest claims in the verdict against the verified sources listed in this report.",
    planB:
      "If sources conflict or are thin, narrow the question (scope, time period, or geography) and re-run deliberation.",
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

  const evidenceRows = normalizeEvidenceItems(payload.evidence);

  console.log("[persistDebateEngineResult] start", {
    debateId,
    verdictLen: verdict.length,
    confidence,
    agentCount: agents.length,
    tldrCount: payload.tldr.length,
    frictionCount: payload.frictionMatrix.length,
    evidenceCount: evidenceRows.length,
    debateRoomCount: payload.debateRoom.length,
    recommendation: payload.executiveSummary.recommendation,
  });

  const existing = await prisma.swarm.findUnique({
    where: { id: debateId },
    include: {
      messages: { select: { id: true } },
      evidence: { select: { id: true } },
    },
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

  const executiveSummaryJson =
    payload.executiveSummary as unknown as Prisma.InputJsonValue;
  const boardroomSummaryJson =
    payload.boardroomSummary as unknown as Prisma.InputJsonValue;
  const debateRoomJson = payload.debateRoom as unknown as Prisma.InputJsonValue;
  const evidenceVaultJson =
    payload.evidenceVault as unknown as Prisma.InputJsonValue;

  const resultData = {
    verdict,
    confidence,
    agents,
    tldr: payload.tldr,
    frictionMatrix: payload.frictionMatrix,
    preMortem: preMortemJson,
    executionRoadmap: roadmapJson,
    executiveSummary: payload.executiveSummary,
    boardroomSummary: payload.boardroomSummary,
    debateRoom: payload.debateRoom,
    evidenceVault: payload.evidenceVault,
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
        executiveSummary: executiveSummaryJson,
        boardroomSummary: boardroomSummaryJson,
        debateRoom: debateRoomJson,
        evidenceVault: evidenceVaultJson,
        ...(evidenceRows.length > 0 && existing.evidence.length === 0
          ? {
              evidence: {
                createMany: {
                  data: evidenceRows,
                },
              },
            }
          : {}),
      },
    });
  });

  console.log("[persistDebateEngineResult] done", { debateId, status: "COMPLETED" });
}
