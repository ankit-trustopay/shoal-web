import { Prisma } from "@/app/generated/prisma/client";

export type EngineEvidenceItem = {
  title?: string;
  source?: string;
  url?: string;
  snippet?: string;
};

export type EngineIgnitePayload = {
  messages?: { role: string; text: string }[];
  response?: string;
  confidence?: number;
  votesFor?: number;
  votesAgainst?: number;
  votesNeutral?: number;
  runtime?: number;
  cost?: number;
  evidence?: EngineEvidenceItem[];
  agentProfiles?: unknown[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeAgentProfiles(
  items: unknown[] | undefined,
): Prisma.InputJsonValue | undefined {
  if (!items?.length) return undefined;

  const profiles = items
    .filter(isRecord)
    .map((item) => {
      const name =
        trimString(item.name) ??
        trimString(item.Name) ??
        trimString(item.agentName);
      const role =
        trimString(item.role) ??
        trimString(item.Role) ??
        trimString(item.agentRole);

      if (!name) return null;

      const profile: Record<string, unknown> = { name };
      if (role) profile.role = role;

      const age = item.age ?? item.Age;
      if (typeof age === "number" && Number.isFinite(age)) {
        profile.age = Math.trunc(age);
      }

      const location = trimString(item.location) ?? trimString(item.Location);
      if (location) profile.location = location;

      const income = trimString(item.income) ?? trimString(item.Income);
      if (income) profile.income = income;

      const iq = item.iq ?? item.IQ;
      if (typeof iq === "number" && Number.isFinite(iq)) {
        profile.iq = Math.trunc(iq);
      }

      const eq = item.eq ?? item.EQ;
      if (typeof eq === "number" && Number.isFinite(eq)) {
        profile.eq = Math.trunc(eq);
      }

      const riskTolerance =
        trimString(item.riskTolerance) ?? trimString(item.RiskTolerance);
      if (riskTolerance) profile.riskTolerance = riskTolerance;

      const biases = trimString(item.biases) ?? trimString(item.Biases);
      if (biases) profile.biases = biases;

      const backstory =
        trimString(item.backstory) ?? trimString(item.Backstory);
      if (backstory) profile.backstory = backstory;

      return profile;
    })
    .filter((profile): profile is Record<string, unknown> => profile !== null);

  if (!profiles.length) return undefined;

  return profiles as Prisma.InputJsonValue;
}

export function extractAgentProfiles(
  ...sources: unknown[]
): Prisma.InputJsonValue | undefined {
  for (const source of sources) {
    if (Array.isArray(source)) {
      const normalized = normalizeAgentProfiles(source);
      if (normalized !== undefined) return normalized;
    }

    if (isRecord(source) && Array.isArray(source.agentProfiles)) {
      const normalized = normalizeAgentProfiles(source.agentProfiles);
      if (normalized !== undefined) return normalized;
    }
  }

  return undefined;
}

export function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function toOptionalFloat(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function buildSwarmMetadataUpdate(data: EngineIgnitePayload) {
  const update: {
    confidence?: number;
    votesFor?: number;
    votesAgainst?: number;
    votesNeutral?: number;
    runtime?: number;
    cost?: number;
    agentProfiles?: Prisma.InputJsonValue;
  } = {};

  const confidence = toOptionalInt(data.confidence);
  const votesFor = toOptionalInt(data.votesFor);
  const votesAgainst = toOptionalInt(data.votesAgainst);
  const votesNeutral = toOptionalInt(data.votesNeutral);
  const runtime = toOptionalInt(data.runtime);
  const cost = toOptionalFloat(data.cost);
  const agentProfiles = normalizeAgentProfiles(data.agentProfiles);

  if (confidence !== undefined) update.confidence = confidence;
  if (votesFor !== undefined) update.votesFor = votesFor;
  if (votesAgainst !== undefined) update.votesAgainst = votesAgainst;
  if (votesNeutral !== undefined) update.votesNeutral = votesNeutral;
  if (runtime !== undefined) update.runtime = runtime;
  if (cost !== undefined) update.cost = cost;
  if (agentProfiles !== undefined) update.agentProfiles = agentProfiles;

  return update;
}

export function normalizeEvidenceItems(
  items: EngineEvidenceItem[] | undefined,
): { title: string; source: string; url: string; snippet: string }[] {
  if (!items?.length) return [];

  return items
    .map((item) => ({
      title: item.title?.trim() ?? "",
      source: item.source?.trim() ?? "",
      url: item.url?.trim() ?? "",
      snippet: item.snippet?.trim() ?? "",
    }))
    .filter(
      (item) =>
        item.title.length > 0 &&
        item.source.length > 0 &&
        item.url.length > 0 &&
        item.snippet.length > 0,
    );
}
