import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import { randomUUID } from "node:crypto";
import { callbackUrl, equal, publicAddress, webhookHeaders } from "./security";
import type { Subscription } from "./model";

/** DNS is resolved for every connection and the selected public address is pinned through lookup. */
export async function webhookPost(destination: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  const url = callbackUrl(destination);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw new Error("通知先のアドレスを検証できません。");
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const options: RequestOptions & { autoSelectFamily: boolean } = { method: "POST", headers, agent: false, autoSelectFamily: false, lookup: (_hostname, _options, callback) => callback(null, address.address, address.family) };
    const req = request(url, options, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32768) response.destroy(new Error("通知先の応答が長すぎます。")); else chunks.push(chunk); });
      response.on("end", () => { clearTimeout(timer); resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }); });
      response.on("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const timer = setTimeout(() => req.destroy(new Error("通知先への接続がタイムアウトしました。")), 8000);
    req.on("error", (error) => { clearTimeout(timer); reject(error); });
    req.end(body);
  });
}
export async function verifyCallback(sub: Subscription, transport = webhookPost) {
  const challenge = randomUUID();
  const id = `verify_${randomUUID()}`;
  const body = JSON.stringify({ type: "verification", challenge });
  const response = await transport(sub.url, body, webhookHeaders(id, body, sub));
  let echoed: unknown;
  try { echoed = JSON.parse(response.body).challenge; } catch { /* reject below */ }
  if (response.status < 200 || response.status >= 300 || typeof echoed !== "string" || !equal(echoed, challenge)) throw new Error("通知先のチャレンジ検証に失敗しました。");
}
