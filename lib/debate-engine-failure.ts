import { AI_MODEL_ERROR_VERDICT } from "@/lib/debate-constants";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True when the engine could not produce a usable executive report.
 * Matches shoal-ui debateResult guards + Python fallback strings.
 */
export function isAiModelErrorVerdict(verdict: string | null | undefined): boolean {
  if (!verdict?.trim()) return true;
  const trimmed = verdict.trim();
  return (
    trimmed === AI_MODEL_ERROR_VERDICT ||
    trimmed.startsWith("Error: The AI model failed to generate a response")
  );
}

export function isEngineDeliberationFailureVerdict(
  verdict: string | null | undefined,
): boolean {
  if (isAiModelErrorVerdict(verdict)) return true;
  if (!verdict?.trim()) return true;

  const lower = verdict.trim().toLowerCase();
  return (
    lower.includes("could not produce a verdict") ||
    lower.includes("critical error during deliberation") ||
    lower.includes("no verdict produced") ||
    lower.includes("deliberation did not complete") ||
    lower.includes("deliberation failed") ||
    lower.startsWith("error:") ||
    /^engine (deliberation )?failed\b/.test(lower)
  );
}

/**
 * Detect debate webhook payloads that should trigger FAILED + auto-refund.
 */
export function isDebateWebhookFailure(
  body: Record<string, unknown>,
  verdict?: string,
): boolean {
  const status =
    typeof body.status === "string" ? body.status.trim().toLowerCase() : "";

  if (status === "failed" || status === "failure") {
    return true;
  }

  if (body.engine_failed === true || body.engineFailed === true) {
    return true;
  }

  if (typeof body.error === "string" && body.error.trim().length > 0) {
    return true;
  }

  if (body.error === true) {
    return true;
  }

  const resolvedVerdict =
    verdict ??
    (typeof body.verdict === "string" ? body.verdict : undefined);

  return isEngineDeliberationFailureVerdict(resolvedVerdict);
}

export function resolveWebhookFailureMessage(
  body: Record<string, unknown>,
  verdict?: string,
): string {
  if (typeof body.error === "string" && body.error.trim()) {
    return body.error.trim().slice(0, 2000);
  }

  const v = verdict?.trim() || (typeof body.verdict === "string" ? body.verdict.trim() : "");
  if (v) return v.slice(0, 2000);

  return "Engine deliberation failed";
}

export function swarmResultIndicatesEngineFailure(resultData: unknown): boolean {
  if (!isRecord(resultData)) return false;
  const verdict =
    typeof resultData.verdict === "string" ? resultData.verdict : null;
  return isEngineDeliberationFailureVerdict(verdict);
}
