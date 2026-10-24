import { z } from "zod";
import { getPmsUser, PmsAuthError } from "../../../lib/auth";
import { PmsError } from "../../../lib/pms-engine";
import { createProperty, mutatePms, readPms } from "../../../lib/server-pms";
import type { PmsAction } from "../../../lib/pms-types";
import { requestSchema } from "../../../lib/pms-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const createSchema = z.object({ name: z.string().trim().min(1).max(120), city: z.string().trim().max(2000).optional(), seedDemo: z.boolean().optional() }).strict();
const headers = { "Cache-Control": "no-store", "Vary": "Cookie" };
function errorResponse(error: unknown) {
  if (error instanceof PmsAuthError) return Response.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof PmsError) return Response.json({ error: error.message, ...(error.currentVersion !== undefined ? { version: error.currentVersion } : {}) }, { status: error.status, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "The request data is invalid." }, { status: 400, headers });
  console.error("PMS request failed", error instanceof Error ? error.name : "Unknown error");
  return Response.json({ error: "The property data could not be saved or loaded. Please retry." }, { status: 500, headers });
}
export async function GET(request: Request) {
  try {
    const user = await getPmsUser(); if (!user) return Response.json({ error: "Sign in to access your properties." }, { status: 401, headers });
    const propertyId = new URL(request.url).searchParams.get("propertyId") ?? undefined;
    const result = await readPms({ userId: user.userId, email: user.email, name: user.displayName }, propertyId); return Response.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const user = await getPmsUser(); if (!user) return Response.json({ error: "Sign in before changing property data." }, { status: 401, headers });
    const origin = request.headers.get("Origin"); if (origin && origin !== new URL(request.url).origin) return Response.json({ error: "Cross-origin changes are not allowed." }, { status: 403, headers });
    const body = await request.text(); if (body.length > 1000000) throw new PmsError(413, "The request is too large.");
    const parsed = requestSchema.parse(JSON.parse(body)); const actor = { userId: user.userId, email: user.email, name: user.displayName };
    if (parsed.action === "createProperty") return Response.json(await createProperty(actor, createSchema.parse(parsed.payload)), { status: 201, headers });
    if (!parsed.propertyId || parsed.version === undefined) throw new PmsError(400, "Property and current version are required.");
    return Response.json(await mutatePms(actor, parsed.propertyId, parsed.version, parsed.action as PmsAction, parsed.payload ?? {}), { headers });
  } catch (error) { return errorResponse(error); }
}
