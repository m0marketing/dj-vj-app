import { test } from "node:test";
import assert from "node:assert/strict";
import { camelotNumber, keysCompatible, keyShiftToMatch } from "../src/lib/audio/key.ts";

test("camelot: A minor is 8A, C major is 8B (relative keys share a number)", () => {
  assert.equal(camelotNumber(9, true), 8); // A minor
  assert.equal(camelotNumber(0, false), 8); // C major
  assert.equal(camelotNumber(4, true), 9); // E minor = 9A
});

test("keysCompatible: same number, relative major/minor and neighbours on the wheel", () => {
  const am = { keyRoot: 9, keyMinor: true };
  assert.ok(keysCompatible(am, { keyRoot: 0, keyMinor: false })); // C major (8B)
  assert.ok(keysCompatible(am, { keyRoot: 4, keyMinor: true })); // E minor (9A)
  assert.ok(keysCompatible(am, { keyRoot: 2, keyMinor: true })); // D minor (7A)
  assert.ok(!keysCompatible(am, { keyRoot: 1, keyMinor: true })); // C# minor (12A)
  assert.ok(!keysCompatible({}, am));
});

test("keyShiftToMatch: smallest semitone move into a compatible key, 0 when already compatible", () => {
  const am = { keyRoot: 9, keyMinor: true };
  assert.equal(keyShiftToMatch(am, { keyRoot: 4, keyMinor: true }), 0);
  const s = keyShiftToMatch(am, { keyRoot: 10, keyMinor: true }); // A# minor (3A) -> needs a move
  assert.ok(Math.abs(s) >= 1 && Math.abs(s) <= 2);
  assert.ok(keysCompatible(am, { keyRoot: (10 + s + 12) % 12, keyMinor: true }));
});
