import { NextRequest } from "next/server";
import { Prisma } from "@/app/generated/prisma/client";
import { jsonError, jsonOk } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";
import { parseEngineWebhookBody } from "@/lib/swarm-validation";
import { isWebhookAuthorized } from "@/lib/webhook-auth";

/**
 * POST /api/webhooks/engine
 * Callback from MiroFish when a simulation completes.
 *
 * Body: { swarmId, reportData }
 * Header (production): x-engine-webhook-secret or Authorization: Bearer <secret>
 */
export async function POST(request: NextRequest) {
  if (!isWebhookAuthorized(request)) {
    return jsonError("Unauthorized", 401);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = parseEngineWebhookBody(body);
  if (!parsed.ok) {
    return jsonError(parsed.error, 400);
  }

  const { swarmId, reportData } = parsed.data;

  try {
    const existing = await prisma.swarm.findUnique({
      where: { id: swarmId },
      select: { id: true, status: true },
    });

    if (!existing) {
      return jsonError("Swarm not found", 404);
    }

    if (existing.status === "COMPLETED") {
      return jsonOk({ swarmId, status: "COMPLETED", duplicate: true });
    }

    const swarm = await prisma.swarm.update({
      where: { id: swarmId },
      data: {
        status: "COMPLETED",
        resultData: reportData as Prisma.InputJsonValue,
      },
      select: { id: true, status: true },
    });

    return jsonOk({ swarmId: swarm.id, status: swarm.status });
  } catch (error) {
    console.error("[POST /api/webhooks/engine]", error);
    return jsonError("Internal server error", 500);
  }
}
