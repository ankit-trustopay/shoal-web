import { NextRequest, NextResponse } from "next/server";

const DEFAULT_ORIGINS = ["http://localhost:5173"];

/**
 * Allowed browser origins for shoal-ui.
 * Set FRONTEND_ORIGIN to a single URL or comma-separated list, e.g.:
 * https://shoal-ui-woad.vercel.app,http://localhost:5173
 */
export function getAllowedOrigins(): string[] {
  const raw = process.env.FRONTEND_ORIGIN;

  if (!raw?.trim()) {
    return DEFAULT_ORIGINS;
  }

  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function resolveCorsOrigin(request?: NextRequest): string {
  const allowed = getAllowedOrigins();
  const requestOrigin = request?.headers.get("origin");

  if (requestOrigin && allowed.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowed[0] ?? DEFAULT_ORIGINS[0];
}

export function corsHeaders(request?: NextRequest): HeadersInit {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(request),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, x-engine-webhook-secret",
    Vary: "Origin",
  };
}

/** Preflight response for cross-origin POST from shoal-ui. */
export function corsPreflightResponse(request?: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
