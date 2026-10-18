import { test, after } from "node:test";
import assert from "node:assert/strict";
import { authConfigured, checkAccessCode, createSession, hashAccessCode, safeNext, sameOrigin, SESSION_SECONDS, verifySession } from "../src/lib/auth.ts";

const originalHash = process.env.ACCESS_CODE_HASH;
const originalSecret = process.env.AUTH_SECRET;
process.env.ACCESS_CODE_HASH = hashAccessCode("test-studio-code");
process.env.AUTH_SECRET = "a-test-only-secret-with-at-least-32-characters";
after(() => {
  if (originalHash === undefined) delete process.env.ACCESS_CODE_HASH;
  else process.env.ACCESS_CODE_HASH = originalHash;
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

test("access code is checked on the server and missing configuration fails closed", () => {
  assert.equal(authConfigured(), true);
  assert.equal(checkAccessCode(" test-studio-code "), true);
  for (const code of ["wrong", "", null, {}, "x".repeat(257)]) assert.equal(checkAccessCode(code), false);
  const hash = process.env.ACCESS_CODE_HASH;
  delete process.env.ACCESS_CODE_HASH;
  assert.equal(checkAccessCode("test-studio-code"), false);
  assert.equal(verifySession("anything"), false);
  assert.throws(() => createSession());
  process.env.ACCESS_CODE_HASH = hash;
});

test("signed sessions reject tampering, expiry and access-code rotation", () => {
  const now = 1790000000000;
  const token = createSession(now);
  assert.equal(verifySession(token, now), true);
  assert.equal(verifySession(token, now + SESSION_SECONDS * 1000), false);
  assert.equal(verifySession(token + ".extra", now), false);
  const [payload, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS * 2, nonce: "a".repeat(32) })).toString("base64url");
  assert.equal(verifySession(`${forged}.${signature}`, now), false);
  assert.equal(verifySession(`${payload}.${signature.slice(0, -1)}!`, now), false);
  const hash = process.env.ACCESS_CODE_HASH;
  process.env.ACCESS_CODE_HASH = hashAccessCode("rotated-code");
  assert.equal(verifySession(token, now), false);
  process.env.ACCESS_CODE_HASH = hash;
});

test("login redirects stay on this site and auth writes reject foreign origins", () => {
  assert.equal(safeNext("/vj?screen=1"), "/vj?screen=1");
  for (const next of ["https://evil.example", "//evil.example", "/\\evil.example", "/login", "/api/auth/logout", null]) assert.equal(safeNext(next), "/");
  assert.equal(sameOrigin(new Request("https://studio.example/api/auth/login", { headers: { origin: "https://studio.example" } })), true);
  assert.equal(sameOrigin(new Request("https://studio.example/api/auth/login", { headers: { origin: "https://evil.example" } })), false);
  assert.equal(sameOrigin(new Request("https://studio.example/api/auth/login")), false);
});
