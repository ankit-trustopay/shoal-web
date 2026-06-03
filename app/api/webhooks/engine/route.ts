import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api-response";
import {
  handleDebateCompletedWebhook,
  handleDebateFailedWebhook,
  normalizeEngineWebhookStatus,
  resolveDebateIdFromWebhook,
} from "@/lib/engine-webhook-debate";
import { extractEngineIgnitePayload } from "@/lib/parse-engine-webhook";
import { persistEngineIgniteResult } from "@/lib/persist-engine-ignite";
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
 * Python engine callbacks when a debate finishes or fails.
 */
export async function POST(request: NextRequest) {
  console.log("[webhook/engine] ========== POST received ==========");

  try {
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
      console.log("[webhook/engine] JSON parsed");
    } catch (parseError) {
      console.error("[webhook/engine] invalid JSON", parseError);
      return jsonError("Invalid JSON body", 400);
    }

    if (!isRecord(body)) {
      console.error("[webhook/engine] body is not an object");
      return jsonError("Body must be a JSON object", 400);
    }

    const debateId = resolveDebateIdFromWebhook(body);
    const status = normalizeEngineWebhookStatus(body.status);

    console.log("[webhook/engine] payload summary", {
      debateId: debateId ?? "missing",
      status: body.status,
      normalizedStatus: status,
      keys: Object.keys(body),
      hasExecutiveSummary: Boolean(body.executive_summary ?? body.executiveSummary),
      hasBoardroomSummary: Boolean(body.boardroom_summary ?? body.boardroomSummary),
      hasDebateRoom: Boolean(body.debate_room ?? body.debateRoom),
      hasEvidenceVault: Boolean(body.evidence_vault ?? body.evidenceVault),
    });

    // --- 1. Explicit engine failure ---
    if (status === "failed") {
      if (!debateId) {
        console.error("[webhook/engine] failed status but no debate id");
        return jsonError("debate_id, debateId, or swarmId is required for failed", 400);
      }

      try {
        const result = await handleDebateFailedWebhook(debateId, body);

        if (!result.ok) {
          if (result.reason === "not_found") {
            return jsonError("Debate not found", 404);
          }
          console.warn("[webhook/engine] refund skipped", result);
          return jsonError("Debate already completed; refund skipped", 409);
        }

        console.log("[webhook/engine] failed path OK", result);
        return jsonOk({
          debateId,
          status: "failed",
          persisted: true,
          refundedCredits: result.refundedCredits,
          dailyCreditsAfter: result.dailyCreditsAfter,
          vaultCreditsAfter: result.vaultCreditsAfter,
          alreadyRefunded: result.alreadyRefunded,
        });
      } catch (error) {
        console.error("[webhook/engine] failed handler threw", error);
        return jsonError("Internal server error", 500);
      }
    }

    // --- 2. Debate completed (7-zone persist) ---
    if (status === "completed" && debateId) {
      try {
        const result = await handleDebateCompletedWebhook(debateId, body);
        console.log("[webhook/engine] completed path OK", result);
        return jsonOk({
          debateId: result.debateId,
          status: "completed",
          persisted: result.persisted,
        });
      } catch (error) {
        console.error("[webhook/engine] completed handler threw", error);
        return jsonError("Internal server error", 500);
      }
    }

    // --- 3. Legacy: uppercase FAILED without normalized status ---
    if (body.status === "FAILED") {
      const swarmId =
        debateId ||
        (isNonEmptyString(body.swarmId) ? body.swarmId.trim() : "");

      if (!swarmId) {
        return jsonError("swarmId or debate_id is required for FAILED", 400);
      }

      try {
        const result = await handleDebateFailedWebhook(swarmId, body);
        if (!result.ok) {
          if (result.reason === "not_found") {
            return jsonError("Debate not found", 404);
          }
          return jsonError("Debate already completed; refund skipped", 409);
        }
        return jsonOk({
          swarmId,
          status: "FAILED",
          persisted: true,
          refundedCredits: result.refundedCredits,
        });
      } catch (error) {
        console.error("[webhook/engine] legacy FAILED threw", error);
        return jsonError("Internal server error", 500);
      }
    }

    // --- 4. Debate-shaped payload without normalized status (failure verdict handled inside completed handler) ---
    if (debateId && (body.verdict !== undefined || body.executive_summary !== undefined)) {
      console.log("[webhook/engine] debate payload without status; treating as completed", {
        debateId,
      });

      try {
        const result = await handleDebateCompletedWebhook(debateId, body);
        return jsonOk({
          debateId: result.debateId,
          status: "completed",
          persisted: true,
        });
      } catch (error) {
        console.error("[webhook/engine] debate fallback handler threw", error);
        return jsonError("Internal server error", 500);
      }
    }

    // --- 5. Legacy ignite / swarm completion ---
    const parsed = extractEngineIgnitePayload(body);
    if ("error" in parsed) {
      if (debateId) {
        console.error("[webhook/engine] unrecognized debate payload", parsed.error);
        return jsonError(parsed.error, 400);
      }
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
      console.error("[webhook/engine] ignite persist threw", error);
      return jsonError("Internal server error", 500);
    }
  } catch (error) {
    console.error("[webhook/engine] top-level catch", error);
    return jsonError("Internal server error", 500);
  }
}
