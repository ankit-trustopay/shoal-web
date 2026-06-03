import { Prisma } from "@/app/generated/prisma/client";
import { computeSwarmCreditCost } from "@/lib/billing";
import { swarmResultIndicatesEngineFailure } from "@/lib/debate-engine-failure";
import { prisma } from "@/lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Credits to refund: prefer actual charged cost, else planned cost in resultData, else agentCount.
 */
export function resolveRefundCredits(swarm: {
  cost: number | null;
  agentCount: number;
  resultData: unknown;
}): number {
  const meta = isRecord(swarm.resultData) ? swarm.resultData : {};

  const planned =
    typeof meta.plannedCost === "number" && Number.isFinite(meta.plannedCost)
      ? Math.floor(meta.plannedCost)
      : null;

  if (
    typeof swarm.cost === "number" &&
    Number.isFinite(swarm.cost) &&
    swarm.cost > 0
  ) {
    return Math.floor(swarm.cost);
  }

  if (planned !== null && planned > 0) {
    return planned;
  }

  const fromAgents = computeSwarmCreditCost(swarm.agentCount);
  if (fromAgents > 0) {
    return fromAgents;
  }

  return Math.max(1, Math.floor(swarm.agentCount));
}

function resolveRefundSplit(
  meta: Record<string, unknown>,
  refundTotal: number,
): { dailyRefund: number; vaultRefund: number } {
  const dailyDebited =
    typeof meta.creditDebitDaily === "number" &&
    Number.isFinite(meta.creditDebitDaily)
      ? Math.max(0, Math.floor(meta.creditDebitDaily))
      : null;
  const vaultDebited =
    typeof meta.creditDebitVault === "number" &&
    Number.isFinite(meta.creditDebitVault)
      ? Math.max(0, Math.floor(meta.creditDebitVault))
      : null;

  if (dailyDebited !== null && vaultDebited !== null) {
    const sum = dailyDebited + vaultDebited;
    if (sum > 0) {
      return { dailyRefund: dailyDebited, vaultRefund: vaultDebited };
    }
  }

  // Fallback: restore full amount to dailyCredits (matches user-visible "daily" wallet).
  return { dailyRefund: refundTotal, vaultRefund: 0 };
}

export type FailedSwarmRefundResult =
  | {
      ok: true;
      swarmId: string;
      userId: string;
      clerkId: string;
      refundedCredits: number;
      dailyCreditsAfter: number;
      vaultCreditsAfter: number;
      alreadyRefunded: boolean;
    }
  | { ok: false; reason: "not_found" | "already_completed" };

/**
 * Mark swarm FAILED and refund credits to the owning user (idempotent).
 * Restores dailyCredits + vaultCredits using the original debit split when available.
 */
export async function markSwarmFailedAndRefund(
  swarmId: string,
  errorMessage: string,
): Promise<FailedSwarmRefundResult> {
  console.log("[markSwarmFailedAndRefund] start", { swarmId });

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
        user: {
          select: {
            id: true,
            clerkId: true,
            dailyCredits: true,
            vaultCredits: true,
          },
        },
      },
    });

    if (!swarm) {
      console.error("[markSwarmFailedAndRefund] swarm not found", { swarmId });
      return { ok: false, reason: "not_found" };
    }

    if (!swarm.user) {
      console.error("[markSwarmFailedAndRefund] user missing on swarm", {
        swarmId,
        userId: swarm.userId,
      });
      return { ok: false, reason: "not_found" };
    }

    const completedWithEngineError =
      swarm.status === "COMPLETED" &&
      swarmResultIndicatesEngineFailure(swarm.resultData);

    if (swarm.status === "COMPLETED" && !completedWithEngineError) {
      console.warn("[markSwarmFailedAndRefund] already completed", { swarmId });
      return { ok: false, reason: "already_completed" };
    }

    const existingResult = isRecord(swarm.resultData) ? swarm.resultData : {};
    const alreadyRefunded = existingResult.creditsRefunded === true;

    if (swarm.status === "FAILED" && alreadyRefunded) {
      console.log("[markSwarmFailedAndRefund] idempotent skip", { swarmId });
      return {
        ok: true,
        swarmId,
        userId: swarm.userId,
        clerkId: swarm.user.clerkId,
        refundedCredits: 0,
        dailyCreditsAfter: swarm.user.dailyCredits,
        vaultCreditsAfter: swarm.user.vaultCredits,
        alreadyRefunded: true,
      };
    }

    const refundTotal = resolveRefundCredits({
      cost: swarm.cost,
      agentCount: swarm.agentCount,
      resultData: swarm.resultData,
    });

    const { dailyRefund, vaultRefund } = resolveRefundSplit(
      existingResult,
      refundTotal,
    );

    const walletBefore = {
      dailyCredits: swarm.user.dailyCredits,
      vaultCredits: swarm.user.vaultCredits,
    };

    console.log("[markSwarmFailedAndRefund] refund plan", {
      swarmId,
      userId: swarm.userId,
      clerkId: swarm.user.clerkId,
      agentCount: swarm.agentCount,
      cost: swarm.cost,
      refundTotal,
      dailyRefund,
      vaultRefund,
      walletBefore,
      creditsCharged: existingResult.creditsCharged === true,
      alreadyRefunded,
    });

    let updatedUser = swarm.user;

    if (!alreadyRefunded && (dailyRefund > 0 || vaultRefund > 0)) {
      updatedUser = await tx.user.update({
        where: { id: swarm.userId },
        data: {
          ...(dailyRefund > 0 ? { dailyCredits: { increment: dailyRefund } } : {}),
          ...(vaultRefund > 0 ? { vaultCredits: { increment: vaultRefund } } : {}),
        },
        select: {
          id: true,
          clerkId: true,
          dailyCredits: true,
          vaultCredits: true,
        },
      });

      console.log("[markSwarmFailedAndRefund] user wallet updated", {
        swarmId,
        userId: updatedUser.id,
        clerkId: updatedUser.clerkId,
        before: walletBefore,
        after: {
          dailyCredits: updatedUser.dailyCredits,
          vaultCredits: updatedUser.vaultCredits,
        },
        incremented: { dailyRefund, vaultRefund },
      });
    } else if (!alreadyRefunded && refundTotal <= 0) {
      console.warn("[markSwarmFailedAndRefund] refund amount zero", { swarmId });
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
          refundCredits: refundTotal,
          refundDaily: dailyRefund,
          refundVault: vaultRefund,
        } as Prisma.InputJsonValue,
      },
    });

    console.log("[markSwarmFailedAndRefund] done", {
      swarmId,
      status: "FAILED",
      refundedCredits: alreadyRefunded ? 0 : refundTotal,
    });

    return {
      ok: true,
      swarmId,
      userId: swarm.userId,
      clerkId: swarm.user.clerkId,
      refundedCredits: alreadyRefunded ? 0 : refundTotal,
      dailyCreditsAfter: updatedUser.dailyCredits,
      vaultCreditsAfter: updatedUser.vaultCredits,
      alreadyRefunded,
    };
  });
}
