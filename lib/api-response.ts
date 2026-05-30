import { NextRequest, NextResponse } from "next/server";
import { corsHeaders } from "@/lib/cors";

export function jsonError(
  message: string,
  status: number,
  details?: unknown,
  request?: NextRequest,
) {
  return NextResponse.json(
    {
      error: message,
      ...(details !== undefined && process.env.NODE_ENV === "development"
        ? { details }
        : {}),
    },
    { status, headers: corsHeaders(request) },
  );
}

export function jsonOk<T extends Record<string, unknown>>(
  body: T,
  status = 200,
  request?: NextRequest,
) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(request),
  });
}
