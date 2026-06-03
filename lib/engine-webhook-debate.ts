import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  parseDebateEnginePayload,
  persistDebateEngineResult,
  type DebateEnginePayload,
} from "@/lib/persist-debate-result";
import {
  isDebateWebhookFailure,
  resolveWebhookFailureMessage,
} from "@/lib/debate-engine-failure";
import { markSwarmFailedAndRefund } from "@/lib/refund-failed-swarm";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeEngineWebhookStatus(
  status: unknown,
): "failed" | "completed" | null {
  if (!isNonEmptyString(status)) {
    return null;
  }
  const normalized = status.trim().toLowerCase();
  if (normalized === "failed" || normalized === "failure" || normalized === "error") {
    return "failed";
  }
  if (normalized === "completed" || normalized === "complete" || normalized === "success") {
    return "completed";
  }
  return null;
}

export function resolveDebateIdFromWebhook(
  body: Record<string, unknown>,
): string | null {
  const candidates = [body.debate_id, body.debateId, body.swarmId];
  for (const value of candidates) {
    if (isNonEmptyString(value)) {
      return value.trim();
    }
  }
  return null;
}

function safeJsonObject(value: unknown): Prisma.InputJsonObject {
  if (isRecord(value)) {
    return value as Prisma.InputJsonObject;
  }
  return {};
}

function safeJsonArray(value: unknown): Prisma.InputJsonValue {
  if (Array.isArray(value)) {
    return value as Prisma.InputJsonValue;
  }
  return [];
}

/**
 * Persist completed debate with 7-zone columns; tolerates missing webhook fields.
 */
export async function persistDebateCompletedZones(
  debateId: string,
  body: Record<string, unknown>,
  parsed: DebateEnginePayload | null,
): Promise<void> {
  const executiveSummary = safeJsonObject(
    body.executive_summary ?? body.executiveSummary ?? parsed?.executiveSummary,
  );
  const boardroomSummary = safeJsonObject(
    body.boardroom_summary ?? body.boardroomSummary ?? parsed?.boardroomSummary,
  );
  const debateRoom = safeJsonArray(
    body.debate_room ?? body.debateRoom ?? parsed?.debateRoom,
  );
  const evidenceVault = safeJsonObject(
    body.evidence_vault ?? body.evidenceVault ?? parsed?.evidenceVault,
  );

  console.log("[persistDebateCompletedZones] zone sizes", {
    debateId,
    executiveKeys: Object.keys(executiveSummary).length,
    boardroomKeys: Object.keys(boardroomSummary).length,
    debateRoomLen: Array.isArray(debateRoom) ? debateRoom.length : 0,
    evidenceKeys: Object.keys(evidenceVault).length,
    usedParsedPayload: parsed !== null,
  });

  if (parsed) {
    await persistDebateEngineResult(parsed);
    return;
  }

  const verdict =
    typeof body.verdict === "string" && body.verdict.trim().length > 0
      ? body.verdict.trim()
      : "Deliberation complete.";

  const confidence =
    typeof body.confidence === "number" && Number.isFinite(body.confidence)
      ? Math.round(body.confidence)
      : null;

  const existing = await prisma.swarm.findUnique({
    where: { id: debateId },
    select: { resultData: true },
  });

  if (!existing) {
    throw new Error(`Debate not found: ${debateId}`);
  }

  const priorMeta = isRecord(existing.resultData) ? existing.resultData : {};

  await prisma.swarm.update({
    where: { id: debateId },
    data: {
      status: "COMPLETED",
      confidence,
      executiveSummary,
      boardroomSummary,
      debateRoom,
      evidenceVault,
      resultData: {
        ...priorMeta,
        verdict,
        confidence,
        executiveSummary,
        boardroomSummary,
        debateRoom,
        evidenceVault,
        completedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  console.log("[persistDebateCompletedZones] minimal persist done", { debateId });
}

export type FailedWebhookResult =
  | {
      ok: true;
      debateId: string;
      refundedCredits: number;
      dailyCreditsAfter: number;
      vaultCreditsAfter: number;
      alreadyRefunded: boolean;
    }
  | { ok: false; reason: "not_found" | "already_completed" };

export async function handleDebateFailedWebhook(
  debateId: string,
  body: Record<string, unknown>,
): Promise<FailedWebhookResult> {
  const errorMessage =
    (isNonEmptyString(body.error) && body.error.trim()) ||
    (isNonEmptyString(body.message) && body.message.trim()) ||
    "Engine deliberation failed";

  console.log("[handleDebateFailedWebhook] start", {
    debateId,
    errorMessage,
    status: body.status,
  });

  const swarm = await prisma.swarm.findUnique({
    where: { id: debateId },
    select: {
      id: true,
      userId: true,
      agentCount: true,
      user: { select: { id: true, clerkId: true } },
    },
  });

  if (!swarm) {
    console.error("[handleDebateFailedWebhook] debate not found", { debateId });
    return { ok: false, reason: "not_found" };
  }

  console.log("[handleDebateFailedWebhook] resolved user", {
    debateId,
    userId: swarm.userId,
    clerkId: swarm.user?.clerkId,
    agentCount: swarm.agentCount,
  });

  const refundResult = await markSwarmFailedAndRefund(debateId, errorMessage);

  if (!refundResult.ok) {
    return refundResult;
  }

  return {
    ok: true,
    debateId,
    refundedCredits: refundResult.refundedCredits,
    dailyCreditsAfter: refundResult.dailyCreditsAfter,
    vaultCreditsAfter: refundResult.vaultCreditsAfter,
    alreadyRefunded: refundResult.alreadyRefunded,
  };
}

export async function handleDebateCompletedWebhook(
  debateId: string,
  body: Record<string, unknown>,
): Promise<{ debateId: string; persisted: true }> {
  console.log("[handleDebateCompletedWebhook] start", { debateId });

  const exists = await prisma.swarm.findUnique({
    where: { id: debateId },
    select: { id: true, status: true, agentCount: true },
  });

  if (!exists) {
    console.error("[handleDebateCompletedWebhook] debate not found", { debateId });
    throw new Error(`Debate not found: ${debateId}`);
  }

  const parsed = parseDebateEnginePayload(body);
  const payload = parsed.ok ? parsed.data : null;
  const verdict =
    payload?.verdict ??
    (typeof body.verdict === "string" ? body.verdict : "");

  if (isDebateWebhookFailure(body, verdict)) {
    const errorMessage = resolveWebhookFailureMessage(body, verdict);
    console.log(
      "[handleDebateCompletedWebhook] failure verdict -> refund",
      { debateId, verdictPreview: verdict.slice(0, 120) },
    );
    const refundResult = await handleDebateFailedWebhook(debateId, {
      ...body,
      status: "failed",
      error: errorMessage,
    });
    if (!refundResult.ok) {
      throw new Error(
        refundResult.reason === "not_found"
          ? `Debate not found: ${debateId}`
          : "Debate already completed; refund skipped",
      );
    }
    return { debateId, persisted: true };
  }

  if (!parsed.ok) {
    console.warn(
      "[handleDebateCompletedWebhook] parse warnings; using raw zones",
      parsed.error,
    );
  }

  await persistDebateCompletedZones(debateId, body, payload);

  console.log("[handleDebateCompletedWebhook] done", {
    debateId,
    priorStatus: exists.status,
  });

  return { debateId, persisted: true };
}
