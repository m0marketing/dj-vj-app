/**
 * Procedural demo-track generator. Produces full arrangements
 * (intro → build → drop → break → drop → outro) in tropical / progressive
 * house styles so the app has mixable material out of the box.
 */
import * as k from "./kit";

type Section = "intro" | "build" | "drop" | "break" | "outro";

interface MelodyNote {
  step: number; // 16th-note step within a 2-bar (32 step) phrase
  note: string;
  len: number; // in 16ths
}

export interface SongStyle {
  name: string;
  bpm: number;
  bars: number;
  chords: string[][]; // 4 chords, cycled per bar
  bass: string[]; // root per chord
  bassStyle: "sub" | "saw";
  riff: "pluck" | "marimba" | "piano";
  riffPattern: { step: number; deg: number; oct?: number }[];
  lead: "vocal" | "supersaw" | "piano";
  melody: MelodyNote[];
  hats: "offbeat" | "16ths";
  kickPitch?: number;
}

const section = (bar: number, bars: number): Section => {
  if (bar < 8) return "intro";
  if (bar < 16) return "build";
  if (bar < 28) return "drop";
  if (bar < 32) return "break";
  if (bar < bars - 2) return "drop";
  return "outro";
};

const up = (freq: number, oct = 0) => freq * Math.pow(2, oct);

