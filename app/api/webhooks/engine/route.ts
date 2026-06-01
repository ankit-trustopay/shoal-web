import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk } from "@/lib/api-response";
import {
  buildSwarmMetadataUpdate,
  extractAgentProfiles,
  type EngineIgnitePayload,
} from "@/lib/engine-payload";
import { extractEngineIgnitePayload } from "@/lib/parse-engine-webhook";
import { persistEngineIgniteResult } from "@/lib/persist-engine-ignite";
import { markSwarmFailedAndRefund } from "@/lib/refund-failed-swarm";
import { prisma } from "@/lib/prisma";
import { isWebhookAuthorized } from "@/lib/webhook-auth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function looksLikeIgnitePayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.messages) ||
    typeof record.confidence === "number" ||
    Array.isArray(record.evidence) ||
    Array.isArray(record.agentProfiles) ||
    Array.isArray(record.debateTranscript)
  );
}

/**
 * POST /api/webhooks/engine
 * Callback when a simulation completes or fails.
 */
export async function POST(request: NextRequest) {
  if (!isWebhookAuthorized(request)) {
    return jsonError("Unauthorized", 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  if (isRecord(body) && body.status === "FAILED") {
    if (!isNonEmptyString(body.swarmId)) {
      return jsonError("swarmId is required", 400);
    }

    const swarmId = body.swarmId.trim();
    const errorMessage =
      typeof body.error === "string" && body.error.trim().length > 0
        ? body.error.trim()
        : "Engine ignite failed";

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
      console.error("[POST /api/webhooks/engine] FAILED handler:", error);
      return jsonError("Internal server error", 500);
    }
  }

  const parsed = extractEngineIgnitePayload(body);
  if ("error" in parsed) {
    return jsonError(parsed.error, 400);
  }

  const { swarmId, engineData } = parsed;

  try {
    const existing = await prisma.swarm.findUnique({
      where: { id: swarmId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return jsonError("Swarm not found", 404);
    }

    if (existing.status === "COMPLETED" && looksLikeIgnitePayload(engineData)) {
      const hasMessages =
        Array.isArray(engineData.messages) && engineData.messages.length > 0;
      if (hasMessages) {
        return jsonOk({ swarmId, status: "COMPLETED", duplicate: true });
      }
    }

    if (looksLikeIgnitePayload(engineData)) {
      await persistEngineIgniteResult(swarmId, engineData as EngineIgnitePayload);
      return jsonOk({ swarmId, status: "COMPLETED", persisted: true });
    }

    const agentProfiles = extractAgentProfiles(body, engineData);
    const metadataUpdate = buildSwarmMetadataUpdate(
      engineData as EngineIgnitePayload,
    );

    const swarm = await prisma.swarm.update({
      where: { id: swarmId },
      data: {
        status: "COMPLETED",
        resultData: engineData as Prisma.InputJsonValue,
        ...metadataUpdate,
        ...(agentProfiles !== undefined ? { agentProfiles } : {}),
      },
      select: { id: true, status: true },
    });

    return jsonOk({ swarmId: swarm.id, status: swarm.status });
  } catch (error) {
    console.error("[POST /api/webhooks/engine]", error);
    return jsonError("Internal server error", 500);
  }
}
