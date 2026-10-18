import type { PadMode, VJFxId } from "../../types";
import * as k from "./kit";

export interface DefaultSampleDef {
  name: string;
  seconds: number;
  /** pad index to auto-assign (0-15), undefined = library only */
  pad?: number;
  mode?: PadMode;
  choke?: number;
  color?: string;
  fx?: VJFxId;
  fxText?: string;
  loopBpm?: number;
  /** Pitched material written in A minor: re-rendered when matching the playing track's key. */
  keyed?: boolean;
  /** Time-based FX (no beat grid): never re-tempoed. */
  tempoFree?: boolean;
  build: (ctx: k.Ctx, out: k.Out) => void;
}

const C = { party: "#ff2d95", gold: "#facc15", drum: "#f43f5e", perc: "#f97316", bass: "#eab308", synth: "#22c55e", fx: "#06b6d4", vox: "#8b5cf6", horn: "#ec4899" };

/**
 * Pad layout (keyboard):
 *  1 2 3 4   Kick     Snare    Clap      HH Closed
 *  Q W E R   HH Open  Crash    Tom       Shaker
 *  A S D F   Sub 808  Pluck    Saw Stab  Piano Stab
 *  Z X C V   Riser    Impact   Air Horn  Siren
 *
 * Bank C (pads 41-48): remix loops, toggle ON/OFF, auto tempo-matched to the playing deck
 * Bank E (F5): EDM chorus phrases in Am-F-C-G (lead / chords / pluck / bass / vox / drums ...), toggle loops,
 *              plus wobble / reese bass, trap hats and a crowd chant loop
 * Bank F (F6): build-ups, drop impact, sweeps, fills, rave stab, tape stop, vinyl crackle, reverse snare
 * Bank G (F7): TR-909 style drum machine kit (for the step sequencer)
 * Bank H (F8): TR-808 / trap kit incl. long 808 bass notes
 * Bank D (voices): アイーン (synth) + catchphrase pads (speech), see SPEECH_PADS
 *
 * Bank B (party):
 *  1 2 3 4   Hey!     Ho!      Yeah!     Wooo!
 *  Q W E R   Cheer    Whistle  Scratch   Cowbell
 *  A S D F   Drop     Snr Roll Rewind    Confetti
 *  Z X C V   Anthem   Orch Hit Laser     Bomb
 */