export function renderSong(style: SongStyle): Promise<AudioBuffer> {
  const beat = 60 / style.bpm;
  const bar = beat * 4;
  const step = beat / 4;
  const total = style.bars * bar + 3;

  return k.render(total, 2, (ctx, master) => {
    // Busses
    const drums = k.gain(ctx, 1);
    const bass = k.gain(ctx, 0.75);
    const riff = k.gain(ctx, 0.4);
    const pad = k.gain(ctx, 0.28);
    const lead = k.gain(ctx, 0.5);
    const fx = k.gain(ctx, 0.6);
    const duck = k.gain(ctx, 1); // sidechain for pad/riff/lead
    drums.connect(master);
    bass.connect(master);
    fx.connect(master);
    riff.connect(duck);
    pad.connect(duck);
    lead.connect(duck);
    duck.connect(master);

    const hatL = k.pan(ctx, drums, -0.25);
    const hatR = k.pan(ctx, drums, 0.25);
    const shakerPan = k.pan(ctx, drums, 0.35);
    const riffL = k.pan(ctx, riff, -0.3);
    const riffR = k.pan(ctx, riff, 0.3);

    const sidechain = (t: number) => {
      duck.gain.cancelScheduledValues(t);
      duck.gain.setValueAtTime(0.35, t);
      duck.gain.linearRampToValueAtTime(1, t + beat * 0.7);
    };

    for (let b = 0; b < style.bars; b++) {
      const sec = section(b, style.bars);
      const barT = b * bar;
      const chord = style.chords[b % 4].map(k.note);
      const root = k.note(style.bass[b % 4]);
      const dropStart = b === 16 || b === 32;
      const lastBuildBar = b === 15 || b === 31;
      const hasKick = sec === "build" || sec === "drop" || (sec === "outro" && b < style.bars - 1);
      const hasBass = sec === "drop" || (sec === "build" && b >= 12) || (sec === "outro" && b < style.bars - 2);
      const hasPad = sec === "drop" || sec === "break";
      const hasLead = sec === "drop" || (sec === "break" && b >= 30);
      const hasRiff = sec !== "outro" || b < style.bars - 2;

      // --- FX & transitions ---
      if (dropStart) {
        k.crash(ctx, fx, barT, 0.8);
        k.impact(ctx, fx, barT, 0.9);
      }
      if (b === 28) k.downlifter(ctx, fx, barT, bar * 0.9, 0.7);
      if (b === 14 || b === 30) k.riser(ctx, fx, barT, bar * 2 - step, 0.8);
      if (b === 8) k.crash(ctx, fx, barT, 0.5);

      for (let s = 0; s < 16; s++) {
        const t = barT + s * step;
        const onBeat = s % 4 === 0;
        const offBeat = s % 4 === 2;

        // --- drums ---
        if (hasKick && onBeat) {
          k.kick(ctx, drums, t, { pitch: style.kickPitch ?? 160, vel: sec === "build" ? 0.85 : 1 });
          sidechain(t);
        }
        if ((sec === "drop" || (sec === "build" && b >= 12)) && (s === 4 || s === 12)) k.clap(ctx, drums, t, 0.9);
        if (lastBuildBar) {
          // snare roll: 8ths then 16ths
          if (s < 8 ? s % 2 === 0 : true) k.snare(ctx, drums, t, 0.5 + (s / 16) * 0.5);
        }
        if (sec === "drop" || sec === "build" || sec === "outro") {
          if (style.hats === "offbeat") {
            if (offBeat) k.hat(ctx, s % 8 === 2 ? hatL : hatR, t, { open: sec === "drop" && s % 8 === 2, vel: 0.9 });
          } else {
            k.hat(ctx, s % 2 ? hatR : hatL, t, { open: false, vel: onBeat ? 0.9 : offBeat ? 0.7 : 0.4 });
            if (sec === "drop" && offBeat) k.hat(ctx, drums, t, { open: true, vel: 0.5 });
          }
        }
        if (sec === "intro" || sec === "break" || sec === "build") {
          k.shaker(ctx, shakerPan, t, s % 2 ? 0.5 : 0.9);
        }
        if (sec === "drop" && s % 2 === 1) k.shaker(ctx, shakerPan, t, 0.45);

        // --- bass ---
        if (hasBass) {
          if (style.bassStyle === "sub") {
            if (s === 0 || s === 6 || s === 8 || s === 14) k.sub808(ctx, bass, t, root, s === 0 || s === 8 ? beat * 1.2 : beat * 0.45, 0.9);
          } else if (s % 2 === 0) {
            k.sawBass(ctx, bass, t, s % 4 === 2 ? root * 2 : root, step * 1.6, 0.9);
          }
        }

        // --- riff (arpeggiated chord) ---
        if (hasRiff) {
          for (const r of style.riffPattern) {
            if (r.step !== s) continue;
            const freq = up(chord[r.deg % chord.length], r.oct ?? 0);
            const out = s % 2 ? riffR : riffL;
            const vel = sec === "intro" ? 0.8 : sec === "break" ? 0.6 : 1;
            if (style.riff === "pluck") k.pluck(ctx, out, t, freq, beat * 0.6, vel);
            else if (style.riff === "marimba") k.marimba(ctx, out, t, freq, vel);
            else k.piano(ctx, out, t, freq, beat * 0.9, vel * 0.7);
          }
        }
      }

      // --- pad (sustained chord per bar) ---
      if (hasPad) {
        const vel = sec === "break" ? 0.6 : 1;
        for (const f of chord) k.supersaw(ctx, pad, barT, f, bar * 0.98, vel, sec === "break" ? 1500 : 3500);
        if (sec === "break" && b % 2 === 0) for (const f of chord) k.piano(ctx, pad, barT, f, bar * 1.5, 0.9);
      }

      // --- lead melody (2-bar phrase) ---
      if (hasLead && b % 2 === 0) {
        style.melody.forEach((m, i) => {
          const t = barT + m.step * step;
          const dur = m.len * step;
          const f = k.note(m.note);
          const vel = sec === "break" ? 0.5 : 1;
          if (style.lead === "vocal") k.vocal(ctx, lead, t, f, dur, (["a", "o", "e"] as const)[i % 3], vel);
          else if (style.lead === "supersaw") {
            k.supersaw(ctx, lead, t, f, dur, vel * 1.1, 5000);
            k.piano(ctx, lead, t, f, dur, vel * 0.6);
          } else k.piano(ctx, lead, t, f, dur * 1.3, vel);
        });
      }
    }
    // final hit
    const endT = style.bars * bar;
    k.crash(ctx, fx, endT, 0.7);
    k.kick(ctx, drums, endT, { pitch: style.kickPitch ?? 160 });
  });
}

