import test from "node:test";
import assert from "node:assert/strict";
import { AgentRequestError, deleteAgentSession } from "../src/lib/automation/agent-session.ts";

test("running Agents sessions are cancelled before deletion and wait for execution to stop", async () => {
  const calls: unknown[] = [];
  let deletes = 0;
  await deleteAgentSession(async (path, body, method, signal) => {
    assert.ok(signal instanceof AbortSignal);
    calls.push([path, method, body]);
    if (method === "DELETE" && ++deletes < 3) throw new AgentRequestError("busy", 409);
    return {};
  }, "/session", async () => { calls.push("wait"); });
  assert.deepEqual(calls, [
    ["/session", "DELETE", undefined],
    ["/session/events", "POST", { events: [{ type: "agent.session.input.cancel" }] }],
    "wait", ["/session", "DELETE", undefined], "wait", ["/session", "DELETE", undefined],
  ]);
});

test("idle and already deleted sessions finish without cancellation", async () => {
  for (const status of [200, 404]) {
    let calls = 0;
    await deleteAgentSession(async (_path, _body, method) => {
      calls++;
      assert.equal(method, "DELETE");
      if (status === 404) throw new AgentRequestError("gone", 404);
    }, "/session");
    assert.equal(calls, 1);
  }
});

test("failed or unfinished deletion keeps an error available for retry", async () => {
  let calls = 0;
  await assert.rejects(deleteAgentSession(async () => {
    calls++;
    throw new AgentRequestError("denied", 403);
  }, "/session"), /denied/);
  assert.equal(calls, 1);
  await assert.rejects(deleteAgentSession(async (_path, _body, method) => {
    if (method === "DELETE") throw new AgentRequestError("busy", 409);
  }, "/session", async () => {}), /セッション情報は保持/);
});
