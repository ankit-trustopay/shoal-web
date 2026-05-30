/**
 * HTTP bridge to the external MiroFish (Python) swarm engine.
 */

export interface MirofishDispatchPayload {
  swarmId: string;
  premise: string;
  agentCount: number;
}

export class MirofishEngineError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "MirofishEngineError";
  }
}

function getEngineBaseUrl(): string {
  const url = process.env.MIROFISH_ENGINE_URL;
  if (!url) {
    throw new MirofishEngineError(
      "MIROFISH_ENGINE_URL is not configured on the server",
    );
  }
  return url.replace(/\/$/, "");
}

/**
 * Notifies MiroFish to start processing a swarm job.
 * Expects the engine to accept POST JSON: { swarmId, premise, agentCount }.
 */
export async function dispatchSwarmToMirofish(
  payload: MirofishDispatchPayload,
): Promise<void> {
  const baseUrl = getEngineBaseUrl();
  const endpoint = `${baseUrl}/swarms/run`;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };

  const apiKey = process.env.MIROFISH_ENGINE_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new MirofishEngineError(
      `MiroFish engine returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      response.status,
    );
  }
}
