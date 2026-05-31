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

type EngineEvidenceItem = {
  title?: string;
  source?: string;
  url?: string;
  snippet?: string;
};

type EngineIgnitePayload = {
  messages?: { role: string; text: string }[];
  response?: string;
  confidence?: number;
  votesFor?: number;
  votesAgainst?: number;
  votesNeutral?: number;
  runtime?: number;
  cost?: number;
  evidence?: EngineEvidenceItem[];
};

function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toOptionalFloat(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function buildSwarmMetadataUpdate(data: EngineIgnitePayload) {
  const update: {
    confidence?: number;
    votesFor?: number;
    votesAgainst?: number;
    votesNeutral?: number;
    runtime?: number;
    cost?: number;
  } = {};

  const confidence = toOptionalInt(data.confidence);
  const votesFor = toOptionalInt(data.votesFor);
  const votesAgainst = toOptionalInt(data.votesAgainst);
  const votesNeutral = toOptionalInt(data.votesNeutral);
  const runtime = toOptionalInt(data.runtime);
  const cost = toOptionalFloat(data.cost);

  if (confidence !== undefined) update.confidence = confidence;
  if (votesFor !== undefined) update.votesFor = votesFor;
  if (votesAgainst !== undefined) update.votesAgainst = votesAgainst;
  if (votesNeutral !== undefined) update.votesNeutral = votesNeutral;
  if (runtime !== undefined) update.runtime = runtime;
  if (cost !== undefined) update.cost = cost;

  return update;
}

function normalizeEvidenceItems(
  items: EngineEvidenceItem[] | undefined,
): { title: string; source: string; url: string; snippet: string }[] {
  if (!items?.length) return [];

  return items
    .map((item) => ({
      title: item.title?.trim() ?? "",
      source: item.source?.trim() ?? "",
      url: item.url?.trim() ?? "",
      snippet: item.snippet?.trim() ?? "",
    }))
    .filter(
      (item) =>
        item.title.length > 0 &&
        item.source.length > 0 &&
        item.url.length > 0 &&
        item.snippet.length > 0,
    );
}

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
        const engineData = (await engineResponse.json()) as EngineIgnitePayload;

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

        const metadataUpdate = buildSwarmMetadataUpdate(engineData);
        const evidenceRows = normalizeEvidenceItems(engineData.evidence);

        await prisma.swarm.update({
          where: { id: swarm.id },
          data: {
            status: "RUNNING",
            ...metadataUpdate,
            ...(evidenceRows.length > 0
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
