export const EVENT_NAMES = ["schedule.updated", "request.created", "rehearsal.completed"] as const;
export type EventName = typeof EVENT_NAMES[number];
export interface StudioEvent {
  eventId: string;
  name: EventName;
  timestamp: string;
  data: { studioId: string; title: string; detail: string };
  cursor: null;
}
export interface Subscription {
  id: string; owner: string; name: EventName; studioId: string; url: string;
  secret: string; oldSecret?: string; rotationUntil?: number; expires: number;
  verifiedAt?: number;
}
export interface Delivery {
  id: string; subscriptionId: string; event: StudioEvent;
  attempts: number; nextAt: number; leaseUntil?: number; lease?: string;
  status: "pending" | "sent" | "failed"; lastStatus?: number;
}
export interface RehearsalRun {
  id: string; owner: string; sessionId?: string; createdAt: number;
  state: "creating" | "running" | "unknown" | "failed" | "deleted"; error?: string;
  reported?: boolean;
}
export interface AutomationState {
  version: number; subscriptions: Subscription[]; events: StudioEvent[];
  deliveries: Delivery[]; runs: RehearsalRun[];
}
export const emptyState = (): AutomationState => ({ version: 0, subscriptions: [], events: [], deliveries: [], runs: [] });
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("入力の形式が不正です。");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 1000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`1〜${max}文字で入力してください。`);
  return value.trim();
}
export function studioId(value: unknown) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) throw new Error("Studio ID は英数字・ハイフン・アンダースコアで指定してください。");
  return value;
}
export function eventName(value: unknown): EventName {
  if (!EVENT_NAMES.includes(value as EventName)) throw new Error("対応していないイベントです。");
  return value as EventName;
}
export function parseEvent(value: unknown, now = Date.now()): StudioEvent {
  const input = record(value), data = record(input.data);
  const eventId = text(input.eventId, 100);
  if (!/^[a-zA-Z0-9_-]+$/.test(eventId)) throw new Error("イベントIDが不正です。");
  return { eventId, name: eventName(input.name), timestamp: new Date(now).toISOString(), data: { studioId: studioId(data.studioId), title: text(data.title, 160), detail: text(data.detail, 2000) }, cursor: null };
}
export function subscriptionLifetime(ttl: unknown, now = Date.now()) {
  if (ttl !== undefined && ttl !== null && (typeof ttl !== "number" || !Number.isSafeInteger(ttl) || ttl <= 0)) throw new Error("ttlMs が不正です。");
  return now + Math.min(typeof ttl === "number" ? ttl : 86400000, 86400000);
}
export function nextDelivery(attempts: number, status: number, now = Date.now()) {
  const retryable = status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
  return retryable && attempts < 6 ? now + Math.min(3600000, 5000 * 2 ** (attempts - 1)) : null;
}
export function addEvent(state: AutomationState, event: StudioEvent, now = Date.now()) {
  const old = state.events.find((e) => e.eventId === event.eventId);
  if (old) {
    if (old.name !== event.name || JSON.stringify(old.data) !== JSON.stringify(event.data)) throw new Error("同じイベントIDが異なる内容で使われています。");
    return false;
  }
  const matching = state.subscriptions.filter((s) => s.expires > now && s.name === event.name && s.studioId === event.data.studioId);
  if (state.deliveries.filter((d) => d.status === "pending").length + matching.length > 200) throw new Error("配信待ちが上限に達しました。先に再送してください。");
  state.events.push(event);
  state.events = state.events.slice(-200);
  state.deliveries = state.deliveries.filter((d) => d.status === "pending").concat(state.deliveries.filter((d) => d.status !== "pending").slice(-100));
  for (const sub of matching) state.deliveries.push({ id: `${event.eventId}:${sub.id}`, subscriptionId: sub.id, event, attempts: 0, nextAt: now, status: "pending" });
  return true;
}