export const DEFAULT_SAMPLES: DefaultSampleDef[] = [
  { name: "Kick", seconds: 0.7, pad: 0, fx: "pulse", color: C.drum, build: (c, o) => k.kick(c, o, 0) },
  { name: "Snare", seconds: 0.5, pad: 1, fx: "pulse", color: C.drum, build: (c, o) => k.snare(c, o, 0) },
  { name: "Clap", seconds: 0.5, pad: 2, fx: "emoji", fxText: "👏", color: C.drum, build: (c, o) => k.clap(c, o, 0) },
  { name: "HH Closed", seconds: 0.25, pad: 3, choke: 1, fx: "none", color: C.perc, build: (c, o) => k.hat(c, o, 0) },
  { name: "HH Open", seconds: 0.6, pad: 4, choke: 1, fx: "none", color: C.perc, build: (c, o) => k.hat(c, o, 0, { open: true }) },
  { name: "Crash", seconds: 2.2, pad: 5, fx: "flash", color: C.perc, build: (c, o) => k.crash(c, o, 0) },
  { name: "Tom", seconds: 0.7, pad: 6, fx: "pulse", color: C.drum, build: (c, o) => k.tom(c, o, 0, 110) },
  { name: "Shaker", seconds: 0.25, pad: 7, fx: "none", color: C.perc, build: (c, o) => k.shaker(c, o, 0) },
  { name: "Sub 808", seconds: 1.4, pad: 8, fx: "shock", color: C.bass, build: (c, o) => k.sub808(c, o, 0, k.note("A1"), 1) },
  { name: "Pluck", seconds: 0.9, pad: 9, fx: "none", color: C.synth, build: (c, o) => k.pluck(c, o, 0, k.note("A4"), 0.7) },
  {
    name: "Saw Stab",
    fx: "pulse",
    seconds: 0.9,
    pad: 10,
    color: C.synth,
    build: (c, o) => ["A3", "C4", "E4"].forEach((n) => k.supersaw(c, o, 0, k.note(n), 0.5, 0.9)),
  },
  {
    name: "Piano Stab",
    fx: "none",
    seconds: 1.6,
    pad: 11,
    color: C.synth,
    build: (c, o) => ["A3", "C4", "E4", "A4"].forEach((n) => k.piano(c, o, 0, k.note(n), 1.3, 0.8)),
  },
  { name: "Riser", seconds: 2.2, pad: 12, mode: "gate", fx: "build", color: C.fx, build: (c, o) => k.riser(c, o, 0, 2) },
  { name: "Impact", seconds: 1.8, pad: 13, fx: "shock", color: C.fx, build: (c, o) => k.impact(c, o, 0) },
  { name: "Air Horn", seconds: 1.6, pad: 14, fx: "airhorn", color: C.horn, build: (c, o) => k.airhorn(c, o, 0) },
  { name: "Siren", seconds: 2, pad: 15, mode: "toggle", fx: "siren", color: C.horn, build: (c, o) => k.siren(c, o, 0, 2) },
  // ---- Bank B: party ----
  { name: "Hey!", seconds: 0.6, pad: 16, choke: 2, color: C.gold, fx: "text", fxText: "HEY!", build: (c, o) => k.shout(c, o, 0, { f0: 330, f1: 290, dur: 0.42, from: [450, 2200], to: [700, 1700] }) },
  { name: "Ho!", seconds: 0.6, pad: 17, choke: 2, color: C.gold, fx: "text", fxText: "HO!", build: (c, o) => k.shout(c, o, 0, { f0: 250, f1: 190, dur: 0.4, from: [450, 850], to: [500, 800] }) },
  { name: "Yeah!", seconds: 0.85, pad: 18, choke: 2, color: C.gold, fx: "text", fxText: "YEAH!", build: (c, o) => k.shout(c, o, 0, { f0: 300, f1: 230, dur: 0.65, from: [300, 2300], to: [750, 1300] }) },
  { name: "Wooo!", seconds: 1.6, pad: 19, choke: 2, color: C.gold, fx: "text", fxText: "WOOOO!", build: (c, o) => k.shout(c, o, 0, { f0: 300, f1: 680, dur: 1.4, from: [300, 800], to: [450, 900], vib: 0.02 }) },
  { name: "Crowd Cheer", seconds: 2.4, pad: 20, color: C.party, fx: "confetti", build: (c, o) => k.cheer(c, o, 0, 2.2) },
  { name: "Whistle", seconds: 0.9, pad: 21, color: C.horn, fx: "emoji", fxText: "🎉🙌🔥", build: (c, o) => k.whistle(c, o, 0, 0.7) },
  { name: "Scratch", seconds: 0.8, pad: 22, color: C.fx, fx: "glitch", build: (c, o) => k.scratch(c, o, 0) },
  { name: "Cowbell", seconds: 0.6, pad: 23, color: C.perc, fx: "emoji", fxText: "🔔", build: (c, o) => k.cowbell(c, o, 0) },
  { name: "Drop", seconds: 2, pad: 24, color: C.party, fx: "drop", fxText: "DROP!", build: (c, o) => k.bassDrop(c, o, 0, 1.8) },
  { name: "Snare Roll", seconds: 2.6, pad: 25, color: C.drum, fx: "build", build: (c, o) => k.snareRoll(c, o, 0, 2.2) },
  { name: "Rewind", seconds: 1.2, pad: 26, color: C.fx, fx: "glitch", build: (c, o) => k.rewind(c, o, 0, 1) },
  { name: "Confetti Pop", seconds: 1, pad: 27, color: C.party, fx: "confetti", build: (c, o) => k.confettiPop(c, o, 0) },
  { name: "Anthem Lead", seconds: 1.4, pad: 28, color: C.synth, fx: "lasers", build: (c, o) => k.anthem(c, o, 0) },
  { name: "Orch Hit", seconds: 1.4, pad: 29, color: C.horn, fx: "shock", build: (c, o) => k.orchHit(c, o, 0) },
  { name: "Laser", seconds: 0.4, pad: 30, color: C.fx, fx: "lasers", build: (c, o) => k.laser(c, o, 0) },
  { name: "Bomb Drop", seconds: 2.6, pad: 31, color: C.party, fx: "drop", fxText: "BOOM!", build: (c, o) => k.bombDrop(c, o, 0) },
  // ---- Bank C: remix loops (toggle, tempo-matched) ----
  { name: "Loop Kick", seconds: k.LOOP_SECONDS, pad: 40, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.drum, fx: "pulse", build: k.loops.kick },
  { name: "Loop Hats", seconds: k.LOOP_SECONDS, pad: 41, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.perc, fx: "pulse", build: k.loops.hats },
  { name: "Loop Backbeat", seconds: k.LOOP_SECONDS, pad: 42, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.drum, fx: "pulse", build: k.loops.backbeat },
  { name: "Loop Bass", seconds: k.LOOP_SECONDS, pad: 43, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.bass, fx: "pulse", build: k.loops.bass },
  { name: "Loop Chords", seconds: k.LOOP_SECONDS, pad: 44, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "pulse", build: k.loops.chords },
  { name: "Loop Arp", seconds: k.LOOP_SECONDS, pad: 45, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "pulse", build: k.loops.arp },
  { name: "Loop Shaker", seconds: k.LOOP_SECONDS, pad: 46, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.perc, fx: "pulse", build: k.loops.shaker },
  { name: "Loop Vox Chops", seconds: k.LOOP_SECONDS, pad: 47, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.vox, fx: "pulse", build: k.loops.vox },
  // ---- Bank E: EDM chorus phrases (toggle, tempo-matched) ----
  { name: "Chorus Lead", seconds: k.LOOP4_SECONDS, pad: 64, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "pulse", build: k.edm.lead },
  { name: "Chorus Chords", seconds: k.LOOP4_SECONDS, pad: 65, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "pulse", build: k.edm.chords },
  { name: "Chorus Pluck", seconds: k.LOOP4_SECONDS, pad: 66, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "pulse", build: k.edm.pluck },
  { name: "Chorus Bass", seconds: k.LOOP4_SECONDS, pad: 67, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.bass, fx: "pulse", build: k.edm.bass },
  { name: "Chorus Vox", seconds: k.LOOP4_SECONDS, pad: 68, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.vox, fx: "pulse", build: k.edm.vox },
  { name: "Chorus Drums", seconds: k.LOOP4_SECONDS, pad: 69, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.drum, fx: "pulse", build: k.edm.drums },
  { name: "Offbeat Bass", seconds: k.LOOP_SECONDS, pad: 70, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.bass, fx: "pulse", build: k.edm.offbeat },
  { name: "Acid Bass", seconds: k.LOOP_SECONDS, pad: 71, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.bass, fx: "pulse", build: k.edm.acid },
  { name: "Trance Gate", seconds: k.LOOP4_SECONDS, pad: 72, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "lasers", build: k.edm.gate },
  { name: "Sidechain Pad", seconds: k.LOOP4_SECONDS, pad: 73, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.synth, fx: "pulse", build: k.edm.sidechain },
  { name: "Big Room Kick", seconds: k.LOOP_SECONDS, pad: 74, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.drum, fx: "pulse", build: k.edm.bigKick },
  // ---- Bank F: build-ups, drops & fills (tempo-matched) ----
  { name: "Build 2 bars", seconds: k.LOOP_SECONDS, pad: 80, loopBpm: k.LOOP_BPM, color: C.drum, fx: "build", build: k.edm.build2 },
  { name: "Build 4 bars", seconds: k.LOOP4_SECONDS, pad: 81, loopBpm: k.LOOP_BPM, color: C.drum, fx: "build", build: k.edm.build4 },
  { name: "Drop Impact", seconds: 1.9, pad: 82, loopBpm: k.LOOP_BPM, color: C.party, fx: "drop", build: k.edm.dropImpact },
  { name: "Reverse Crash", seconds: k.LOOP_SECONDS, pad: 83, loopBpm: k.LOOP_BPM, color: C.fx, fx: "flash", build: k.edm.revCrash },
  { name: "Sweep Up", seconds: k.LOOP_SECONDS, pad: 84, loopBpm: k.LOOP_BPM, color: C.fx, fx: "none", build: k.edm.sweepUp },
  { name: "Downlifter 2s", seconds: k.LOOP_SECONDS, pad: 85, loopBpm: k.LOOP_BPM, color: C.fx, fx: "none", build: k.edm.downlift },
  { name: "Snare Fill", seconds: k.LOOP_SECONDS, pad: 86, loopBpm: k.LOOP_BPM, color: C.drum, fx: "shock", build: k.edm.snareFill },
  { name: "Tom Fill", seconds: k.LOOP_SECONDS, pad: 87, loopBpm: k.LOOP_BPM, color: C.drum, fx: "shock", build: k.edm.tomFill },
  { name: "Kick Roll", seconds: k.LOOP_SECONDS, pad: 88, loopBpm: k.LOOP_BPM, color: C.drum, fx: "shock", build: k.edm.kickRoll },
  { name: "Laser Barrage", seconds: k.LOOP_SECONDS, pad: 89, loopBpm: k.LOOP_BPM, color: C.fx, fx: "lasers", build: k.edm.lasers },
  { name: "Rave Stab", seconds: k.LOOP_SECONDS, pad: 90, loopBpm: k.LOOP_BPM, color: C.horn, fx: "shock", build: k.edm.raveStab },
  { name: "Stutter Chords", seconds: k.LOOP_SECONDS, pad: 91, loopBpm: k.LOOP_BPM, color: C.synth, fx: "glitch", build: k.edm.stutter },
  // ---- Bank E (cont.): bass & groove loops ----
  { name: "Wobble Bass", seconds: k.LOOP_SECONDS, pad: 75, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.bass, fx: "shock", build: k.edm.wobble },
  { name: "Reese Bass", seconds: k.LOOP_SECONDS, pad: 76, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.bass, fx: "pulse", build: k.edm.reese },
  { name: "Trap Hats", seconds: k.LOOP_SECONDS, pad: 77, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.perc, fx: "pulse", build: k.edm.trapHats },
  { name: "Hey Ho Chant", seconds: k.LOOP_SECONDS, pad: 78, mode: "toggle", loopBpm: k.LOOP_BPM, color: C.gold, fx: "text", fxText: "HEY! HO!", build: k.edm.chant },
  // ---- Bank F (cont.): transitions ----
  { name: "Tape Stop", seconds: 1.7, pad: 92, color: C.fx, fx: "glitch", build: (c, o) => k.tapeStop(c, o, 0) },
  { name: "Vinyl Crackle", seconds: 2, pad: 93, mode: "toggle", color: C.fx, fx: "none", build: (c, o) => k.crackle(c, o, 0, 2) },
  { name: "Rev Snare", seconds: k.LOOP_SECONDS / 4, pad: 94, loopBpm: k.LOOP_BPM, color: C.drum, fx: "flash", build: (c, o) => k.reverseSnare(c, o, 0) },
  // ---- Bank G (F7): 909 drum machine ----
  { name: "909 Kick", seconds: 0.7, pad: 96, choke: 0, fx: "pulse", color: C.drum, build: (c, o) => k.kick909(c, o, 0) },
  { name: "909 Snare", seconds: 0.5, pad: 97, fx: "pulse", color: C.drum, build: (c, o) => k.snare909(c, o, 0) },
  { name: "909 Clap", seconds: 0.5, pad: 98, fx: "none", color: C.drum, build: (c, o) => k.clap(c, o, 0, 0.9) },
  { name: "909 Rim", seconds: 0.2, pad: 99, fx: "none", color: C.perc, build: (c, o) => k.rim(c, o, 0) },
  { name: "909 HH Closed", seconds: 0.2, pad: 100, choke: 3, fx: "none", color: C.perc, build: (c, o) => k.hat(c, o, 0, { vel: 0.9 }) },
  { name: "909 HH Open", seconds: 0.6, pad: 101, choke: 3, fx: "none", color: C.perc, build: (c, o) => k.hat(c, o, 0, { open: true, vel: 0.9 }) },
  { name: "909 Ride", seconds: 1.4, pad: 102, fx: "none", color: C.perc, build: (c, o) => k.ride(c, o, 0) },
  { name: "909 Crash", seconds: 2, pad: 103, fx: "flash", color: C.perc, build: (c, o) => k.crash(c, o, 0) },
  { name: "909 Tom Lo", seconds: 0.7, pad: 104, fx: "none", color: C.drum, build: (c, o) => k.tom(c, o, 0, 85) },
  { name: "909 Tom Mid", seconds: 0.6, pad: 105, fx: "none", color: C.drum, build: (c, o) => k.tom(c, o, 0, 130) },
  { name: "909 Tom Hi", seconds: 0.5, pad: 106, fx: "none", color: C.drum, build: (c, o) => k.tom(c, o, 0, 190) },
  { name: "909 Cowbell", seconds: 0.5, pad: 107, fx: "none", color: C.perc, build: (c, o) => k.cowbell(c, o, 0) },
  { name: "Clave", seconds: 0.15, pad: 108, fx: "none", color: C.perc, build: (c, o) => k.clave(c, o, 0) },
  { name: "Maracas", seconds: 0.15, pad: 109, fx: "none", color: C.perc, build: (c, o) => k.maracas(c, o, 0) },
  { name: "Conga Lo", seconds: 0.4, pad: 110, fx: "none", color: C.perc, build: (c, o) => k.conga(c, o, 0, 150) },
  { name: "Conga Hi", seconds: 0.35, pad: 111, fx: "none", color: C.perc, build: (c, o) => k.conga(c, o, 0, 230) },
  // ---- Bank H (F8): 808 / trap drum machine ----
  { name: "808 Kick Long", seconds: 1.8, pad: 112, choke: 4, fx: "shock", color: C.bass, build: (c, o) => k.kick808Long(c, o, 0, 50, 1.6) },
  { name: "808 Kick Short", seconds: 0.7, pad: 113, fx: "pulse", color: C.drum, build: (c, o) => k.kick808(c, o, 0) },
  { name: "808 Snare", seconds: 0.4, pad: 114, fx: "pulse", color: C.drum, build: (c, o) => k.snare808(c, o, 0) },
  { name: "808 Clap", seconds: 0.4, pad: 115, fx: "none", color: C.drum, build: (c, o) => k.clap(c, o, 0, 0.7) },
  { name: "808 HH Closed", seconds: 0.15, pad: 116, choke: 3, fx: "none", color: C.perc, build: (c, o) => k.hat808(c, o, 0) },
  { name: "808 HH Open", seconds: 0.6, pad: 117, choke: 3, fx: "none", color: C.perc, build: (c, o) => k.hat808(c, o, 0, { open: true }) },
  { name: "808 Cowbell", seconds: 0.4, pad: 118, fx: "none", color: C.perc, build: (c, o) => k.cowbell(c, o, 0, 0.8) },
  { name: "808 Rimshot", seconds: 0.2, pad: 119, fx: "none", color: C.perc, build: (c, o) => k.rim(c, o, 0, 0.8) },
  { name: "808 Bass C", seconds: 1.6, pad: 120, choke: 4, fx: "shock", color: C.bass, build: (c, o) => k.kick808Long(c, o, 0, k.note("C1"), 1.4) },
  { name: "808 Bass F", seconds: 1.6, pad: 121, choke: 4, fx: "shock", color: C.bass, build: (c, o) => k.kick808Long(c, o, 0, k.note("F1"), 1.4) },
  { name: "808 Bass G", seconds: 1.6, pad: 122, choke: 4, fx: "shock", color: C.bass, build: (c, o) => k.kick808Long(c, o, 0, k.note("G1"), 1.4) },
  { name: "808 Bass A", seconds: 1.6, pad: 123, choke: 4, fx: "shock", color: C.bass, build: (c, o) => k.kick808Long(c, o, 0, k.note("A1"), 1.4) },
  { name: "808 Conga", seconds: 0.4, pad: 124, fx: "none", color: C.perc, build: (c, o) => k.conga(c, o, 0, 180) },
  { name: "808 Clave", seconds: 0.15, pad: 125, fx: "none", color: C.perc, build: (c, o) => k.clave(c, o, 0) },
  { name: "808 Maracas", seconds: 0.15, pad: 126, fx: "none", color: C.perc, build: (c, o) => k.maracas(c, o, 0) },
  { name: "Trap Hat Roll", seconds: 0.5, pad: 127, fx: "none", color: C.perc, build: (c, o) => { for (let i = 0; i < 6; i++) k.hat808(c, o, i * 0.078, { vel: 0.5 + i * 0.08 }); } },
  // ---- Bank D: voices ----
  { name: "Firework", seconds: 2.2, pad: 56, color: C.party, fx: "fireworks", build: (c, o) => k.firework(c, o, 0) },
  { name: "アイーン", seconds: 1.4, pad: 48, color: C.gold, fx: "text", fxText: "アイーン!", build: (c, o) => k.aiin(c, o, 0) },
  // library only
  { name: "Kick 808", seconds: 1.3, color: C.drum, build: (c, o) => k.kick808(c, o, 0) },
  { name: "Rim", seconds: 0.2, color: C.perc, build: (c, o) => k.rim(c, o, 0) },
  { name: "Downlifter", seconds: 1.7, color: C.fx, build: (c, o) => k.downlifter(c, o, 0, 1.5) },
  { name: "Noise Sweep", seconds: 2.1, color: C.fx, build: (c, o) => k.sweep(c, o, 0, 2) },
  { name: "Vox Hey", seconds: 0.5, color: C.vox, build: (c, o) => k.vocal(c, o, 0, k.note("E4"), 0.35, "e") },
  { name: "Vox Oh", seconds: 0.7, color: C.vox, build: (c, o) => k.vocal(c, o, 0, k.note("C4"), 0.55, "o") },
  { name: "Marimba", seconds: 0.8, color: C.synth, build: (c, o) => k.marimba(c, o, 0, k.note("C5")) },
];

