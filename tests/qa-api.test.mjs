import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const withZod = (source) => source.replace(/from ["']zod["']/g, `from ${JSON.stringify(import.meta.resolve("zod"))}`);
const typesUrl = moduleUrl(compile(await readFile(new URL("../lib/pms-types.ts", import.meta.url), "utf8")));
const engineUrl = moduleUrl(withZod(compile(await readFile(new URL("../lib/pms-engine.ts", import.meta.url), "utf8")))
  .replace(/from ["']\.\/pms-types(?:\.ts)?["']/g, `from ${JSON.stringify(typesUrl)}`));
const requestUrl = moduleUrl(withZod(compile(await readFile(new URL("../lib/pms-request.ts", import.meta.url), "utf8"))));
const { requestSchema, buildPmsRequest } = await import(requestUrl);

// Run the application's real POST handler and request contract in memory. Auth
// and D1 are explicit stubs: these tests verify routing/validation, not hosted
// authentication or database persistence.
const actor = { userId: "contract-owner", email: "owner@contract.test", displayName: "Contract Owner" };
const authUrl = moduleUrl(`export let user = ${JSON.stringify(actor)}; export const setUser = value => { user = value; }; export async function getChatGPTUser() { return user; }`);
const serverUrl = moduleUrl(`
  export const calls = [];
  export async function createProperty(actor, payload) { calls.push({ kind: "create", actor, payload }); return { state: { property: { id: "contract-property", name: payload.name } }, version: 0 }; }
  export async function mutatePms(actor, propertyId, version, action, payload) { calls.push({ kind: "mutate", actor, propertyId, version, action, payload }); return { state: { property: { id: propertyId } }, version: version + 1 }; }
  export async function readPms() { throw new Error("Unexpected read in request-contract test"); }
`);
const auth = await import(authUrl);
const server = await import(serverUrl);
const routeCode = withZod(compile(await readFile(new URL("../app/api/pms/route.ts", import.meta.url), "utf8")))
  .replace(/from ["']\.\.\/\.\.\/chatgpt-auth["']/g, `from ${JSON.stringify(authUrl)}`)
  .replace(/from ["']\.\.\/\.\.\/\.\.\/lib\/pms-engine["']/g, `from ${JSON.stringify(engineUrl)}`)
  .replace(/from ["']\.\.\/\.\.\/\.\.\/lib\/server-pms["']/g, `from ${JSON.stringify(serverUrl)}`)
  .replace(/from ["']\.\.\/\.\.\/\.\.\/lib\/pms-request["']/g, `from ${JSON.stringify(requestUrl)}`);
const { POST } = await import(moduleUrl(routeCode));
const emptyResponse = {
  user: actor, properties: [], state: null, version: null, role: null, permissions: [],
};
const selectedResponse = {
  ...emptyResponse,
  properties: [{ id: "existing-property", name: "Existing Hotel", role: "owner" }],
  state: { property: { id: "existing-property" } }, version: 0, role: "owner",
};
const serialized = (body) => JSON.parse(JSON.stringify(body));
const post = (body, origin = "https://pms.contract.test") => POST(new Request("https://pms.contract.test/api/pms", {
  method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body),
}));
function reset() { auth.setUser(actor); server.calls.length = 0; }

test("first empty and sample property requests pass the real schema after a null-version initial response", () => {
  for (const payload of [
    { name: "Gulf Inn", city: "Lahore", seedDemo: false },
    { name: "Sample Guesthouse", city: "Islamabad", seedDemo: true },
  ]) {
    const wire = serialized(buildPmsRequest("createProperty", payload, emptyResponse));
    assert.deepEqual(wire, { action: "createProperty", payload });
    assert.deepEqual(requestSchema.parse(wire), wire);
    assert.equal(requestSchema.safeParse({ action: "createProperty", payload, version: null }).success, false, "the legacy null-version request is the reproduced failing boundary");
  }
});

test("creating another property omits the currently selected property's ID and version", () => {
  const payload = { name: "Second Hotel", seedDemo: false };
  const wire = serialized(buildPmsRequest("createProperty", payload, selectedResponse));
  assert.deepEqual(wire, { action: "createProperty", payload });
  assert.ok(requestSchema.safeParse(wire).success);
});

test("normal mutation requests retain version zero and continue to reject missing/null/invalid context", () => {
  const payload = { name: "New Guest" };
  const wire = serialized(buildPmsRequest("saveGuest", payload, selectedResponse));
  assert.deepEqual(wire, { action: "saveGuest", payload, propertyId: "existing-property", version: 0 });
  assert.ok(requestSchema.safeParse(wire).success);
  for (const response of [undefined, null, emptyResponse, { ...selectedResponse, version: null }, { ...selectedResponse, version: -1 }, { ...selectedResponse, version: 0.5 }]) {
    assert.throws(() => buildPmsRequest("saveGuest", payload, response), /Select a property before saving changes/);
  }
  for (const version of [null, -1, 0.5]) {
    assert.equal(requestSchema.safeParse({ ...wire, version }).success, false);
  }
});

test("real POST handler reaches property creation and returns 201 for first empty/sample requests", async () => {
  reset();
  for (const seedDemo of [false, true]) {
    const payload = { name: seedDemo ? "Sample Hotel" : "Gulf Inn", city: "Lahore", seedDemo };
    const response = await post(buildPmsRequest("createProperty", payload, emptyResponse));
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.state.property.name, payload.name);
    assert.deepEqual(server.calls.at(-1), { kind: "create", actor: { userId: actor.userId, email: actor.email, name: actor.displayName }, payload });
  }
  assert.equal(server.calls.length, 2);
});

test("real POST handler still blocks unauthenticated creation, bad mutation versions and cross-origin changes", async () => {
  reset();
  auth.setUser(null);
  assert.equal((await post(buildPmsRequest("createProperty", { name: "Forbidden Hotel" }, emptyResponse))).status, 401);
  assert.equal(server.calls.length, 0);
  auth.setUser(actor);
  for (const version of [undefined, null, -1, 0.5]) {
    const invalidMutation = { action: "saveGuest", payload: { name: "Rejected Guest" }, propertyId: "existing-property", version };
    assert.equal((await post(invalidMutation)).status, 400);
  }
  assert.equal((await post(buildPmsRequest("createProperty", { name: "Rejected Origin" }, emptyResponse), "https://outside.invalid")).status, 403);
  assert.equal(server.calls.length, 0, "rejected requests never call persistence");
  const valid = await post(buildPmsRequest("saveGuest", { name: "Version Zero Guest" }, selectedResponse));
  assert.equal(valid.status, 200);
  assert.equal(server.calls.at(-1).version, 0);
  assert.equal(server.calls.at(-1).propertyId, "existing-property");
});

const base = process.env.PMS_QA_BASE_URL;

test("local API enforces identity, property isolation, origin checks and optimistic concurrency", { skip: !base }, async () => {
  const url = new URL(base);
  assert.ok(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname), "API acceptance tests run only against a local preview");
  const endpoint = new URL("/api/pms", url);

  const unauthenticated = await fetch(endpoint);
  assert.equal(unauthenticated.status, 401, "anonymous users cannot read hotel records");
  assert.match(unauthenticated.headers.get("cache-control") ?? "", /no-store/);

  let cookie = process.env.PMS_QA_COOKIE;
  if (!cookie) {
    const signin = await fetch(new URL("/signin-with-chatgpt?return_to=/", url), { redirect: "manual" });
    cookie = signin.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  }
  assert.ok(cookie, "local preview sign-in must provide a cookie (or set PMS_QA_COOKIE)");

  const request = async (body, origin = url.origin) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { status: response.status, data };
  };
  const get = async (propertyId) => {
    const readUrl = new URL(endpoint);
    if (propertyId) readUrl.searchParams.set("propertyId", propertyId);
    const response = await fetch(readUrl, { headers: { cookie } });
    return { status: response.status, data: await response.json() };
  };

  const created = await request({ action: "createProperty", payload: { name: `QA ${new Date().toISOString()}`, city: "Lahore", seedDemo: false } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const propertyId = created.data.state.property.id;
  const initialVersion = created.data.version;
  assert.equal(typeof initialVersion, "number");

  const competitors = await Promise.all([
    request({ action: "saveRoomType", propertyId, version: initialVersion, payload: { name: "Concurrent A" } }),
    request({ action: "saveRoomType", propertyId, version: initialVersion, payload: { name: "Concurrent B" } }),
  ]);
  assert.deepEqual(competitors.map((item) => item.status).sort(), [200, 409], "one concurrent writer succeeds; the other must refresh");
  let read = await get(propertyId);
  assert.equal(read.status, 200);
  assert.equal(read.data.version, initialVersion + 1);
  assert.equal(read.data.state.roomTypes.length, 1, "the rejected writer cannot partly save its room type");

  const stale = await request({ action: "saveGuest", propertyId, version: initialVersion, payload: { name: "Stale guest" } });
  assert.equal(stale.status, 409);
  read = await get(propertyId);
  assert.equal(read.data.state.guests.length, 0);

  const foreignRead = await get("qa-nonmember-property");
  assert.equal(foreignRead.status, 403, "a property outside the user's memberships is inaccessible");
  const foreignWrite = await request({ action: "saveGuest", propertyId: "qa-nonmember-property", version: 0, payload: { name: "Foreign write" } });
  assert.ok([403, 404].includes(foreignWrite.status), "unknown/foreign properties reject writes");

  const rejectedOrigin = await request({ action: "saveGuest", propertyId, version: read.data.version, payload: { name: "Cross-origin guest" } }, "https://outside.invalid");
  assert.equal(rejectedOrigin.status, 403);
  const invalid = await request({ action: "saveRoom", propertyId, version: read.data.version, payload: { number: "X", typeId: "missing-type", unexpected: "field" } });
  assert.equal(invalid.status, 400);
  const afterRejections = await get(propertyId);
  assert.equal(afterRejections.data.version, read.data.version, "rejected requests leave the saved version unchanged");
  assert.equal(afterRejections.data.state.guests.length, 0);

  const valid = await request({ action: "saveGuest", propertyId, version: read.data.version, payload: { name: "Persisted QA Guest" } });
  assert.equal(valid.status, 200, JSON.stringify(valid.data));
  const reloaded = await get(propertyId);
  assert.equal(reloaded.data.version, read.data.version + 1);
  assert.equal(reloaded.data.state.guests[0].name, "Persisted QA Guest", "subsequent read sees persisted data");
});
