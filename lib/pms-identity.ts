import { z } from "zod";

export type PmsUser = { userId: string; email: string; displayName: string };
export type PmsIdentity =
  | { status: "anonymous" }
  | { status: "unverified"; email: string }
  | { status: "authenticated"; user: PmsUser }
  | { status: "invalid" };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Only pass a Neon session response to this function. Server authorization uses
// the server-side SDK; browser calls use the same-origin auth route for display.
// Request headers, form fields and browser state never authorize hotel access.
export function identityFromSession(data: unknown, now = Date.now()): PmsIdentity {
  if (data === null || data === undefined) return { status: "anonymous" };
  if (record(data) && data.user === null && data.session === null) return { status: "anonymous" };
  if (!record(data) || !record(data.user) || !record(data.session)) return { status: "invalid" };
  const { user, session } = data;
  if (typeof user.id !== "string" || !user.id.trim()) return { status: "invalid" };
  if (typeof session.id !== "string" || !session.id.trim()) return { status: "invalid" };
  if (session.userId !== user.id) return { status: "invalid" };
  const expiresAt = session.expiresAt instanceof Date ? session.expiresAt.getTime()
    : typeof session.expiresAt === "string" ? Date.parse(session.expiresAt) : NaN;
  if (!Number.isFinite(expiresAt)) return { status: "invalid" };
  if (expiresAt <= now) return { status: "anonymous" };
  const parsedEmail = z.string().trim().toLowerCase().email().safeParse(user.email);
  if (!parsedEmail.success) return { status: "invalid" };
  const email = parsedEmail.data;
  if (user.emailVerified !== true) return { status: "unverified", email };
  return {
    status: "authenticated",
    user: { userId: user.id, email, displayName: typeof user.name === "string" && user.name.trim() ? user.name.trim() : email },
  };
}
