import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/prisma";

type WalletSnapshot = { dailyCredits: number; vaultCredits: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deductFromWallet(
  wallet: WalletSnapshot,
  cost: number,
): { dailyCredits: number; vaultCredits: number } {
  if (cost <= 0) return wallet;
  if (wallet.dailyCredits >= cost) {
    return {
      dailyCredits: wallet.dailyCredits - cost,
      vaultCredits: wallet.vaultCredits,
    };
  }
  const remainder = cost - wallet.dailyCredits;
  return {
    dailyCredits: 0,
    vaultCredits: Math.max(0, wallet.vaultCredits - remainder),
  };
}

/**
 * Debit credits when the engine has accepted the debate (HTTP 200 + deliberating).
 * Idempotent via resultData.creditsCharged flag.
 */
export async function chargeDebateCreditsOnEngineStart(
  debateId: string,
): Promise<{ charged: boolean; cost: number }> {
  return prisma.$transaction(async (tx) => {
    const swarm = await tx.swarm.findUnique({
      where: { id: debateId },
      select: {
        id: true,
        userId: true,
        cost: true,
        agentCount: true,
        resultData: true,
      },
    });

    if (!swarm) {
      throw new Error(`Debate not found: ${debateId}`);
    }

    const meta = isRecord(swarm.resultData) ? swarm.resultData : {};
    if (meta.creditsCharged === true) {
      console.log("[chargeDebateCredits] already charged", { debateId });
      return {
        charged: false,
        cost:
          typeof swarm.cost === "number" && swarm.cost > 0
            ? Math.floor(swarm.cost)
            : 0,
      };
    }

    const cost =
      typeof meta.plannedCost === "number" && meta.plannedCost > 0
        ? Math.floor(meta.plannedCost)
        : typeof swarm.cost === "number" && swarm.cost > 0
          ? Math.floor(swarm.cost)
          : swarm.agentCount;

    if (cost <= 0) {
      await tx.swarm.update({
        where: { id: debateId },
        data: {
          resultData: {
            ...meta,
            creditsCharged: true,
            chargedAt: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });
      return { charged: true, cost: 0 };
    }

    let debited = false;
    for (let attempt = 0; attempt < 2 && !debited; attempt += 1) {
      const wallet = await tx.user.findUnique({
        where: { id: swarm.userId },
        select: { dailyCredits: true, vaultCredits: true },
      });
      if (!wallet) {
        throw new Error(`User not found for debate ${debateId}`);
      }

      const total = wallet.dailyCredits + wallet.vaultCredits;
      if (total < cost) {
        throw new Error("Insufficient credits at engine start");
      }

      const nextWallet = deductFromWallet(wallet, cost);
      const updated = await tx.user.updateMany({
        where: {
          id: swarm.userId,
          dailyCredits: wallet.dailyCredits,
          vaultCredits: wallet.vaultCredits,
        },
        data: {
          dailyCredits: nextWallet.dailyCredits,
          vaultCredits: nextWallet.vaultCredits,
        },
      });
      debited = updated.count === 1;
    }

    if (!debited) {
      throw new Error("Credit deduction conflict; retry debate");
    }

    await tx.swarm.update({
      where: { id: debateId },
      data: {
        cost,
        resultData: {
          ...meta,
          creditsCharged: true,
          chargedAt: new Date().toISOString(),
          plannedCost: cost,
        } as Prisma.InputJsonValue,
      },
    });

    console.log("[chargeDebateCredits] charged", { debateId, cost });
    return { charged: true, cost };
  });
}
