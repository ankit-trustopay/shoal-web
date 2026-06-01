import type { EngineIgnitePayload } from "@/lib/engine-payload";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeIgnitePayload(value: unknown): value is EngineIgnitePayload {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.messages) ||
    typeof value.confidence === "number" ||
    Array.isArray(value.evidence) ||
    Array.isArray(value.agentProfiles) ||
    Array.isArray(value.debateTranscript) ||
    typeof value.response === "string"
  );
}

/**
 * Resolve engine ignite fields from webhook body (flat or nested in reportData).
 */
export function extractEngineIgnitePayload(
  body: unknown,
): { swarmId: string; engineData: EngineIgnitePayload } | { error: string } {
  if (!isRecord(body)) {
    return { error: "Request body must be a JSON object" };
  }

  if (!isNonEmptyString(body.swarmId)) {
    return { error: "swarmId is required" };
  }

  const swarmId = body.swarmId.trim();

  if (looksLikeIgnitePayload(body)) {
    return { swarmId, engineData: body as EngineIgnitePayload };
  }

  if (looksLikeIgnitePayload(body.reportData)) {
    return { swarmId, engineData: body.reportData as EngineIgnitePayload };
  }

  if (body.reportData !== undefined && body.reportData !== null) {
    return {
      swarmId,
      engineData: { reportData: body.reportData } as EngineIgnitePayload,
    };
  }

  return { error: "reportData or ignite payload fields are required" };
}
