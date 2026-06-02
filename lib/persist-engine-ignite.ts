import { Prisma } from "@/app/generated/prisma/client";
import {
  buildSwarmMetadataUpdate,
  normalizeEvidenceItems,
  type EngineIgnitePayload,
} from "@/lib/engine-payload";
import { igniteEngine, startDebateEngine } from "@/lib/mirofish";
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
  variables?: {
    modelTier?: string;
    targetAudience?: string;
    pricePoint?: string;
    marketingBudget?: string;
  },
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
      ...(variables?.modelTier ? { model_tier: variables.modelTier } : {}),
      ...(variables?.targetAudience
        ? { target_audience: variables.targetAudience }
        : {}),
      ...(variables?.pricePoint ? { price_point: variables.pricePoint } : {}),
      ...(variables?.marketingBudget
        ? { marketing_budget: variables.marketingBudget }
        : {}),
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

/**
 * POST /debate on the Python engine. Throws if the engine does not return 200 OK.
 * Completion is delivered asynchronously via the engine webhook.
 */
export async function runEngineDebateAndPersist(
  debateId: string,
  query: string,
  agentCount: number,
  modelMix: number,
): Promise<void> {
  await prisma.swarm.update({
    where: { id: debateId },
    data: { status: "RUNNING" },
  });

  const response = await startDebateEngine(
    {
      debate_id: debateId,
      query,
      agent_count: agentCount,
      model_mix: modelMix,
    },
    { timeoutMs: 30_000 },
  );

  console.log("Engine Response Status:", response.status);
  const responseText = await response.text();
  console.log("Engine Response Body:", responseText);

  if (!response.ok) {
    throw new Error(
      `Engine debate failed: HTTP ${response.status}${
        responseText.trim() ? ` — ${responseText.trim()}` : ""
      }`,
    );
  }

  let parsed: { status?: string; debateId?: string } | null = null;
  if (responseText.trim()) {
    try {
      parsed = JSON.parse(responseText) as { status?: string; debateId?: string };
    } catch {
      throw new Error("Engine returned invalid JSON");
    }
  }

  if (parsed?.status === "deliberating") {
    return;
  }
}
