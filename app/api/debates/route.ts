import { NextResponse } from "next/server";
import { after } from "next/server";
import { corsHeaderValues } from "@/lib/cors";
import {
  corsJsonResponse,
  internalErrorResponse,
  requireAuthUserId,
} from "@/lib/api-auth";
import { computeSwarmCreditCost } from "@/lib/billing";
import { ensureClerkUser } from "@/lib/ensure-clerk-user";
import { runEngineIgniteAndPersist } from "@/lib/persist-engine-ignite";
import { prisma } from "@/lib/prisma";
import { markSwarmFailedAndRefund } from "@/lib/refund-failed-swarm";
import { Prisma } from "@/app/generated/prisma/client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveModelFromResultData(resultData: unknown): string | null {
  if (!isRecord(resultData)) return null;
  const raw =
    resultData.model ??
    (isRecord(resultData.reportData) ? resultData.reportData.model : undefined);
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * GET /api/debates
 * Usage history for the authenticated user.
 */
export async function GET() {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { userId } = authResult;

  try {
    await ensureClerkUser(userId);

    const swarms = await prisma.swarm.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        premise: true,
        createdAt: true,
        agentCount: true,
        cost: true,
        resultData: true,
      },
      take: 200,
    });

    const debates = swarms.map((swarm) => ({
      id: swarm.id,
      createdAt: swarm.createdAt.toISOString(),
      premise: swarm.premise,
      agentCount: swarm.agentCount,
      model: resolveModelFromResultData(swarm.resultData),
      creditsConsumed:
        typeof swarm.cost === "number" && Number.isFinite(swarm.cost)
          ? Math.floor(swarm.cost)
          : swarm.agentCount,
    }));

    return corsJsonResponse(debates, 200);
  } catch (error) {
    return internalErrorResponse("[GET /api/debates]", error);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseAgentCount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > 10_000) return null;
  return value;
}

function resolveCreditsPerAgent(modelTier: unknown): 1 | 5 {
  return typeof modelTier === "string" && modelTier.trim().toLowerCase() === "plus"
    ? 5
    : 1;
}

type WalletSnapshot = { dailyCredits: number; vaultCredits: number };

function canAffordWallet(wallet: WalletSnapshot, cost: number): boolean {
  return wallet.dailyCredits + wallet.vaultCredits >= cost;
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
 * POST /api/debates
 * Creates a debate (swarm) and returns debateId immediately.
 *
 * Expected body:
 * {
 *   query: string,
 *   agentCount: number,
 *   modelTier: 'lite' | 'plus',
 *   advancedVariables: { targetAudience?, pricePoint?, marketingBudget? }
 * }
 */
export async function POST(request: Request) {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { userId } = authResult;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return corsJsonResponse(
      { error: "Invalid JSON body", message: "Request body must be valid JSON" },
      400,
    );
  }

  if (!isRecord(body)) {
    return corsJsonResponse({ error: "Request body must be a JSON object" }, 400);
  }

  const query = body.query;
  const agentCount = parseAgentCount(body.agentCount);
  const creditsPerAgent = resolveCreditsPerAgent(body.modelTier);
  const modelTier =
    typeof body.modelTier === "string" && body.modelTier.trim()
      ? body.modelTier.trim().toLowerCase()
      : "lite";

  const advanced = isRecord(body.advancedVariables) ? body.advancedVariables : {};

  if (!isNonEmptyString(query)) {
    return corsJsonResponse({ error: "query is required" }, 400);
  }
  if (agentCount == null) {
    return corsJsonResponse({ error: "agentCount must be an integer 1..10000" }, 400);
  }

  const cost = computeSwarmCreditCost(agentCount) * creditsPerAgent;

  const targetAudience =
    typeof advanced.targetAudience === "string" ? advanced.targetAudience : null;
  const pricePoint =
    typeof advanced.pricePoint === "string" ? advanced.pricePoint : null;
  const marketingBudget =
    typeof advanced.marketingBudget === "string" ? advanced.marketingBudget : null;

  try {
    await ensureClerkUser(userId);

    const swarm = await prisma.$transaction(async (tx) => {
      // Two-wallet deduction (daily then vault) with optimistic concurrency.
      let attempt = 0;
      let debited = false;

      while (attempt < 2 && !debited) {
        attempt += 1;
        const wallet = await tx.user.findUnique({
          where: { id: userId },
          select: { dailyCredits: true, vaultCredits: true },
        });

        if (!wallet) return null;
        if (!canAffordWallet(wallet, cost)) return null;

        const nextWallet = deductFromWallet(wallet, cost);
        const updated = await tx.user.updateMany({
          where: {
            id: userId,
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

      if (!debited) return null;

      return tx.swarm.create({
        data: {
          userId,
          premise: query.trim(),
          agentCount,
          cost,
          status: "RUNNING",
          resultData: {
            modelTier,
            advancedVariables: {
              targetAudience,
              pricePoint,
              marketingBudget,
            },
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    });

    if (!swarm) {
      return corsJsonResponse(
        {
          error: "Insufficient credits",
          message: `This debate requires ${cost} credits`,
        },
        402,
      );
    }

    after(async () => {
      try {
        await runEngineIgniteAndPersist(
          swarm.id,
          query.trim(),
          agentCount,
          undefined,
          {
            modelTier,
            targetAudience: targetAudience ?? undefined,
            pricePoint: pricePoint ?? undefined,
            marketingBudget: marketingBudget ?? undefined,
          },
        );
      } catch (engineError) {
        console.error("[POST /api/debates] Background engine error:", engineError);
        try {
          await markSwarmFailedAndRefund(
            swarm.id,
            engineError instanceof Error
              ? engineError.message
              : "Background engine error",
          );
        } catch (updateError) {
          console.error(
            "[POST /api/debates] Failed to mark swarm FAILED:",
            updateError,
          );
        }
      }
    });

    return corsJsonResponse({ debateId: swarm.id }, 201);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return corsJsonResponse(
        { error: "Invalid user", message: "User record is missing or invalid" },
        400,
      );
    }
    return internalErrorResponse("[POST /api/debates]", error);
  }
}

/**
 * OPTIONS /api/debates
 * CORS preflight.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: corsHeaderValues });
}

