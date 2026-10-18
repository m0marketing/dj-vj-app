import { NextRequest } from "next/server";
import { automationJson, boundedJson } from "@/lib/automation/http";
import { bearerOwner } from "@/lib/automation/security";
import { mcpRequest, RpcError } from "@/lib/automation/service";
import { record } from "@/lib/automation/model";

export const maxDuration = 30;
export async function POST(request: NextRequest) {
  const owner = bearerOwner(request);
  if (!owner) return automationJson({ error: "MCPのBearerトークンが必要です。" }, 401);
  let id: string | number | null = null;
  try {
    const rpc = record(await boundedJson(request));
    if (rpc.jsonrpc !== "2.0" || (typeof rpc.id !== "string" && typeof rpc.id !== "number") || typeof rpc.method !== "string") throw new RpcError(-32600, "Invalid Request");
    id = rpc.id;
    const result = await mcpRequest(owner, rpc.method, rpc.params);
    return automationJson({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const rpc = error instanceof RpcError ? error : new RpcError(-32602, error instanceof Error ? error.message : "Invalid params");
    return automationJson({ jsonrpc: "2.0", id, error: { code: rpc.code, message: rpc.message, ...(rpc.data ? { data: rpc.data } : {}) } });
  }
}