const KEYED = new Set(["Wobble Bass", "Reese Bass", "Loop Bass", "Loop Chords", "Loop Arp", "Loop Vox Chops", "Chorus Lead", "Chorus Chords", "Chorus Pluck", "Chorus Bass", "Chorus Vox", "Offbeat Bass", "Acid Bass", "Trance Gate", "Sidechain Pad", "Big Room Kick", "Rave Stab", "Stutter Chords"]);
const TEMPO_FREE = new Set(["Drop Impact", "Reverse Crash", "Downlifter 2s", "Vinyl Crackle"]);
DEFAULT_SAMPLES.forEach((d) => {
  if (KEYED.has(d.name)) d.keyed = true;
  if (TEMPO_FREE.has(d.name)) d.tempoFree = true;
});

/**
 * Renders a def, optionally re-keyed (`transpose` semitones, keyed defs only) and re-tempoed (`bpm`, loop defs only).
 * Both apply to the synchronous graph build, so the globals are reset right after calling k.render.
 */
export const renderSample = (def: DefaultSampleDef, opts: { transpose?: number; bpm?: number } = {}) => {
  const retempo = def.loopBpm && opts.bpm && !def.tempoFree ? opts.bpm : 0;
  k.setTranspose(def.keyed ? (opts.transpose ?? 0) : 0);
  if (retempo) k.setLoopTempo(retempo);
  const seconds = retempo ? def.seconds * (def.loopBpm! / retempo) : def.seconds;
  const p = k.render(seconds, 1, (ctx, out) => def.build(ctx, out), 0.9);
  k.setTranspose(0);
  if (retempo) k.setLoopTempo(k.LOOP_BPM);
  return p;
};

/** Catchphrase pads: read aloud with the browser voice unless the user drops their own audio on the pad. */
export const SPEECH_PADS: { pad: number; name: string; text: string; fxText: string; color: string }[] = [
  { pad: 49, name: "ドッキリかよ", text: "ドッキリかよ！", fxText: "ドッキリかよ!?", color: "#ef4444" },
  { pad: 50, name: "勘弁してくださいよ", text: "勘弁してくださいよ〜", fxText: "勘弁してくださいよ〜", color: "#f97316" },
  { pad: 51, name: "ヤバいヤバい", text: "ヤバいヤバいヤバい！", fxText: "ヤバいヤバい!!", color: "#eab308" },
  { pad: 52, name: "乾杯！", text: "乾杯！", fxText: "乾杯!", color: "#22c55e" },
  { pad: 53, name: "最高〜！", text: "最高〜！", fxText: "最高〜!", color: "#06b6d4" },
  { pad: 54, name: "もう一回！", text: "もう一回！", fxText: "もう一回!", color: "#8b5cf6" },
  { pad: 55, name: "イェーイ！", text: "イェーイ！", fxText: "イェーイ!", color: "#ec4899" },
];
