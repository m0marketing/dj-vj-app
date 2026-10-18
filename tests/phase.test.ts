import { test } from "node:test";
import assert from "node:assert/strict";
import { kickEnvelope, measureKickLag } from "../src/lib/audio/phase.ts";

const SR = 22050;
/** 4-on-the-floor kick train: decaying 60 Hz bursts every beat, starting `offset` seconds in. */
const kicks = (bpm: number, offset: number, secs = 8) => {
  const d = new Float32Array(SR * secs);
  const beat = 60 / bpm;
  for (let t = offset; t < secs; t += beat) {
    const s0 = Math.floor(t * SR);
    for (let i = 0; i < SR * 0.12 && s0 + i < d.length; i++) d[s0 + i] += Math.sin((2 * Math.PI * 60 * i) / SR) * Math.exp(-i / (SR * 0.04));
  }
  return d;
};

test("measureKickLag finds a 40 ms offset (incoming late) at equal tempo", () => {
  const a = kickEnvelope(kicks(124, 0.10), SR, 1.0, 1);
  const b = kickEnvelope(kicks(124, 0.14), SR, 1.0, 1);
  const r = measureKickLag(a, b);
  assert.ok(Math.abs(r.lag - 0.04) <= 0.008, `lag ${r.lag}`);
  assert.ok(r.confidence > 1.5);
});

test("measureKickLag is negative when the incoming deck is early", () => {
  const a = kickEnvelope(kicks(128, 0.2), SR, 0.5, 1);
  const b = kickEnvelope(kicks(128, 0.15), SR, 0.5, 1);
  assert.ok(Math.abs(measureKickLag(a, b).lag + 0.05) <= 0.008);
});

test("rate-stretched decks are measured in real time (incoming plays 6% fast)", () => {
  // outgoing 120 BPM, kicks at 0 / 0.5 / 1.0 s. incoming natural 113.2 BPM (beat 0.53 s) played at rate 1.06 so the
  // tempos match; at track position 1.0 its next kick is 0.06 s of track time away = 0.06 / 1.06 s of real time late.
  const a = kickEnvelope(kicks(120, 0.0), SR, 1.0, 1);
  const b = kickEnvelope(kicks(113.2, 0.0, 10), SR, 1.0, 1.06);
  const r = measureKickLag(a, b);
  assert.ok(Math.abs(r.lag - 0.06 / 1.06) <= 0.008, `lag ${r.lag}`);
});
