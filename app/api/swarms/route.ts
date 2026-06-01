import { NextResponse } from "next/server";
import { after } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
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
import { parseCreateSwarmBody } from "@/lib/swarm-validation";
import { corsHeaderValues } from "@/lib/cors";

/**
 * GET /api/swarms
 * List swarms for the authenticated Clerk user (newest first).
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
        confidence: true,
        status: true,
        createdAt: true,
        agentCount: true,
        cost: true,
        runtime: true,
      },
    });

    return corsJsonResponse(swarms, 200);
  } catch (error) {
    return internalErrorResponse("[GET /api/swarms]", error);
  }
}

/**
 * OPTIONS /api/swarms
 * CORS preflight for shoal-ui (cross-origin Vercel deployment).
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaderValues,
  });
}

/**
 * POST /api/swarms
 * Creates a swarm job, returns swarmId immediately, runs engine in the background.
 * Deducts credits atomically before enqueueing the engine (1 agent = 1 credit).
 *
 * Body: { premise, agentCount, model? }
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

  const parsed = parseCreateSwarmBody(body);
  if (!parsed.ok) {
    return corsJsonResponse({ error: parsed.error }, 400);
  }

  const { premise, agentCount, model } = parsed.data;
  const cost = computeSwarmCreditCost(agentCount);

  try {
    await ensureClerkUser(userId);

    const swarm = await prisma.$transaction(async (tx) => {
      const debit = await tx.user.updateMany({
        where: {
          id: userId,
          credits: { gte: cost },
        },
        data: {
          credits: { decrement: cost },
        },
      });

      if (debit.count !== 1) {
        return null;
      }

      return tx.swarm.create({
        data: {
          userId,
          premise,
          agentCount,
          cost,
          status: "RUNNING",
          resultData: { model },
        },
      });
    });

    if (!swarm) {
      return corsJsonResponse(
        { error: "Insufficient credits", message: `This swarm requires ${cost} credits` },
        402,
      );
    }

    after(async () => {
      try {
        await runEngineIgniteAndPersist(swarm.id, premise, agentCount, model);
      } catch (engineError) {
        console.error(
          "[POST /api/swarms] Background engine error:",
          engineError,
        );
        try {
          await markSwarmFailedAndRefund(
            swarm.id,
            engineError instanceof Error
              ? engineError.message
              : "Background engine error",
          );
        } catch (updateError) {
          console.error(
            "[POST /api/swarms] Failed to mark swarm FAILED:",
            updateError,
          );
        }
      }
    });

    return corsJsonResponse({ swarmId: swarm.id }, 201);
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

    return internalErrorResponse("[POST /api/swarms]", error);
  }
}
