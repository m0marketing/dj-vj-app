import { NextRequest } from "next/server";
import { automationJson, authorizeAutomation, boundedJson } from "@/lib/automation/http";
import { parseEvent } from "@/lib/automation/model";
import { automationStatus, dispatchEvents, publishEvent } from "@/lib/automation/service";
import { storageMode } from "@/lib/automation/storage";

export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const denied = authorizeAutomation(request);
  if (denied) return denied;
  const storage = storageMode();
  try { return automationJson({ storage, mcpConfigured: (process.env.AUTOMATION_TOKEN?.length ?? 0) >= 32 && !!process.env.MCP_CALLBACK_HOSTS, agentsConfigured: !!process.env.OPENAI_API_KEY && !!process.env.REHEARSAL_BASE_URL, ...(storage !== "unconfigured" ? await automationStatus() : {}) }); }
  catch { return automationJson({ error: "自動処理の保存先に接続できません。設定を確認してください。" }, 503); }
}
export async function POST(request: NextRequest) {
  const denied = authorizeAutomation(request, true);
  if (denied) return denied;
  try {
    const event = parseEvent(await boundedJson(request));
    const created = await publishEvent(event);
    const delivery = await dispatchEvents();
    return automationJson({ eventId: event.eventId, created, delivery });
  } catch (error) { return automationJson({ error: error instanceof Error ? error.message : "イベントを保存できませんでした。" }, 400); }
}
