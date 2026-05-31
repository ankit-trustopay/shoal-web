export interface CreateSwarmInput {
  premise: string;
  agentCount: number;
}

export interface EngineWebhookInput {
  swarmId: string;
  reportData: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseCreateSwarmBody(
  body: unknown,
): { ok: true; data: CreateSwarmInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const { premise, agentCount } = body as Record<string, unknown>;

  if (!isNonEmptyString(premise)) {
    return { ok: false, error: "premise is required" };
  }

  if (typeof agentCount !== "number" || !Number.isInteger(agentCount)) {
    return { ok: false, error: "agentCount must be an integer" };
  }

  if (agentCount < 1 || agentCount > 10_000) {
    return { ok: false, error: "agentCount must be between 1 and 10000" };
  }

  return {
    ok: true,
    data: {
      premise: premise.trim(),
      agentCount,
    },
  };
}

export function parseEngineWebhookBody(
  body: unknown,
): { ok: true; data: EngineWebhookInput } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Request body must be a JSON object" };
  }

  const { swarmId, reportData } = body as Record<string, unknown>;

  if (!isNonEmptyString(swarmId)) {
    return { ok: false, error: "swarmId is required" };
  }

  if (reportData === undefined || reportData === null) {
    return { ok: false, error: "reportData is required" };
  }

  return {
    ok: true,
    data: {
      swarmId: swarmId.trim(),
      reportData,
    },
  };
}
