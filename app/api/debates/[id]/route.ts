import { NextResponse } from "next/server";
import { corsJsonResponse, requireAuthUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { corsHeaderValues } from "@/lib/cors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * OPTIONS /api/debates/[id]
 * CORS preflight.
 */
export async function OPTIONS(_request: Request, { params }: RouteContext) {
  await params;

  return new NextResponse(null, {
    status: 200,
    headers: corsHeaderValues,
  });
}

/**
 * GET /api/debates/[id]
 * Returns a single debate record owned by the authenticated user.
 *
 * Note: debates are currently persisted as Swarm rows.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const authResult = await requireAuthUserId();
  if ("response" in authResult) {
    return authResult.response;
  }

  const { userId } = authResult;
  const { id } = await params;

  if (!id?.trim()) {
    return corsJsonResponse({ error: "debate id is required" }, 400);
  }

  try {
    const debate = await prisma.swarm.findFirst({
      where: { id: id.trim(), userId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
        evidence: true,
      },
    });

    if (!debate) {
      return corsJsonResponse({ error: "Debate not found" }, 404);
    }

    return corsJsonResponse(debate, 200);
  } catch (error) {
    console.error("[GET /api/debates/[id]] Database error:", error);
    return corsJsonResponse({ error: "Internal server error" }, 500);
  }
}

