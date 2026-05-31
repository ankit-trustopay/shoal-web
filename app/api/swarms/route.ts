import { NextResponse } from "next/server";
import { after } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { runEngineIgniteAndPersist } from "@/lib/persist-engine-ignite";
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
 * GET /api/swarms
 * List swarms for the default test user (newest first).
 */
export async function GET(_req: Request) {
  try {
    const swarms = await prisma.swarm.findMany({
      where: { userId: SEED_USER_ID },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        premise: true,
        confidence: true,
        status: true,
        createdAt: true,
        cost: true,
        runtime: true,
      },
    });

    return corsJsonResponse(swarms, 200);
  } catch (error) {
    console.error("[GET /api/swarms] Database error:", error);
    return corsJsonResponse({ error: "Internal server error" }, 500);
  }
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
 * Creates a swarm job, returns swarmId immediately, runs engine in the background.
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
        status: "RUNNING",
      },
    });

    after(async () => {
      try {
        await runEngineIgniteAndPersist(swarm.id, premise);
      } catch (engineError) {
        console.error(
          "[POST /api/swarms] Background engine error:",
          engineError,
        );
        try {
          await prisma.swarm.update({
            where: { id: swarm.id },
            data: { status: "FAILED" },
          });
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
