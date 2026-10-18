import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { addEvent, emptyState, nextDelivery, parseEvent, subscriptionLifetime } from "../src/lib/automation/model.ts";
import { callbackUrl, publicAddress, rehearsalTicket, subscriptionId, validSecret, verifyRehearsalTicket, webhookHeaders } from "../src/lib/automation/security.ts";

const key = `whsec_${Buffer.alloc(32, 7).toString("base64")}`;
const input = { eventId: "evt_1", name: "schedule.updated", data: { studioId: "main", title: "登壇変更", detail: "10分後ろへ", blob: "private" } };
const subscription = { id: "sub1", owner: "owner", name: "schedule.updated" as const, studioId: "main", url: "https://callbacks.example/hook", secret: key, expires: 10000 };

test("events whitelist fields, bound payloads and assign server timestamps", () => {
  const event = parseEvent(input, 1000);
  assert.deepEqual(event, { eventId: "evt_1", name: "schedule.updated", timestamp: "1970-01-01T00:00:01.000Z", data: { studioId: "main", title: "登壇変更", detail: "10分後ろへ" }, cursor: null });
  for (const bad of [{ ...input, name: "delete.everything" }, { ...input, eventId: "../x" }, { ...input, data: { ...input.data, studioId: "other/room" } }, { ...input, data: { ...input.data, detail: "x".repeat(2001) } }]) assert.throws(() => parseEvent(bad));
});

test("subscription identity is deterministic and separated by owner, callback, event and studio", () => {
  const id = subscriptionId("a", "https://callbacks.example/1", "schedule.updated", "main");
  assert.equal(id, subscriptionId("a", "https://callbacks.example/1", "schedule.updated", "main"));
  assert.equal(new Set([id, subscriptionId("b", "https://callbacks.example/1", "schedule.updated", "main"), subscriptionId("a", "https://callbacks.example/2", "schedule.updated", "main"), subscriptionId("a", "https://callbacks.example/1", "request.created", "main"), subscriptionId("a", "https://callbacks.example/1", "schedule.updated", "other")]).size, 5);
});

test("subscriptions grant bounded lifetimes and reject invalid TTLs", () => {
  assert.equal(subscriptionLifetime(undefined, 0), 86400000);
  assert.equal(subscriptionLifetime(null, 0), 86400000);
  assert.equal(subscriptionLifetime(1000, 0), 1000);
  assert.equal(subscriptionLifetime(999999999, 0), 86400000);
  for (const ttl of [-1, 0, 1.5, NaN, "1000"]) assert.throws(() => subscriptionLifetime(ttl));
});

test("outbox filters by event, studio and expiry, preserving stable event IDs on retry", () => {
  const state = emptyState();
  state.subscriptions = [subscription, { ...subscription, id: "wrong-event", name: "request.created" }, { ...subscription, id: "wrong-room", studioId: "other" }, { ...subscription, id: "expired", expires: 10 }];
  const event = parseEvent(input, 100);
  assert.equal(addEvent(state, event, 100), true);
  assert.equal(state.deliveries.length, 1);
  assert.equal(state.deliveries[0].subscriptionId, "sub1");
  assert.equal(addEvent(state, parseEvent(input, 200), 200), false);
  assert.equal(state.deliveries.length, 1);
  assert.throws(() => addEvent(state, parseEvent({ ...input, data: { ...input.data, title: "different" } }, 200), 200));
  assert.equal(state.deliveries[0].event.eventId, "evt_1");
});

test("Standard Webhooks signs exact bytes and rotates using space-separated signatures", () => {
  assert.equal(validSecret(key), key);
  for (const value of ["secret", "whsec_bad", `whsec_${Buffer.alloc(65).toString("base64")}`]) assert.throws(() => validSecret(value));
  const body = JSON.stringify(parseEvent(input, 1000));
  const headers = webhookHeaders("evt_1", body, { id: "sub1", secret: key }, 1000);
  const expected = createHmac("sha256", Buffer.alloc(32, 7)).update(`evt_1.1.${body}`).digest("base64");
  assert.equal(headers["webhook-signature"], `v1,${expected}`);
  assert.equal(headers["X-MCP-Subscription-Id"], "sub1");
  const rotated = { id: "sub1", secret: key, oldSecret: `whsec_${Buffer.alloc(32, 8).toString("base64")}`, rotationUntil: 2000 };
  assert.equal(webhookHeaders("evt_1", body, rotated, 1000)["webhook-signature"].split(" ").length, 2);
  assert.equal(webhookHeaders("evt_1", body, rotated, 3000)["webhook-signature"].split(" ").length, 1);
});

test("callback policy blocks local, private, metadata, mapped IPv6, redirects and unregistered hosts", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "172.16.0.1", "192.168.1.1", "0.0.0.0", "198.18.0.1", "192.0.2.1", "203.0.113.1", "224.0.0.1", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2002:7f00:1::1", "2001:db8::1"]) assert.equal(publicAddress(address), false, address);
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700::1111"]) assert.equal(publicAddress(address), true, address);
  assert.equal(callbackUrl("https://callbacks.example/hook", ["callbacks.example"]).hostname, "callbacks.example");
  for (const url of ["http://callbacks.example/hook", "https://localhost/hook", "https://127.0.0.1/hook", "https://callbacks.example.evil/hook", "https://user:pass@callbacks.example/hook", "https://callbacks.example:8443/hook"]) assert.throws(() => callbackUrl(url, ["callbacks.example"]));
});

test("delivery backoff is bounded and never retries 410, 413 or other permanent failures", () => {
  assert.equal(nextDelivery(1, 500, 0), 5000);
  assert.equal(nextDelivery(2, 429, 0), 10000);
  assert.equal(nextDelivery(1, 0, 0), 5000);
  for (const status of [200, 301, 400, 401, 403, 410, 413]) assert.equal(nextDelivery(1, status, 0), null);
  assert.equal(nextDelivery(6, 503, 0), null);
});

test("rehearsal tickets are scoped, short-lived and reject tampering", () => {
  const old = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = "rehearsal-test-secret-".repeat(3);
  try {
    const ticket = rehearsalTicket(1000);
    assert.equal(verifyRehearsalTicket(ticket, 1001), true);
    assert.equal(verifyRehearsalTicket(ticket, 1000 + 15 * 60000), false);
    assert.equal(verifyRehearsalTicket(ticket + "x", 1001), false);
    const payload = Buffer.from(JSON.stringify({ scope: "studio", exp: 10000 })).toString("base64url");
    const signed = `${payload}.${createHmac("sha256", process.env.AUTH_SECRET).update(payload).digest("base64url")}`;
    assert.equal(verifyRehearsalTicket(signed, 1001), false);
  } finally { if (old === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = old; }
});
