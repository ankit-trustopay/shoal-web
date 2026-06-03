import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-response";
import { extractEngineIgnitePayload } from "@/lib/parse-engine-webhook";
import { persistEngineIgniteResult } from "@/lib/persist-engine-ignite";
import {
  parseDebateEnginePayload,
  persistDebateEngineResult,
} from "@/lib/persist-debate-result";
import { markSwarmFailedAndRefund } from "@/lib/refund-failed-swarm";
import { prisma } from "@/lib/prisma";
import { isWebhookAuthorized } from "@/lib/webhook-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * POST /api/webhooks/engine
 * Engine callbacks: debate completion, ignite completion, or failure.
 */
export async function POST(request: NextRequest) {
  console.log("[webhook/engine] POST received");

  if (!isWebhookAuthorized(request)) {
    console.warn("[webhook/engine] unauthorized");
    return jsonError(
      "Invalid or missing x-engine-webhook-secret",
      401,
      undefined,
      request,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    console.error("[webhook/engine] invalid JSON");
    return jsonError("Invalid JSON body", 400);
  }

  if (!isRecord(body)) {
    return jsonError("Body must be a JSON object", 400);
  }

  const traceId =
    (isNonEmptyString(body.debate_id) && body.debate_id) ||
    (isNonEmptyString(body.debateId) && body.debateId) ||
    (isNonEmptyString(body.swarmId) && body.swarmId) ||
    "unknown";

  console.log("[webhook/engine] payload", {
    traceId,
    status: body.status,
    hasVerdict: typeof body.verdict === "string",
    verdictLen:
      typeof body.verdict === "string" ? body.verdict.trim().length : 0,
  });

  // --- Engine failure (refund path) ---
  if (body.status === "FAILED") {
    const swarmId =
      (isNonEmptyString(body.swarmId) && body.swarmId.trim()) ||
      (isNonEmptyString(body.debate_id) && body.debate_id.trim()) ||
      "";

    if (!swarmId) {
      return jsonError("swarmId or debate_id is required for FAILED", 400);
    }

    const errorMessage =
      typeof body.error === "string" && body.error.trim().length > 0
        ? body.error.trim()
        : "Engine deliberation failed";

    console.log("[webhook/engine] FAILED", { swarmId, errorMessage });

    try {
      const result = await markSwarmFailedAndRefund(swarmId, errorMessage);

      if (!result.ok) {
        if (result.reason === "not_found") {
          return jsonError("Swarm not found", 404);
        }
        return jsonError("Swarm already completed; refund skipped", 409);
      }

      return jsonOk({
        swarmId,
        status: "FAILED",
        persisted: true,
        refundedCredits: result.refundedCredits,
        alreadyRefunded: result.alreadyRefunded,
      });
    } catch (error) {
      console.error("[webhook/engine] FAILED handler:", error);
      return jsonError("Internal server error", 500);
    }
  }

  // --- Canonical debate completion from Python ---
  const debateParsed = parseDebateEnginePayload(body);
  if (debateParsed.ok) {
    try {
      const exists = await prisma.swarm.findUnique({
        where: { id: debateParsed.data.debateId },
        select: { id: true, status: true },
      });

      if (!exists) {
        console.error("[webhook/engine] debate not found", debateParsed.data.debateId);
        return jsonError("Debate not found", 404);
      }

      console.log("[webhook/engine] persisting debate", {
        debateId: debateParsed.data.debateId,
        verdictLen: debateParsed.data.verdict.length,
        tldrCount: debateParsed.data.tldr.length,
        frictionCount: debateParsed.data.frictionMatrix.length,
        priorStatus: exists.status,
      });

      await persistDebateEngineResult(debateParsed.data);

      return jsonOk({
        debateId: debateParsed.data.debateId,
        status: "completed",
        persisted: true,
      });
    } catch (error) {
      console.error("[webhook/engine] debate persist:", error);
      return jsonError("Internal server error", 500);
    }
  }

  const hasDebateId =
    isNonEmptyString(body.debate_id) || isNonEmptyString(body.debateId);
  if (hasDebateId) {
    console.error("[webhook/engine] debate parse error", debateParsed.error);
    return jsonError(debateParsed.error, 400);
  }

  // --- Legacy ignite / swarm completion ---
  const parsed = extractEngineIgnitePayload(body);
  if ("error" in parsed) {
    console.error("[webhook/engine] ignite parse error", parsed.error);
    return jsonError(parsed.error, 400);
  }

  const { swarmId, engineData } = parsed;

  try {
    const existing = await prisma.swarm.findUnique({
      where: { id: swarmId },
      select: { id: true, status: true, messages: { select: { id: true } } },
    });

    if (!existing) {
      return jsonError("Swarm not found", 404);
    }

    if (existing.status === "COMPLETED" && existing.messages.length > 0) {
      return jsonOk({ swarmId, status: "COMPLETED", duplicate: true });
    }

    console.log("[webhook/engine] persisting ignite", { swarmId });
    await persistEngineIgniteResult(swarmId, engineData);
    return jsonOk({ swarmId, status: "COMPLETED", persisted: true });
  } catch (error) {
    console.error("[webhook/engine] ignite persist:", error);
    return jsonError("Internal server error", 500);
  }
}
