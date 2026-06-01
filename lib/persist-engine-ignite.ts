import { Prisma } from "@/app/generated/prisma/client";
import {
  buildSwarmMetadataUpdate,
  normalizeEvidenceItems,
  type EngineIgnitePayload,
} from "@/lib/engine-payload";
import { igniteEngine } from "@/lib/mirofish";
import { markSwarmFailedAndRefund } from "@/lib/refund-failed-swarm";
import { prisma } from "@/lib/prisma";

/**
 * Persist a full /ignite engine payload onto an existing swarm row.
 * Idempotent: skips message/evidence inserts if already present.
 */
export async function persistEngineIgniteResult(
  swarmId: string,
  engineData: EngineIgnitePayload,
): Promise<void> {
  const existing = await prisma.swarm.findUnique({
    where: { id: swarmId },
    include: {
      messages: { select: { id: true } },
      evidence: { select: { id: true } },
    },
  });

  if (!existing) {
    throw new Error(`Swarm not found: ${swarmId}`);
  }

  if (engineData.messages?.length && existing.messages.length === 0) {
    await prisma.message.createMany({
      data: engineData.messages
        .filter((message) => message.text?.trim())
        .map((message) => ({
          swarmId,
          role: message.role,
          text: message.text.trim(),
        })),
    });
  } else if (!engineData.messages?.length) {
    const legacyText = engineData.response?.trim();
    if (legacyText && existing.messages.length === 0) {
      await prisma.message.create({
        data: {
          swarmId,
          text: legacyText,
          role: "Skeptic",
        },
      });
    }
  }

  const metadataUpdate = buildSwarmMetadataUpdate(engineData);
  const evidenceRows = normalizeEvidenceItems(engineData.evidence);

  if (
    metadataUpdate.resultData &&
    existing.resultData &&
    typeof existing.resultData === "object" &&
    !Array.isArray(existing.resultData)
  ) {
    metadataUpdate.resultData = {
      ...(existing.resultData as Record<string, unknown>),
      ...(metadataUpdate.resultData as Record<string, unknown>),
    } as Prisma.InputJsonValue;
  }

  await prisma.swarm.update({
    where: { id: swarmId },
    data: {
      status: "COMPLETED",
      ...metadataUpdate,
      ...(evidenceRows.length > 0 && existing.evidence.length === 0
        ? {
            evidence: {
              createMany: {
                data: evidenceRows,
              },
            },
          }
        : {}),
    },
  });
}

export async function runEngineIgniteAndPersist(
  swarmId: string,
  premise: string,
  agentCount?: number,
  model?: string,
): Promise<void> {
  await prisma.swarm.update({
    where: { id: swarmId },
    data: { status: "RUNNING" },
  });

  const engineResponse = await igniteEngine(
    {
      swarmId,
      premise,
      ...(agentCount !== undefined
        ? { swarmSize: agentCount, agentCount }
        : {}),
      ...(model ? { model } : {}),
    },
    { timeoutMs: 30_000 },
  );

  if (!engineResponse.ok) {
    const errorBody = await engineResponse.text().catch(() => "");
    console.error(
      "[runEngineIgniteAndPersist] Engine /ignite failed:",
      engineResponse.status,
      engineResponse.statusText,
      errorBody,
    );
    await markSwarmFailedAndRefund(
      swarmId,
      errorBody.trim() || `Engine HTTP ${engineResponse.status}`,
    );
    return;
  }

  const engineData = (await engineResponse.json()) as EngineIgnitePayload & {
    status?: string;
  };

  if (engineData.status === "deliberating") {
    return;
  }

  if (!engineData.messages?.length && !engineData.response?.trim()) {
    console.error(
      "[runEngineIgniteAndPersist] Engine returned no messages:",
      engineData,
    );
    await markSwarmFailedAndRefund(
      swarmId,
      "Engine returned no messages",
    );
    return;
  }

  await persistEngineIgniteResult(swarmId, engineData);
}
