import "server-only";
import { createNeonAuth } from "@neondatabase/auth/next/server";
import { identityFromSession, type PmsIdentity, type PmsUser } from "./pms-identity";

export class PmsAuthError extends Error {
  constructor(public status: 403 | 503, message: string) { super(message); this.name = "PmsAuthError"; }
}

let instance: ReturnType<typeof createNeonAuth> | undefined;

export function getNeonAuth() {
  if (instance) return instance;
  const baseUrl = process.env.NEON_AUTH_BASE_URL;
  const secret = process.env.NEON_AUTH_COOKIE_SECRET;
  if (!baseUrl || !secret || secret.length < 32) {
    throw new PmsAuthError(503, "Sign-in is not configured yet. Please contact the property owner.");
  }
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new PmsAuthError(503, "Sign-in is temporarily unavailable. Please try again."); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PmsAuthError(503, "Sign-in is temporarily unavailable. Please try again.");
  }
  // The SDK instance is reusable; user/session results are never cached here.
  instance = createNeonAuth({ baseUrl, cookies: { secret } });
  return instance;
}

export async function getPmsIdentity(): Promise<PmsIdentity> {
  try {
    // Hotel records require a current provider session, including after logout
    // or revocation on another device. Do not authorize from the SDK cookie cache.
    const { data, error } = await getNeonAuth().getSession({ query: { disableCookieCache: "true" } });
    if (error) throw new PmsAuthError(503, "Sign-in could not be checked. Please try again.");
    const identity = identityFromSession(data);
    if (identity.status === "invalid") throw new PmsAuthError(503, "Sign-in could not be checked. Please try again.");
    return identity;
  } catch (error) {
    if (error instanceof PmsAuthError) throw error;
    throw new PmsAuthError(503, "Sign-in could not be checked. Please try again.");
  }
}

export async function getPmsUser(): Promise<PmsUser | null> {
  const identity = await getPmsIdentity();
  if (identity.status === "unverified") throw new PmsAuthError(403, "Verify your email before accessing property records. Open Login / account to continue.");
  return identity.status === "authenticated" ? identity.user : null;
}
