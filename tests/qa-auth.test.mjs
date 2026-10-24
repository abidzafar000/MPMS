import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../lib/pms-identity.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/from ["']zod["']/g, `from ${JSON.stringify(import.meta.resolve("zod"))}`);
const { identityFromSession } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const now = Date.parse("2026-10-20T12:00:00Z");
const session = () => ({ user: { id: "neon-owner", email: " Owner@Hotel.Test ", name: " Hotel Owner ", emailVerified: true }, session: { id: "neon-session", userId: "neon-owner", expiresAt: "2026-10-20T13:00:00Z" } });

test("only a live verified provider identity becomes a normalized PMS actor", () => {
  assert.deepEqual(identityFromSession(session(), now), { status: "authenticated", user: { userId: "neon-owner", email: "owner@hotel.test", displayName: "Hotel Owner" } });
  const unnamed = session(); unnamed.user.name = " ";
  assert.equal(identityFromSession(unnamed, now).user.displayName, "owner@hotel.test");
});

test("verification must be a true boolean before an invited email can be used", () => {
  for (const value of [false, undefined, null, "true", 1]) {
    const data = session(); data.user.emailVerified = value;
    assert.deepEqual(identityFromSession(data, now), { status: "unverified", email: "owner@hotel.test" });
  }
});

test("absent and expired sessions do not grant access despite a verified user record", () => {
  for (const value of [null, undefined, { session: null, user: null }]) assert.equal(identityFromSession(value, now).status, "anonymous");
  const data = session(); data.session.expiresAt = "2026-10-20T12:00:00Z";
  assert.equal(identityFromSession(data, now).status, "anonymous");
  data.session.expiresAt = "2026-10-19T12:00:00Z";
  assert.equal(identityFromSession(data, now).status, "anonymous");
});

test("malformed and mismatched provider results fail closed", () => {
  const cases = [true, {}, { user: session().user }, { session: session().session }];
  for (const field of ["id", "email"]) { const data = session(); data.user[field] = ""; cases.push(data); }
  const mismatched = session(); mismatched.session.userId = "other-person"; cases.push(mismatched);
  const invalidDate = session(); invalidDate.session.expiresAt = "not-a-date"; cases.push(invalidDate);
  const missingSession = session(); delete missingSession.session.id; cases.push(missingSession);
  for (const data of cases) assert.equal(identityFromSession(data, now).status, "invalid");
});

test("server Date expiry values work without exposing session tokens or extra user metadata", () => {
  const data = session(); data.session.expiresAt = new Date("2026-10-20T13:00:00Z"); data.session.token = "must-never-be-returned"; data.user.privateMetadata = { secret: "private" };
  const result = identityFromSession(data, now);
  assert.equal(result.status, "authenticated");
  assert.deepEqual(Object.keys(result.user).sort(), ["displayName", "email", "userId"]);
  assert.ok(!JSON.stringify(result).includes("must-never-be-returned"));
});
