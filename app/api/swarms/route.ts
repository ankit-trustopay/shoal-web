import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { dispatchSwarmToMirofish, MirofishEngineError } from "@/lib/mirofish";
import { prisma } from "@/lib/prisma";
import { parseCreateSwarmBody } from "@/lib/swarm-validation";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SEED_USER_ID = "test-user-001";

function corsJsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

/**
 * OPTIONS /api/swarms
 * CORS preflight for shoal-ui (cross-origin Vercel deployment).
 */
export async function OPTIONS(_request: Request) {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

/**
 * POST /api/swarms
 * Creates a swarm job, dispatches it to MiroFish, returns swarmId for Live Console redirect.
 *
 * Body: { userId, premise, agentCount }
 */
export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return corsJsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const parsed = parseCreateSwarmBody(body);
  if (!parsed.ok) {
    return corsJsonResponse({ error: parsed.error }, 400);
  }

  const { userId, premise, agentCount } = parsed.data;

  try {
    const seedUser = await prisma.user.findUnique({
      where: { id: SEED_USER_ID },
    });

    if (!seedUser) {
      await prisma.user.create({
        data: {
          id: SEED_USER_ID,
          email: "founder@shoalai.com",
          credits: 1000,
        },
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return corsJsonResponse({ error: "User not found" }, 404);
    }

    const swarm = await prisma.swarm.create({
      data: {
        userId,
        premise,
        agentCount,
        status: "PENDING",
      },
    });

    try {
      await dispatchSwarmToMirofish({
        swarmId: swarm.id,
        premise: swarm.premise,
        agentCount: swarm.agentCount,
      });

      await prisma.swarm.update({
        where: { id: swarm.id },
        data: { status: "RUNNING" },
      });
    } catch (engineError) {
      await prisma.swarm.update({
        where: { id: swarm.id },
        data: { status: "FAILED" },
      });

      const message =
        engineError instanceof MirofishEngineError
          ? engineError.message
          : "Failed to reach MiroFish engine";

      return corsJsonResponse(
        {
          error: message,
          ...(process.env.NODE_ENV === "development"
            ? { details: { swarmId: swarm.id } }
            : {}),
        },
        502,
      );
    }

    return corsJsonResponse({ swarmId: swarm.id }, 201);
  } catch (error) {
    console.error("[POST /api/swarms] Database error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return corsJsonResponse({ error: "Invalid userId" }, 400);
    }

    return corsJsonResponse({ error: "Internal server error" }, 500);
  }
}
