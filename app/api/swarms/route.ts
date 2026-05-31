import { NextResponse } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { igniteEngine } from "@/lib/mirofish";
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
 * Creates a swarm job, dispatches it to the Railway engine, returns swarmId for Live Console redirect.
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
      const engineResponse = await igniteEngine({
        swarmId: swarm.id,
        premise,
      });

      if (!engineResponse.ok) {
        const errorBody = await engineResponse.text().catch(() => "");
        console.error(
          "[POST /api/swarms] Engine /ignite failed:",
          engineResponse.status,
          engineResponse.statusText,
          errorBody,
        );
      } else {
        const engineData = (await engineResponse.json()) as {
          messages?: { role: string; text: string }[];
          response?: string;
        };

        if (engineData.messages?.length) {
          await prisma.message.createMany({
            data: engineData.messages
              .filter((m) => m.text?.trim())
              .map((m) => ({
                swarmId: swarm.id,
                role: m.role,
                text: m.text.trim(),
              })),
          });
        } else {
          const aiText = engineData.response?.trim();

          if (aiText) {
            await prisma.message.create({
              data: {
                swarmId: swarm.id,
                text: aiText,
                role: "Skeptic",
              },
            });
          } else {
            console.error(
              "[POST /api/swarms] Engine /ignite returned no messages:",
              engineData,
            );
          }
        }

        await prisma.swarm.update({
          where: { id: swarm.id },
          data: { status: "RUNNING" },
        });
      }
    } catch (engineError) {
      console.error("[POST /api/swarms] Engine /ignite error:", engineError);
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
