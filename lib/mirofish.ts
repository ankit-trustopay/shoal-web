/**
 * HTTP bridge to the Shoal AI Engine (FastAPI on Railway).
 */

export interface IgniteEnginePayload {
  swarmId: string;
  premise: string;
  swarmSize?: number;
  agentCount?: number;
  model?: string;
  model_tier?: string;
  target_audience?: string;
  price_point?: string;
  marketing_budget?: string;
}

function resolveEngineBaseUrl(): string {
  const baseUrl =
    process.env.MIROFISH_ENGINE_URL?.trim().replace(/\/$/, "") ||
    process.env.ENGINE_URL?.trim().replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error("MIROFISH_ENGINE_URL (or ENGINE_URL) is not configured");
  }

  return baseUrl;
}

function buildEngineHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const apiKey = process.env.MIROFISH_ENGINE_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

export interface DebateEnginePayload {
  debate_id: string;
  query: string;
  agent_count: number;
  model_mix: number;
}

export async function igniteEngine(
  payload: IgniteEnginePayload,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const baseUrl = resolveEngineBaseUrl();
  const timeoutMs = options?.timeoutMs ?? 30_000;

  return fetch(`${baseUrl}/ignite`, {
    method: "POST",
    headers: buildEngineHeaders(),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/**
 * POST /debate on the Python engine (production debate loop).
 */
export async function startDebateEngine(
  payload: DebateEnginePayload,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const baseUrl = resolveEngineBaseUrl();
  const timeoutMs = options?.timeoutMs ?? 30_000;

  const body = {
    debate_id: payload.debate_id,
    query: payload.query,
    agent_count: payload.agent_count,
    model_mix: payload.model_mix,
  };

  console.log("[startDebateEngine] POST", `${baseUrl}/debate`, body);

  return fetch(`${baseUrl}/debate`, {
    method: "POST",
    headers: buildEngineHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
