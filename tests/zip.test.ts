import { test } from "node:test";
import assert from "node:assert/strict";
import { readZip, writeZip } from "../src/lib/zip.ts";

test("zip: write -> read round-trips names and bytes (stored, no compression)", async () => {
  const text = new TextEncoder().encode("日本語の名前も OK: DevDay [2026]");
  const bin = new Uint8Array(70000).map((_, i) => (i * 31) & 255);
  const blob = await writeZip([
    { name: "manifest.json", data: JSON.stringify({ version: 1, n: 2 }) },
    { name: "tracks/テスト.wav", data: new Blob([bin]) },
    { name: "note.txt", data: new Blob([text]) },
  ]);
  const files = await readZip(blob);
  const byName = new Map(files.map((f) => [f.name, f]));
  assert.deepEqual([...byName.keys()].sort(), ["manifest.json", "note.txt", "tracks/テスト.wav"]);
  assert.equal(await byName.get("note.txt")!.text(), new TextDecoder().decode(text));
  const back = new Uint8Array(await byName.get("tracks/テスト.wav")!.blob().arrayBuffer());
  assert.equal(back.length, bin.length);
  assert.ok(back.every((v, i) => v === bin[i]));
});
