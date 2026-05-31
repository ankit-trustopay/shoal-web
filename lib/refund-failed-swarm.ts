import { Prisma } from "@/app/generated/prisma/client";
import { computeSwarmCreditCost } from "@/lib/billing";
import { prisma } from "@/lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRefundCredits(swarm: {
  cost: number | null;
  agentCount: number;
}): number {
  if (
    typeof swarm.cost === "number" &&
    Number.isFinite(swarm.cost) &&
    swarm.cost > 0
  ) {
    return Math.floor(swarm.cost);
  }

  return computeSwarmCreditCost(swarm.agentCount);
}

export type FailedSwarmRefundResult =
  | {
      ok: true;
      swarmId: string;
      userId: string;
      refundedCredits: number;
      alreadyRefunded: boolean;
    }
  | { ok: false; reason: "not_found" | "already_completed" };

/**
 * Mark a swarm FAILED and refund the user's debited credits (idempotent).
 */
export async function markSwarmFailedAndRefund(
  swarmId: string,
  errorMessage: string,
): Promise<FailedSwarmRefundResult> {
  return prisma.$transaction(async (tx) => {
    const swarm = await tx.swarm.findUnique({
      where: { id: swarmId },
      select: {
        id: true,
        userId: true,
        agentCount: true,
        cost: true,
        status: true,
        resultData: true,
      },
    });

    if (!swarm) {
      return { ok: false, reason: "not_found" };
    }

    if (swarm.status === "COMPLETED") {
      return { ok: false, reason: "already_completed" };
    }

    const existingResult = isRecord(swarm.resultData) ? swarm.resultData : {};
    const alreadyRefunded = existingResult.creditsRefunded === true;

    if (swarm.status === "FAILED" && alreadyRefunded) {
      return {
        ok: true,
        swarmId,
        userId: swarm.userId,
        refundedCredits: 0,
        alreadyRefunded: true,
      };
    }

    const refundCredits = alreadyRefunded ? 0 : resolveRefundCredits(swarm);

    if (refundCredits > 0) {
      await tx.user.update({
        where: { id: swarm.userId },
        data: {
          credits: { increment: refundCredits },
        },
      });
    }

    await tx.swarm.update({
      where: { id: swarmId },
      data: {
        status: "FAILED",
        resultData: {
          ...existingResult,
          error: errorMessage,
          failedAt:
            typeof existingResult.failedAt === "string"
              ? existingResult.failedAt
              : new Date().toISOString(),
          creditsRefunded: true,
          refundCredits,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      ok: true,
      swarmId,
      userId: swarm.userId,
      refundedCredits: refundCredits,
      alreadyRefunded: false,
    };
  });
}
