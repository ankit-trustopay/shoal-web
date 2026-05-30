import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function corsJsonResponse(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: corsHeaders });
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * OPTIONS /api/swarms/[id]
 * CORS preflight for shoal-ui (cross-origin Vercel deployment).
 */
export async function OPTIONS(
  _request: Request,
  { params }: RouteContext,
) {
  await params;

  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

/**
 * GET /api/swarms/[id]
 * Returns a single swarm record by id.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  if (!id?.trim()) {
    return corsJsonResponse({ error: "Swarm id is required" }, 400);
  }

  try {
    const swarm = await prisma.swarm.findUnique({
      where: { id: id.trim() },
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
