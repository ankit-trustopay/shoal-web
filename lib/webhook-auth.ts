import { NextRequest } from "next/server";

/**
 * Validates the shared secret sent by MiroFish on webhook callbacks.
 * Set ENGINE_WEBHOOK_SECRET in production; skips check when unset (local dev only).
 */
export function isWebhookAuthorized(request: NextRequest): boolean {
  const secret = process.env.ENGINE_WEBHOOK_SECRET;

  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const header =
    request.headers.get("x-engine-webhook-secret") ??
    request.headers.get("authorization");

  if (!header) {
    return false;
  }

  if (header === secret) {
    return true;
  }

  if (header.startsWith("Bearer ") && header.slice(7) === secret) {
    return true;
  }

  return false;
}
