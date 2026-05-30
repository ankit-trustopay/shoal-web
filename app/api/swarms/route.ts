import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk } from "@/lib/api-response";
import { corsPreflightResponse } from "@/lib/cors";
import { dispatchSwarmToMirofish, MirofishEngineError } from "@/lib/mirofish";
import { prisma } from "@/lib/prisma";
import { parseCreateSwarmBody } from "@/lib/swarm-validation";

/**
 * OPTIONS /api/swarms
 * CORS preflight for shoal-ui (separate Vercel origin).
 */
export function OPTIONS(request: NextRequest) {
  return corsPreflightResponse(request);
}

/**
 * POST /api/swarms
 * Creates a swarm job, dispatches it to MiroFish, returns swarmId for Live Console redirect.
 *
 * Body: { userId, premise, agentCount }
 * (userId will come from session once Auth is wired up)
 */
export async function POST(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, undefined, request);
  }

  const parsed = parseCreateSwarmBody(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400, undefined, request);
  }

  const { userId, premise, agentCount } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return jsonError("User not found", 404, undefined, request);
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

      return jsonError(message, 502, { swarmId: swarm.id }, request);
    }

    return jsonOk({ swarmId: swarm.id }, 201, request);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return jsonError("Invalid userId", 400, undefined, request);
    }

    console.error("[POST /api/swarms]", error);
    return jsonError("Internal server error", 500, undefined, request);
  }
}
