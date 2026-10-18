import { NextRequest } from "next/server";
import { automationJson, authorizeAutomation } from "@/lib/automation/http";
import { dispatchEvents } from "@/lib/automation/service";
import { equal } from "@/lib/automation/security";

export const maxDuration = 60;
export async function POST(request: NextRequest) {
  const denied = authorizeAutomation(request, true);
  if (denied) return denied;
  try { return automationJson(await dispatchEvents(5)); } catch { return automationJson({ error: "配信処理に失敗しました。保存先を確認してください。" }, 503); }
}
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || !equal(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return automationJson({ error: "Cron認証が必要です。" }, 401);
  try { return automationJson(await dispatchEvents(5)); } catch { return automationJson({ error: "配信処理に失敗しました。" }, 503); }
}
