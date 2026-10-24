import type { NextRequest } from "next/server";
import { getNeonAuth, PmsAuthError } from "../../../../lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };

async function handle(method: "GET" | "POST", request: NextRequest, context: Context) {
  try {
    const response = await getNeonAuth().handler()[method](request, context);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return Response.json({ error: { message: error instanceof PmsAuthError ? error.message : "Sign-in is temporarily unavailable. Please try again." } }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
export async function GET(request: NextRequest, context: Context) { return handle("GET", request, context); }
export async function POST(request: NextRequest, context: Context) { return handle("POST", request, context); }
