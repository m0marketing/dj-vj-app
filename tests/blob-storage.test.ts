import test from "node:test";
import assert from "node:assert/strict";
import { blobStorageFailed, packBlob, unpackBlob } from "../src/lib/blob-storage.ts";

test("binary fallback preserves audio bytes and MIME type across structured clone", async () => {
  const audio = new Blob([new Uint8Array([0, 1, 127, 128, 255])], { type: "audio/wav" });
  const restored = unpackBlob(structuredClone(await packBlob(audio)));
  assert.ok(restored instanceof Blob);
  assert.equal(restored.type, audio.type);
  assert.deepEqual(await restored.arrayBuffer(), await audio.arrayBuffer());
});

test("existing Blob records and ordinary settings keep their original values", () => {
  const audio = new Blob(["legacy"]), preferences = { volume: 0.8 };
  assert.equal(unpackBlob(audio), audio);
  assert.equal(unpackBlob(preferences), preferences);
  assert.equal(unpackBlob(undefined), undefined);
});

test("only a Blob persistence error enables the binary fallback", () => {
  assert.ok(blobStorageFailed(new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError")));
  assert.ok(!blobStorageFailed(new DOMException("Storage is full", "QuotaExceededError")));
  assert.ok(!blobStorageFailed(new DOMException("Database unavailable", "UnknownError")));
  assert.ok(!blobStorageFailed(null));
});