export const DEMO_SONGS: SongStyle[] = [
  {
    // Kygo-esque tropical house
    name: "Tropical Sunrise (Kygo style demo)",
    bpm: 102,
    bars: 40,
    chords: [
      ["A3", "C4", "E4"],
      ["F3", "A3", "C4"],
      ["C4", "E4", "G4"],
      ["G3", "B3", "D4"],
    ],
    bass: ["A1", "F1", "C2", "G1"],
    bassStyle: "sub",
    riff: "pluck",
    riffPattern: [
      { step: 0, deg: 0, oct: 1 },
      { step: 3, deg: 2 },
      { step: 6, deg: 1, oct: 1 },
      { step: 8, deg: 0, oct: 1 },
      { step: 11, deg: 2 },
      { step: 14, deg: 1, oct: 1 },
    ],
    lead: "vocal",
    melody: [
      { step: 0, note: "E5", len: 2 },
      { step: 4, note: "D5", len: 2 },
      { step: 6, note: "C5", len: 2 },
      { step: 8, note: "A4", len: 4 },
      { step: 14, note: "C5", len: 2 },
      { step: 16, note: "D5", len: 2 },
      { step: 20, note: "E5", len: 2 },
      { step: 22, note: "G5", len: 2 },
      { step: 24, note: "E5", len: 6 },
    ],
    hats: "offbeat",
    kickPitch: 150,
  },
  {
    // Avicii-esque progressive house
    name: "Levels of Light (Avicii style demo)",
    bpm: 126,
    bars: 40,
    chords: [
      ["D4", "F4", "A4"],
      ["Bb3", "D4", "F4"],
      ["F3", "A3", "C4"],
      ["C4", "E4", "G4"],
    ],
    bass: ["D2", "Bb1", "F1", "C2"],
    bassStyle: "saw",
    riff: "piano",
    riffPattern: [
      { step: 0, deg: 0 },
      { step: 3, deg: 1 },
      { step: 6, deg: 2 },
      { step: 8, deg: 0, oct: 1 },
      { step: 11, deg: 2 },
      { step: 14, deg: 1 },
    ],
    lead: "supersaw",
    melody: [
      { step: 0, note: "A4", len: 1 },
      { step: 2, note: "A4", len: 1 },
      { step: 4, note: "D5", len: 2 },
      { step: 6, note: "C5", len: 2 },
      { step: 8, note: "A4", len: 3 },
      { step: 12, note: "F4", len: 1 },
      { step: 14, note: "G4", len: 2 },
      { step: 16, note: "A4", len: 1 },
      { step: 18, note: "A4", len: 1 },
      { step: 20, note: "C5", len: 2 },
      { step: 22, note: "D5", len: 2 },
      { step: 24, note: "C5", len: 3 },
      { step: 28, note: "A4", len: 4 },
    ],
    hats: "offbeat",
    kickPitch: 170,
  },
  {
    // Slower tropical / chill house with marimba riff
    name: "Firestone Nights (tropical chill demo)",
    bpm: 96,
    bars: 40,
    chords: [
      ["E3", "G3", "B3"],
      ["C4", "E4", "G4"],
      ["G3", "B3", "D4"],
      ["D4", "F#4", "A4"],
    ],
    bass: ["E1", "C2", "G1", "D2"],
    bassStyle: "sub",
    riff: "marimba",
    riffPattern: [
      { step: 0, deg: 0, oct: 1 },
      { step: 2, deg: 2 },
      { step: 4, deg: 1, oct: 1 },
      { step: 7, deg: 0, oct: 2 },
      { step: 10, deg: 2 },
      { step: 12, deg: 1, oct: 1 },
      { step: 15, deg: 2, oct: 1 },
    ],
    lead: "piano",
    melody: [
      { step: 0, note: "B4", len: 3 },
      { step: 4, note: "G4", len: 3 },
      { step: 8, note: "E4", len: 4 },
      { step: 14, note: "G4", len: 2 },
      { step: 16, note: "A4", len: 3 },
      { step: 20, note: "B4", len: 3 },
      { step: 24, note: "D5", len: 6 },
    ],
    hats: "16ths",
    kickPitch: 140,
  },
];
