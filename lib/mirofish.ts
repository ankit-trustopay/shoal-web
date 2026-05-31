/**
 * HTTP bridge to the Shoal AI Engine (FastAPI on Railway).
 */

export interface IgniteEnginePayload {
  swarmId: string;
  premise: string;
  swarmSize?: number;
  agentCount?: number;
  model?: string;
}

export async function igniteEngine(
  payload: IgniteEnginePayload,
  options?: { timeoutMs?: number },
): Promise<Response> {
  const baseUrl = process.env.MIROFISH_ENGINE_URL?.trim().replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error("MIROFISH_ENGINE_URL is not configured");
  }

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const apiKey = process.env.MIROFISH_ENGINE_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const timeoutMs = options?.timeoutMs ?? 30_000;

  return fetch(`${baseUrl}/ignite`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs),
  });
}
