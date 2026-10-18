import { NextRequest } from "next/server";
import { automationJson, authorizeAutomation, boundedJson } from "@/lib/automation/http";
import { record, text } from "@/lib/automation/model";
import { approveRehearsal, deleteRehearsal, inspectRehearsal, recoverRehearsal, startRehearsal } from "@/lib/automation/rehearsal";
import { activeOwner, dispatchEvents } from "@/lib/automation/service";

export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const denied = authorizeAutomation(request);
  if (denied) return denied;
  try {
    const result = await inspectRehearsal(activeOwner(), text(request.nextUrl.searchParams.get("id"), 100));
    if (result.eventRecorded) { try { await dispatchEvents(1); } catch { /* durable outbox remains available for retry */ } }
    return automationJson(result);
  }
  catch (error) { return automationJson({ error: error instanceof Error ? error.message : "取得に失敗しました。" }, 502); }
}
export async function POST(request: NextRequest) {
  const denied = authorizeAutomation(request, true);
  if (denied) return denied;
  try {
    const input = record(await boundedJson(request)), id = text(input.id, 100);
    if (!/^run_[a-zA-Z0-9-]+$/.test(id)) throw new Error("実行IDが不正です。");
    if (input.action === "start") {
      const run = await startRehearsal(activeOwner(), id);
      return automationJson({ id: run.id, state: run.state });
    }
    if (input.action === "delete") { await deleteRehearsal(activeOwner(), id); return automationJson({ deleted: true }); }
    if (input.action === "recover") { await recoverRehearsal(activeOwner(), id, text(input.sessionId, 256)); return automationJson({ recovered: true }); }
    if (input.action === "approve") { await approveRehearsal(activeOwner(), id, text(input.requestId, 256), text(input.decision, 20)); return automationJson({ accepted: true }); }
    throw new Error("対応していない操作です。");
  } catch (error) { return automationJson({ error: error instanceof Error ? error.message : "操作に失敗しました。" }, 400); }
}
