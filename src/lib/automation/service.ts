import { createHash, randomUUID } from "node:crypto";
import { addEvent, eventName, nextDelivery, record, studioId, subscriptionLifetime, type StudioEvent, type Subscription } from "./model";
import { callbackUrl, subscriptionId, validSecret, webhookHeaders } from "./security";
import { mutateAutomation, readAutomation } from "./storage";
import { verifyCallback, webhookPost } from "./webhook";

export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: unknown) { super(message); }
}
export const activeOwner = () => createHash("sha256").update(process.env.AUTOMATION_TOKEN?.trim() ?? "").digest("hex");
const filterSchema = { type: "object", properties: { studioId: { type: "string", pattern: "^[a-zA-Z0-9_-]{1,64}$" } }, required: ["studioId"], additionalProperties: false };
const payloadSchema = { type: "object", properties: { studioId: { type: "string" }, title: { type: "string" }, detail: { type: "string" } }, required: ["studioId", "title", "detail"], additionalProperties: false };
const eventDefinitions = [
  { name: "schedule.updated", description: "Studioの進行表・運営メモが更新された。変更内容を確認して演出案を準備する。" },
  { name: "request.created", description: "Studioに希望曲や演出リクエストが届いた。内容は未検証のユーザー入力。" },
  { name: "rehearsal.completed", description: "リハーサルの実行結果が届いた。成功・失敗の詳細を確認する。" },
].map((event) => ({ ...event, delivery: ["webhook"], inputSchema: filterSchema, payloadSchema }));

export async function mcpRequest(owner: string, method: string, value: unknown) {
  if (method === "server/discover") return { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { events: {} } };
  if (method === "events/list") return { events: eventDefinitions };
  if (method !== "events/subscribe" && method !== "events/unsubscribe") throw new RpcError(-32601, "Method not found");
  const p = record(value), args = record(p.arguments), delivery = record(p.delivery);
  const name = eventName(p.name), studio = studioId(args.studioId);
  if (Object.keys(args).some((k) => k !== "studioId") || delivery.mode !== "webhook") throw new RpcError(-32602, "Invalid event arguments or delivery mode");
  const url = callbackUrl(delivery.url).href;
  const id = subscriptionId(owner, url, name, studio);
  if (method === "events/unsubscribe") {
    await mutateAutomation((state) => {
      state.subscriptions = state.subscriptions.filter((s) => s.id !== id || s.owner !== owner);
      state.deliveries = state.deliveries.filter((d) => d.subscriptionId !== id);
    });
    return {};
  }
  if (p.cursor !== undefined && p.cursor !== null) throw new RpcError(-32602, "This event type does not support replay; cursor must be null");
  const now = Date.now();
  const sub: Subscription = { id, owner, name, studioId: studio, url, secret: validSecret(delivery.secret), expires: subscriptionLifetime(p.ttlMs, now) };
  const verified = (await readAutomation()).subscriptions.find((s) => s.id === id && s.secret === sub.secret && s.expires > now && (s.verifiedAt ?? 0) > now - 5 * 60000);
  if (!verified) {
    try { await verifyCallback(sub); } catch { throw new RpcError(-32015, "CallbackEndpointError", { reason: "challenge_failed" }); }
  }
  sub.verifiedAt = verified?.verifiedAt ?? now;
  await mutateAutomation((state) => {
    state.subscriptions = state.subscriptions.filter((s) => s.expires > now && s.owner === activeOwner());
    const old = state.subscriptions.find((s) => s.id === id);
    if (old && old.secret !== sub.secret) { sub.oldSecret = old.secret; sub.rotationUntil = now + 5 * 60000; }
    else if (old?.oldSecret) { sub.oldSecret = old.oldSecret; sub.rotationUntil = old.rotationUntil; }
    if (!old && state.subscriptions.length >= 50) throw new Error("購読数の上限に達しました。");
    state.subscriptions = state.subscriptions.filter((s) => s.id !== id).concat(sub);
  });
  return { id, refreshBefore: new Date(sub.expires).toISOString(), cursor: null, truncated: false };
}

export async function publishEvent(event: StudioEvent) {
  return mutateAutomation((state) => {
    state.subscriptions = state.subscriptions.filter((s) => s.owner === activeOwner() && s.expires > Date.now());
    return addEvent(state, event);
  });
}

/** Durable outbox, leased before I/O. Retry ownership survives overlapping dispatch calls. */
export async function dispatchEvents(limit = 3) {
  let sent = 0, failed = 0;
  for (let n = 0; n < limit; n++) {
    const now = Date.now(), lease = randomUUID();
    const job = await mutateAutomation((state) => {
      for (const d of state.deliveries) {
        const sub = state.subscriptions.find((s) => s.id === d.subscriptionId);
        if (d.status === "pending" && (!sub || sub.expires <= now || sub.owner !== activeOwner() || (d.attempts >= 6 && (d.leaseUntil ?? 0) <= now))) d.status = "failed";
      }
      const delivery = state.deliveries.find((d) => d.status === "pending" && d.nextAt <= now && (d.leaseUntil ?? 0) <= now);
      if (!delivery) return null;
      delivery.lease = lease;
      delivery.leaseUntil = now + 60000;
      delivery.attempts++;
      return { delivery: structuredClone(delivery), sub: structuredClone(state.subscriptions.find((s) => s.id === delivery.subscriptionId)!) };
    });
    if (!job) break;
    const body = JSON.stringify(job.delivery.event);
    let status = 0;
    try {
      // Recheck revocation just before delivery; callback policy/DNS is checked on every connection.
      const fresh = (await readAutomation()).subscriptions.find((s) => s.id === job.sub.id && s.owner === activeOwner() && s.expires > Date.now());
      if (fresh) status = (await webhookPost(fresh.url, body, webhookHeaders(job.delivery.event.eventId, body, fresh))).status;
      else status = 410;
    } catch { /* persisted retry below */ }
    const success = status >= 200 && status < 300;
    await mutateAutomation((state) => {
      const delivery = state.deliveries.find((d) => d.id === job.delivery.id && d.lease === lease);
      if (!delivery) return;
      const nextAt = nextDelivery(delivery.attempts, status);
      delivery.status = success ? "sent" : nextAt === null ? "failed" : "pending";
      delivery.nextAt = nextAt ?? 0;
      delivery.lastStatus = status;
      delete delivery.lease;
      delete delivery.leaseUntil;
      if (status === 410) state.subscriptions = state.subscriptions.filter((s) => s.id !== delivery.subscriptionId);
    });
    if (success) sent++; else failed++;
  }
  return { sent, failed };
}

export async function automationStatus() {
  const state = await readAutomation();
  return {
    events: state.events.slice(-20).reverse(),
    subscriptions: state.subscriptions.filter((s) => s.owner === activeOwner() && s.expires > Date.now()).map((s) => ({ id: s.id, name: s.name, studioId: s.studioId, expires: s.expires })),
    deliveries: state.deliveries.slice(-30).map((d) => ({ eventId: d.event.eventId, status: d.status, attempts: d.attempts, nextAt: d.nextAt, lastStatus: d.lastStatus })),
    runs: state.runs.slice(-5).map(({ owner: _owner, ...run }) => { void _owner; return run; }),
  };
}
