import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { emptyState, type AutomationState } from "./model";

const redisKey = "djvj:automation:v1";
let tail: Promise<unknown> = Promise.resolve();
export function storageMode() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "redis";
  if (!process.env.VERCEL) return "file";
  return "unconfigured";
}
async function redis(command: unknown[]) {
  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL!, { method: "POST", headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(command), cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("自動処理の保存先に接続できません。");
  const data = await response.json();
  if (data.error) throw new Error("自動処理の保存先でエラーが発生しました。");
  return data.result;
}
const directory = () => process.env.AUTOMATION_DATA_DIR || join(process.cwd(), ".data", "automation");
async function load(): Promise<{ raw: string | null; state: AutomationState }> {
  let raw: string | null;
  if (storageMode() === "redis") raw = await redis(["GET", redisKey]);
  else if (storageMode() === "file") {
    try { raw = await readFile(join(directory(), "state.json"), "utf8"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; raw = null; }
  } else throw new Error("Vercelでは UPSTASH_REDIS_REST_URL / TOKEN の設定が必要です。");
  return { raw, state: raw ? JSON.parse(raw) : emptyState() };
}
export async function readAutomation() { return (await load()).state; }
/** Callback must be synchronous and side-effect-free: Redis CAS can repeat it. */
export async function mutateAutomation<T>(mutate: (state: AutomationState) => T): Promise<T> {
  const work = async () => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { raw, state } = await load();
      const result = mutate(state);
      state.version++;
      const next = JSON.stringify(state);
      if (Buffer.byteLength(next) > 2 * 1024 * 1024) throw new Error("自動処理の保存容量が上限に達しました。");
      if (storageMode() === "redis") {
        const ok = await redis(["EVAL", "local old=redis.call('GET',KEYS[1]); if (old or '')~=ARGV[1] then return 0 end; redis.call('SET',KEYS[1],ARGV[2]); return 1", "1", redisKey, raw ?? "", next]);
        if (ok === 1) return result;
      } else {
        await mkdir(directory(), { recursive: true, mode: 0o700 });
        const temporary = join(directory(), `${randomUUID()}.tmp`);
        await writeFile(temporary, next, { mode: 0o600 });
        await rename(temporary, join(directory(), "state.json"));
        return result;
      }
    }
    throw new Error("保存が競合しました。もう一度お試しください。");
  };
  const result = tail.then(work, work);
  tail = result.catch(() => {});
  return result;
}
