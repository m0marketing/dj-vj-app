import { test } from "node:test";
import assert from "node:assert/strict";
import { showParams, VJ_SHOWS, BUILTIN_LOOKS, VJ_PALETTES } from "../src/lib/types.ts";

test("showParams: fixed shows return their own table entry", () => {
  for (const s of VJ_SHOWS) if (s.id !== "auto") assert.deepEqual(showParams(s.id), s.p);
});

test("showParams(auto): interpolates cinema -> club -> festival with energy and never allows strobe", () => {
  const low = showParams("auto", 0);
  const mid = showParams("auto", 0.5);
  const high = showParams("auto", 1);
  assert.equal(low.strobe, false);
  assert.equal(high.strobe, false);
  assert.ok(low.shake < mid.shake && mid.shake < high.shake, "shake rises with energy");
  assert.ok(low.grain > high.grain, "grain is a cinema trait");
  assert.equal(low.letterbox, true);
  assert.equal(high.letterbox, false);
  // monotone-ish between regimes
  const e = [0, 0.2, 0.35, 0.6, 0.8, 1].map((x) => showParams("auto", x).punch);
  for (let i = 1; i < e.length; i++) assert.ok(e[i] >= e[i - 1] - 1e-9);
});

test("showParams(custom): uses the supplied params verbatim", () => {
  const custom = { ...showParams("club"), glitch: 1.75, phraseBars: 2 };
  assert.deepEqual(showParams("custom", 0.9, custom), custom);
});

test("built-in looks reference valid shows and palettes", () => {
  const shows = new Set(VJ_SHOWS.map((s) => s.id));
  const palettes = new Set(VJ_PALETTES.map((p) => p.id));
  for (const l of BUILTIN_LOOKS) {
    assert.ok(shows.has(l.show), `${l.id} show`);
    if (l.palette) assert.ok(palettes.has(l.palette), `${l.id} palette`);
    assert.ok(l.intensity > 0 && l.trails >= 0 && l.trails < 1);
  }
});
