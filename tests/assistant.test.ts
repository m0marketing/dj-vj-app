import { test } from "node:test";
import assert from "node:assert/strict";
import { decisionRequest, MAX_TRACKS, parseAssistantRequest, parseAssistantResult, SCENES, setlistRequest, trackForAssistant } from "../src/lib/ai/assistant.ts";
import { BUILTIN_LOOKS } from "../src/lib/types.ts";

const candidates = [
  { id: "a", name: "朝", duration: 180, bpm: 120, key: "8A" },
  { id: "b", name: "夜", duration: 240, bpm: null, key: null },
];
const request = () => parseAssistantRequest({ kind: "set", prompt: "ゆっくり始める", tracks: candidates, count: 2 });
const completed = (tracks = [{ trackId: "a", reason: "120 BPM から開始" }, { trackId: "b", reason: "テンポ未解析のため事前に確認" }]) => ({
  status: "completed",
  output: [{ type: "reasoning", summary: [] }, { type: "message", content: [{ type: "output_text", text: JSON.stringify({ title: "夜のセット", summary: "曲情報に基づく候補です。", tracks }) }] }],
});

test("assistant payload drops audio and unnecessary track data at both boundaries", () => {
  const track = { ...candidates[0], blob: new Blob(["private audio"]), vocalMap: [1, 0], cues: [30], size: 1024 };
  assert.deepEqual(trackForAssistant(track), candidates[0]);
  const parsed = parseAssistantRequest({ kind: "set", prompt: "  曲順  ", count: 2, tracks: [track, candidates[1]], apiKey: "never-forward" });
  assert.deepEqual(parsed, { kind: "set", prompt: "曲順", count: 2, tracks: candidates });
});

test("assistant rejects invalid requests, oversized libraries, and duplicate candidate IDs", () => {
  for (const value of [null, [], { kind: "unknown", prompt: "test" }, { kind: "scene", prompt: " " }, { kind: "scene", prompt: "x".repeat(1001) },
    { kind: "set", prompt: "test", count: 2, tracks: [candidates[0]] },
    { kind: "set", prompt: "test", count: 3, tracks: candidates },
    { kind: "set", prompt: "test", count: 2, tracks: [candidates[0], candidates[0]] },
    { kind: "set", prompt: "test", count: 2, tracks: Array.from({ length: MAX_TRACKS + 1 }, (_, i) => ({ ...candidates[0], id: String(i) })) },
    { kind: "set", prompt: "test", count: 2, tracks: [{ ...candidates[0], bpm: NaN }, candidates[1]] },
    { kind: "set", prompt: "test", count: 2, tracks: [{ ...candidates[0], duration: Infinity }, candidates[1]] },
  ]) assert.throws(() => parseAssistantRequest(value));
});

test("Decisions choices all refer to actual built-in Looks and include a fallback", () => {
  const body = decisionRequest({ kind: "scene", prompt: "DevDay の発表に" });
  assert.equal(body.model, "gpt-6-luna");
  assert.equal(body.questions[0].type, "choice");
  assert.ok(body.questions[0].choices.some((c) => c.value === "other"));
  for (const scene of SCENES) assert.ok(BUILTIN_LOOKS.some((l) => l.id === scene.id), scene.id);
});

test("Decisions routes by question name and refuses uncertain, unknown or refused answers", () => {
  const input = parseAssistantRequest({ kind: "scene", prompt: "星空のように" });
  const answer = { type: "choice", name: "look", choice: "deep", confidence: 0.9 };
  assert.deepEqual(parseAssistantResult(input, { answers: [{ type: "choice", name: "unrelated", choice: "peak" }, answer] }), { kind: "scene", lookId: "deep", confidence: 0.9 });
  for (const change of [{ choice: "other" }, { choice: "arbitrary-command" }, { type: "refusal" }, { confidence: 0.54 }, { confidence: NaN }, { confidence: 2 }, { name: "other" }]) {
    assert.throws(() => parseAssistantResult(input, { answers: [{ ...answer, ...change }] }));
  }
});

test("Sol uses Structured Outputs restricted to candidate IDs and disables response storage", () => {
  const input = request();
  assert.equal(input.kind, "set");
  if (input.kind !== "set") return;
  const body = setlistRequest(input);
  assert.equal(body.model, "gpt-6.1-sol");
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.properties.tracks.items.properties.trackId.enum, ["a", "b"]);
  assert.equal(body.text.format.schema.properties.tracks.minItems, 2);
});

test("setlist parser extracts raw Responses output and retains the proposed ordering", () => {
  const result = parseAssistantResult(request(), completed([{ trackId: "b", reason: "先に確認" }, { trackId: "a", reason: "次に120 BPM" }]));
  assert.equal(result.kind, "set");
  if (result.kind === "set") assert.deepEqual(result.tracks.map((t) => t.trackId), ["b", "a"]);
});

test("setlist parser rejects invented or duplicate tracks, wrong counts, empty reasons and excessive text", () => {
  for (const tracks of [
    [{ trackId: "a", reason: "ok" }, { trackId: "absent", reason: "ok" }],
    [{ trackId: "a", reason: "ok" }, { trackId: "a", reason: "ok" }],
    [{ trackId: "a", reason: "ok" }],
    [{ trackId: "a", reason: "" }, { trackId: "b", reason: "ok" }],
    [{ trackId: "a", reason: "x".repeat(301) }, { trackId: "b", reason: "ok" }],
  ]) assert.throws(() => parseAssistantResult(request(), completed(tracks)));
});

test("setlist parser rejects truncation, refusal and malformed JSON instead of applying partial output", () => {
  for (const value of [
    { ...completed(), status: "incomplete" },
    { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] },
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: '{"tracks":' }] }] },
    { status: "completed", output: [] },
  ]) assert.throws(() => parseAssistantResult(request(), value));
});


test("set plans validate time, energy curve and existing visual Looks", () => {
  const body = completed();
  const value = JSON.parse(body.output[1].content![0].text!);
  value.plan = { minutes: 15, curve: "peak", lookId: "keynote" };
  const reply = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] };
  const parsed = parseAssistantResult(request(), reply);
  assert.equal(parsed.kind, "set");
  if (parsed.kind === "set") assert.deepEqual(parsed.plan, value.plan);
  for (const plan of [{ ...value.plan, minutes: 0 }, { ...value.plan, minutes: 241 }, { ...value.plan, curve: "invented" }, { ...value.plan, lookId: "invented" }]) {
    assert.throws(() => parseAssistantResult(request(), { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...value, plan }) }] }] }));
  }
});
