import { NextResponse } from "next/server";
import { corsJsonResponse, requireAuthUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { corsHeaderValues } from "@/lib/cors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * OPTIONS /api/swarms/[id]
 * CORS preflight for shoal-ui (cross-origin Vercel deployment).
 */
export async function OPTIONS(_request: Request, { params }: RouteContext) {
  await params;

  return new NextResponse(null, {
    status: 200,
    headers: corsHeaderValues,
  });
}

/**
 * GET /api/swarms/[id]
 * Returns a single swarm record owned by the authenticated user.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { userId } = authResult;
  const { id } = await params;

  if (!id?.trim()) {
    return corsJsonResponse({ error: "Swarm id is required" }, 400);
  }

  try {
    const swarm = await prisma.swarm.findFirst({
      where: { id: id.trim(), userId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        evidence: true,
      },
    });

    if (!swarm) {
      return corsJsonResponse({ error: "Swarm not found" }, 404);
    }

    return corsJsonResponse(swarm, 200);
  } catch (error) {
    console.error("[GET /api/swarms/[id]] Database error:", error);
    return corsJsonResponse({ error: "Internal server error" }, 500);
  }
}
