import type { NextRequest } from "next/server";

export const corsHeaderValues = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** CORS headers for API responses (optionally request-aware later). */
export function corsHeaders(_request?: NextRequest) {
  return corsHeaderValues;
}
