"use client";

import { create } from "zustand";
import { db, stripBlob } from "./db";
import { getEngine } from "./audio/engine";
import { detectBPM } from "./audio/bpm";
import type { DeckState } from "./audio/deck";
import { DEFAULT_SAMPLES, renderSample, SPEECH_PADS } from "./audio/synth/defaultSamples";
import { DEMO_SONGS, renderSong } from "./audio/synth/songs";
import { audioBufferToWav } from "./audio/synth/wav";
import { featureBus } from "./vj/featureBus";
import { speak } from "./speech";
import { camelotNumber, detectKey, keysCompatible, keyShiftToMatch, shiftFromAm } from "./audio/key";
import { AudioEngine, type FxName } from "./audio/engine";
import { kickEnvelope, measureKickLag } from "./audio/phase";
import { introBars, loudnessDb, loudnessLufs, pickEntry, soundBounds } from "./audio/entry";
import { detectChorus } from "./audio/chorus";
import { vocalBetween, vocalMap } from "./audio/vocal";
import { emptyPattern, type Pattern, type Step } from "./audio/sequencer";
import { readZip, writeZip } from "./zip";
import {
  defaultPad,
  PAD_COUNT,
  PADS_PER_BANK,
  BANK_NAMES,
  type DeckId,
  type PadConfig,
  type SampleMeta,
  type ToastKind,
  type TrackMeta,
  type TrackRecord,
  type SampleRecord,
  type Playlist,
  type VJSettings,
  type VJTheme,
  type VJShow,
  type VJLook,
  VJ_THEMES,
  VJ_SHOWS,
  BUILTIN_LOOKS,
  showParams,
} from "./types";

/** Videos are stored as their decoded audio (WAV) so the library does not keep whole video files. */
const storable = (file: File, buffer: AudioBuffer): Blob => (file.type.startsWith("video/") ? audioBufferToWav(buffer) : file);

/** Session-only (temporary) audio: kept in memory, never written to IndexedDB. */
const memTracks = new Map<string, TrackRecord>();
const memSamples = new Map<string, SampleRecord>();
const getTrackRec = async (id: string) => memTracks.get(id) ?? db.getTrack(id);
const getSampleRec = async (id: string) => memSamples.get(id) ?? db.getSample(id);
/** Quota errors get an actionable message (what to delete / switch to temporary), everything else the generic one. */
/**
 * Built-in kit / demo songs / catchphrase pads the user deleted. They are remembered (setting "removedDefaults") so a
 * kit-version bump does not bring them back; "内蔵キット / デモ曲を追加" clears the list on purpose.
 */
const removedDefaults = new Set<string>();
const persistRemoved = () => void db.setSetting("removedDefaults", [...removedDefaults]);
export const isDefaultSample = (name: string) => DEFAULT_SAMPLES.some((d) => d.name === name);
export const isDefaultTrack = (name: string) => DEMO_SONGS.some((d) => d.name === name);
const rememberRemoved = (keys: string[]) => {
  if (!keys.length) return;
  for (const k of keys) removedDefaults.add(k);
  persistRemoved();
};
let lowSpaceWarned = false;
let persistAsked = false;
const storageErrorMessage = (err: unknown, name: string) =>
  (err as { name?: string })?.name === "QuotaExceededError"
    ? `保存容量が足りません: ${name}。不要な曲 / サンプルを削除するか、追加時の保存先を「今回だけ」にしてください (Library › ⋯ で使用量を確認)`
    : `読み込み失敗: ${name}`;
const updateTrackRec = async (id: string, patch: Partial<TrackMeta>) => {
  const m = memTracks.get(id);
  if (m) memTracks.set(id, { ...m, ...patch });
  else await db.updateTrack(id, patch);
};

const analyzeKey = (id: string, buffer: AudioBuffer, setState: (fn: (s: DJState) => Partial<DJState>) => void) =>
  setTimeout(async () => {
    const k = detectKey(buffer);
    if (!k) return;
    await updateTrackRec(id, k);
    setState((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...k } : t)) }));
  }, 0);

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

const emptyDeck = (id: DeckId): DeckState => ({
  id,
  track: null,
  playing: false,
  position: 0,
  duration: 0,
  rate: 1,
  volume: 1,
  eq: { low: 0, mid: 0, high: 0 },
  filter: 0,
  cues: [null, null, null, null],
  cuePoint: 0,
  loop: { in: null, out: null, active: false },
  keylock: true,
  keyShift: 0,
  scratching: false,
});

export const defaultVJ: VJSettings = {
  preset: "bars",
  hue: 200,
  intensity: 1,
  sensitivity: 1,
  autoCycle: false,
  mirror: false,
  trails: 0.25,
  strobe: true,
  autoDrop: false,
  autoHype: false,
  ddTheme: "devday",
  follow: true,
  hypeLevel: "mid",
  pool: "auto",
  theme: "free",
  show: "club",
  nowPlaying: true,
  layer2: { preset: null, blend: "screen", opacity: 0.6 },
  media: { version: 0, kind: null, blend: "screen", opacity: 0.7, fit: "cover", pulse: false },
  colorMode: "follow",
  palette: "devday",
  presetLock: false,
  director: true,
  overlayText: "",
  logoVersion: 0,
};

/** Bump when DEFAULT_SAMPLES gains new entries so existing users get them on next launch. */
const KIT_VERSION = 8;

export const hexToHue = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
};

export type Quantize = "off" | "beat" | "bar";
export type MixStyle = "blend" | "filter" | "drop" | "spin" | "echo" | "reverb" | "cut" | "roll" | "fade" | "doubledrop" | "breakcut" | "ramp";
/** Energy design of the set: flat (any), up (push BPM / loudness a notch each track), wave (alternate). */
export type DjEnergy = "flat" | "up" | "wave";
export type DjMatch = "random" | "bpm" | "key" | "both";
/** How long a track plays before Auto DJ moves on: to its end, long tracks only (> 5 min -> 2 min), or a fixed number of seconds. */
export type DjSegment = "end" | "long" | "random" | "chorus" | "plan" | 30 | 60 | 90 | 120 | 180 | 240 | 300;
/** Set plan: play roughly `songs` songs in `minutes` minutes. Long files count as several songs (their hooks). */
export type PlanCurve = "flat" | "up" | "peak" | "wave";
export interface DjPlan {
  minutes: number;
  songs: number;
  startedAt: number; // ms
  played: number; // songs started so far
  prevSegment: DjSegment;
  curve: PlanCurve;
}
/** Target energy (0..1) at set progress p (0..1) for a plan curve. */
export const curveTarget = (curve: PlanCurve, p: number) => {
  switch (curve) {
    case "up":
      return 0.25 + 0.75 * p;
    case "peak": // warm-up -> peak around 70% -> ease out
      return p < 0.7 ? 0.35 + 0.65 * (p / 0.7) : 1 - 0.45 * ((p - 0.7) / 0.3);
    case "wave":
      return 0.55 + 0.4 * Math.sin(p * Math.PI * 3 - Math.PI / 2);
    default:
      return 0.6;
  }
};
/** Expected play length (s) of a track under the current Auto DJ settings - for set-list time estimates. */
export const expectedPlaySeconds = (t: TrackMeta, seg: DjSegment, planSeg?: number) => {
  const body = Math.max(10, (t.soundEnd ?? t.duration) - (t.soundStart ?? 0));
  if (planSeg) return Math.min(body, planSeg);
  if (seg === "end") return body;
  if (seg === "long") return t.duration > 300 ? Math.min(body, 120) : body;
  if (seg === "random") return Math.min(body, 120);
  if (seg === "chorus") {
    const c = t.chorusStart != null && t.chorusEnd != null ? t.chorusEnd - t.chorusStart : 30;
    return Math.min(body, c);
  }
  if (seg === "plan") return Math.min(body, 180);
  return Math.min(body, seg);
};
/** How many "songs" a file represents for planning: long mixes = their detected hooks (or ~4 min slices). */
export const songUnits = (t: TrackMeta) => (t.duration > 360 ? Math.max(1, t.choruses?.length ?? Math.round(t.duration / 240)) : 1);
/** Per-track play counts inside the current plan (long files may come back until their units are used up). */
const planPlays = new Map<string, number>();
/** Where an Auto DJ track comes in: from its start, long tracks only from a high-energy bar, or always. */
export type DjEntry = "start" | "long" | "always" | "chorus";
/** "auto" lets Auto Follow / Auto DJ pick a different transition for every track change. */
export type AutoStyle = MixStyle | "auto";
export type SaveMode = "persist" | "temp";
/** Tracks that already played out of a deck; Auto Follow never mixes back into them. */
export const spentTracks: Record<DeckId, string | null> = { A: null, B: null };
/** Duration (ms) of a transition style for the given length in beats and BPM. */
export const mixMs = (style: MixStyle, beats: number, bpm: number) => {
  const full = Math.min(90000, Math.max(3000, ((beats * 60) / bpm) * 1000));
  if (style === "blend" || style === "filter" || style === "fade") return full;
  if (style === "drop") return Math.min(full, 8000);
  if (style === "echo" || style === "reverb") return Math.min(full, 6000);
  if (style === "roll") return 3000;
  if (style === "doubledrop") return Math.min(full, ((32 * 60) / bpm) * 1000); // 8 bars of both drops
  if (style === "ramp") return Math.min(120000, full + ((32 * 60) / bpm) * 1000); // 8-bar tempo ramp, then the blend
  if (style === "breakcut") return Math.min(full, 4000);
  if (style === "cut") return 1000;
  return 900;
};

/** Position where each deck's current "segment" began (track start, cue point or the Auto DJ entry bar). */
export const segStarts: Record<DeckId, number> = { A: 0, B: 0 };
/** Per-deck random segment length (seconds) drawn when the segment starts, for the "random" setting. */
export const segCaps: Record<DeckId, number> = { A: 120, B: 120 };
export const newSegment = (id: DeckId, at: number) => {
  segStarts[id] = at;
  segCaps[id] = 60 + Math.round(Math.random() * 120);
};
/** Chorus currently being played on each deck (chorus mode), chosen from the track's list. */
export const segChorus: Record<DeckId, [number, number] | null> = { A: null, B: null };
/** Which chorus sections (track id + index) were already played, so long mixes cycle through all of them. */
const playedChoruses = new Set<string>();
const chorusesOf = (t: TrackMeta): [number, number][] => (t.choruses?.length ? t.choruses : t.chorusStart != null && t.chorusEnd != null ? [[t.chorusStart, t.chorusEnd]] : []);
/** Next unplayed chorus of a track (wraps around when all were used). */
export const nextChorus = (t: TrackMeta): [number, number] | null => {
  const list = chorusesOf(t);
  if (!list.length) return null;
  let idx = list.findIndex((_, i) => !playedChoruses.has(`${t.id}#${i}`));
  if (idx < 0) {
    for (let i = 0; i < list.length; i++) playedChoruses.delete(`${t.id}#${i}`);
    idx = 0;
  }
  playedChoruses.add(`${t.id}#${idx}`);
  return list[idx];
};
export const unplayedChorusCount = (t: TrackMeta) => chorusesOf(t).filter((_, i) => !playedChoruses.has(`${t.id}#${i}`)).length;
/** When Auto DJ should leave a deck: the earliest of OUT mark, end of the audible part, and the segment limit. */
export const autoTarget = (id: DeckId, mixOut: number | null, duration: number, seg: DjSegment, soundEnd?: number, chorusEnd?: number | null) => {
  if (seg === "chorus") return Math.min(mixOut ?? duration, segChorus[id]?.[1] ?? chorusEnd ?? segStarts[id] + 60, soundEnd ?? duration, duration);
  const cap = seg === "end" ? Infinity : seg === "long" ? (duration > 300 ? 120 : Infinity) : seg === "random" || seg === "plan" ? segCaps[id] : seg;
  return Math.min(mixOut ?? duration, segStarts[id] + cap, soundEnd ?? duration, duration);
};
/** Chorus mode uses short 8-beat overlaps so the hook of the next song lands right where the last one ended. */
export const beatsFor = (seg: DjSegment, mixBeats: number) => (seg === "chorus" ? 8 : mixBeats);
/**
 * Pro timing: a mix should finish on a phrase boundary (8 bars) of the outgoing track, not at an arbitrary second.
 * Phrases are counted from the chorus start when known (choruses sit on phrase lines), else from the first beat.
 * Returns the last phrase line at or before `target` that still leaves room for the mix; falls back to `target`.
 */
export const snapToPhrase = (target: number, t: TrackMeta | null | undefined, position: number, rate: number, leadSec: number, seg: DjSegment) => {
  if (!t?.bpm || seg === "chorus") return target; // chorus ends are phrase lines already
  const phrase = (32 * 60) / t.bpm;
  const anchor = t.chorusStart ?? t.beatOffset ?? 0;
  let snapped = anchor + Math.floor((target - anchor) / phrase + 1e-6) * phrase;
  // Section awareness: if a chorus ends within two phrases before the target, mix out there - leaving on the
  // end of a hook is what a DJ does by ear (the energy naturally drops into the next track).
  const sectionEnd = chorusesOf(t)
    .map(([, b]) => b)
    .filter((b) => b <= target + 0.01 && b >= target - 2 * phrase - 0.01 && b >= position + leadSec * rate)
    .sort((x, y) => y - x)[0];
  if (sectionEnd != null) snapped = sectionEnd;
  // Keep it while the mix (lead) still fits between now and the snapped line. The trigger fires 0.3 s before the
  // lead runs out, so this must not use a bigger margin than that or the line would be dropped just before firing.
  return snapped >= position + leadSec * rate && (sectionEnd != null || target - snapped < phrase + 0.01) ? snapped : target;
};
const entryApplies = (mode: DjEntry, duration: number) => mode === "always" || (mode === "long" && duration > 300);
/** Detects the chorus once BPM is known and stores it (user-set markers are kept). */
/**
 * Background analyses (chorus, intro, vocals, loudness) run one at a time in idle slots, so a 60-minute file
 * costs several short tasks instead of one 500 ms freeze of the UI / VJ. Each step is still synchronous inside.
 */
const idleQueue: (() => Promise<void> | void)[] = [];
let idleRunning = false;
const idle = (job: () => Promise<void> | void) => {
  idleQueue.push(job);
  if (idleRunning) return;
  idleRunning = true;
  const next = () => {
    const j = idleQueue.shift();
    if (!j) return void (idleRunning = false);
    const run = async () => {
      try {
        await j();
      } catch (e) {
        console.warn("analysis", e);
      }
      // Yield a frame between jobs (and let the audio thread / rAF breathe).
      setTimeout(next, 30);
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => void run(), { timeout: 1500 });
    else setTimeout(run, 0);
  };
  next();
};
const vocalBusy = new Set<string>();
/** Vocal-presence map (per bar) - computed once per track after the beat grid is known. */
async function ensureVocal(id: string, bpm: number | null, beatOffset: number, buffer: AudioBuffer, patch: (id: string, p: Partial<TrackMeta>) => Promise<void>) {
  if (!bpm || vocalBusy.has(id)) return;
  vocalBusy.add(id);
  try {
    const map = await vocalMap(buffer, bpm, beatOffset);
    if (map) await patch(id, { vocalMap: map });
  } catch (e) {
    console.warn("vocal map", e);
  } finally {
    vocalBusy.delete(id);
  }
}
async function ensureChorus(t: TrackMeta, buffer: AudioBuffer, patch: (id: string, p: Partial<TrackMeta>) => Promise<void>) {
  // Re-run for markers from the first detector version that landed on the very first bar.
  if (t.chorusManual) return;
  if (t.chorusStart != null && t.chorusStart > (t.soundStart ?? 0) + 0.5 && (t.choruses?.length || t.duration < 360)) return;
  const bounds = t.soundStart != null && t.soundEnd != null ? { soundStart: t.soundStart, soundEnd: t.soundEnd } : soundBounds(buffer);
  const r = detectChorus(buffer, t.bpm, t.beatOffset ?? 0, bounds);
  if (r) await patch(t.id, r);
}
/** Bounds of the audible part, computed lazily for tracks imported before this existed. */
const boundsOf = (t: TrackMeta, buffer: AudioBuffer) => (t.soundStart != null && t.soundEnd != null ? { soundStart: t.soundStart, soundEnd: t.soundEnd } : soundBounds(buffer));
/** First bar line at or after `t` on the grid. */
const barAtOrAfter = (t: number, bpm: number | null, off: number) => (bpm ? off + Math.ceil(((t - off) * bpm) / 60 / 4 - 1e-6) * ((60 / bpm) * 4) : t);
/** Grid unit (beats) a transition should land on. */
const unitFor = (style: MixStyle, align?: "beat" | "bar") => (align === "bar" || ["drop", "echo", "reverb", "cut", "roll", "fade", "doubledrop", "breakcut"].includes(style) ? 4 : 1);
/** Seconds of outgoing track the transition needs before the target: 0 for styles whose first bar line is the drop. */
export const leadMs = (style: MixStyle, beats: number, bpm: number) => (style === "doubledrop" || style === "breakcut" ? 0 : mixMs(style, beats, bpm));
/** Next drop (chorus start) of a track after `pos`, if any. */
export const nextDropAfter = (t: TrackMeta | null | undefined, pos: number) => (t ? chorusesOf(t).find(([a]) => a > pos)?.[0] ?? null : null);
/** The transition whose length the countdown / trigger should assume. */
export const effectiveStyle = (autoStyle: AutoStyle, planned: MixStyle | null): MixStyle => (autoStyle === "auto" ? (planned ?? "blend") : autoStyle);
/** Seconds until the next beat/bar of the playing deck (0 = start now), using the track's beat grid. */
const quantizeDelay = (q: Quantize, decks: Record<DeckId, DeckState>, crossfader: number) => {
  if (q === "off") return 0;
  const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
  if (!playing.length) return 0;
  const id = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
  const d = getEngine().decks[id];
  const bpm = decks[id].track!.bpm!;
  const unit = q === "bar" ? 4 : 1;
  const posBeats = ((d.position - (decks[id].track!.beatOffset ?? 0)) * bpm) / 60;
  const next = Math.ceil(posBeats / unit - 0.02) * unit;
  return Math.max(0, ((next - posBeats) * 60) / bpm / d.rate);
};

/** Pads whose buffers were re-rendered in memory: index -> "bpm|shift". */
const matchedPads = new Map<number, string>();

/** BPM / key the loops should follow: the playing deck (or the loaded one on the crossfader side). */
const matchTarget = () => {
  const { decks, crossfader, tracks } = useDJ.getState();
  const id: DeckId = decks.A.playing !== decks.B.playing ? (decks.A.playing ? "A" : "B") : crossfader < 0.5 ? "A" : "B";
  const meta = tracks.find((t) => t.id === decks[id].track?.id);
  if (!meta?.bpm) return { bpm: 128, shift: 0, label: "標準 128 BPM / Am", pending: false };
  const bpm = Math.round(meta.bpm * decks[id].rate);
  const shift = meta.keyRoot == null ? 0 : shiftFromAm({ keyRoot: meta.keyRoot, keyMinor: !!meta.keyMinor });
  return { bpm, shift, label: `${bpm} BPM${meta.key ? " / " + meta.key : ""}`, pending: meta.keyRoot == null };
};

async function renderPad(pad: PadConfig, bpm: number, shift: number) {
  const def = DEFAULT_SAMPLES.find((d) => d.name === pad.name && d.loopBpm);
  if (!def) return false;
  const sampler = getEngine().sampler;
  sampler.setBuffer(pad.index, await renderSample(def, { transpose: shift, bpm }));
  sampler.setConfig({ ...pad, loopBpm: def.tempoFree ? pad.loopBpm : bpm });
  matchedPads.set(pad.index, `${bpm}|${shift}`);
  return true;
}

let mixBusy = false;
let breaking = false;
/** Soft-deleted items waiting for their undo window to close. */
const pendingDeletes = new Map<string, ReturnType<typeof setTimeout>>();
/** Cancellation of a running transition: pending timers / sleeps are dropped and autoMix restores the decks. */
let mixCancelled = false;
const mixTimers = new Set<ReturnType<typeof setTimeout>>();
const sleepers = new Set<{ t: ReturnType<typeof setTimeout>; res: () => void }>();
let fadeAbort: (() => void) | null = null;

const currentBpm = (decks: Record<DeckId, DeckState>, crossfader: number) => {
  const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
  if (!playing.length) return 128;
  const id = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
  return decks[id].track!.bpm! * decks[id].rate;
};

/** User preferences persisted across sessions (mixer / sampler knobs that are not per-track). */
interface Prefs {
  masterVolume: number;
  samplerVolume: number;
  quantize: Quantize;
  mixBeats: number;
  autoStyle: AutoStyle;
  autoMatch: boolean;
  autoFollow: boolean;
  djScope: "all" | "selected";
  djOrder: "shuffle" | "sequential" | "queue";
  djMatch: DjMatch;
  djSegment: DjSegment;
  djEntry: DjEntry;
  djEnergy: DjEnergy;
  djPool: string[];
  /** Ordered set list consumed by Auto DJ when djOrder === "queue". */
  djQueue: string[];
  planMinutes: number;
  planSongs: number;
  planCurve: PlanCurve;
  autoFx: boolean;
  fxDepth: number;
  /** Fade the first track in instead of slamming the fader when a set starts. */
  softStart: boolean;
  /** Shift the incoming track by up to ±2 semitones (through key lock) when its key clashes with the playing one. */
  harmonicShift: boolean;
}
const PREF_KEYS: (keyof Prefs)[] = ["masterVolume", "samplerVolume", "quantize", "mixBeats", "autoStyle", "autoMatch", "autoFollow", "djScope", "djOrder", "djMatch", "djSegment", "djEntry", "djEnergy", "djPool", "djQueue", "planMinutes", "planSongs", "planCurve", "autoFx", "fxDepth", "softStart", "harmonicShift"];

/** Performance modes: how the music is played (Auto DJ behaviour + hype). The look is the VJ Theme, chosen separately. */
export type ModeId = "edm" | "chorus" | "party" | "chill" | "classic" | "drums";
export const MODES: { id: ModeId; label: string; icon: string; desc: string }[] = [
  { id: "edm", label: "EDM", icon: "🔥", desc: "フェス DJ の技: ドロップ同士を重ねる Double Drop、ビルド → ドロップ、ブレイク中にドロップへカット、ライザー / スネアロール自動、エネルギーを上げ続ける選曲 (BPM・音量が少し上の曲を優先)" },
  { id: "chorus", label: "サビ連発", icon: "🎤", desc: "各曲のサビだけを 2 小節で繋いでいく。長尺ファイルは中のサビを順番に。Auto FX / Auto Hype 中" },
  { id: "party", label: "パーティー", icon: "🎉", desc: "1〜3 分ごとにランダムで切替、派手な繋ぎ、Auto FX / Auto Hype 強" },
  { id: "chill", label: "チル", icon: "🌙", desc: "曲を最後まで、32 拍の長いブレンド、演出なし" },
  { id: "classic", label: "クラシック DJ", icon: "🎧", desc: "曲は頭から最後まで、16 拍ブレンド中心。自分でミックスする時のベース設定" },
  { id: "drums", label: "ドラムマシン", icon: "🥁", desc: "909 / 808 キットとステップシーケンサーで、サンプラーとエフェクトだけでプレイ" },
];
const DEVDAY_CAPTION = "OpenAI DevDay [2026] Hackathon";

export interface SessionSnapshot {
  at: number;
  decks: Record<DeckId, { trackId: string | null; position: number; playing: boolean; rate: number; keyShift: number }>;
  crossfader: number;
  autoDJ: boolean;
  autoFollow: boolean;
  plan: DjPlan | null;
  mode: ModeId | null;
}
export type HelpSection = "start" | "deck" | "mixer" | "sampler" | "library" | "vj" | "keys";

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
export const padLabel = (index: number) => `Bank ${BANK_NAMES[Math.floor(index / PADS_PER_BANK)]} · Pad ${(index % PADS_PER_BANK) + 1}`;

const persistTimers: Partial<Record<DeckId, ReturnType<typeof setTimeout>>> = {};

interface DJState {
  ready: boolean;
  tracks: TrackMeta[];
  samples: SampleMeta[];
  pads: PadConfig[];
  activePads: number[];
  bank: number;
  setBank: (b: number) => void;
  decks: Record<DeckId, DeckState>;
  crossfader: number;
  masterVolume: number;
  samplerVolume: number;
  /** Scratch: vinyl mode per deck (platter drag scratches instead of nudging) and auto patterns. */
  vinyl: Record<DeckId, boolean>;
  setVinyl: (deck: DeckId, on: boolean) => void;
  scratch: (deck: DeckId, kind: "baby" | "chirp" | "transformer" | "scribble" | "stab" | "rewind", beats?: number) => void;
  /** MC / rap microphone channel. */
  mic: { on: boolean; gain: number; voice: import("./audio/mic").VoicePreset; echo: boolean; reverb: boolean; duck: boolean; semitones: number; busy: boolean };
  setMicOn: (on: boolean) => Promise<void>;
  setMic: (patch: Partial<{ gain: number; voice: import("./audio/mic").VoicePreset; echo: boolean; reverb: boolean; duck: boolean; semitones: number }>) => void;
  /** Headphone cue (pre-fader listen on a second output device). */
  cue: { supported: boolean; deviceId: string; devices: { id: string; label: string }[]; on: Record<DeckId, boolean>; mix: number };
  listCueDevices: () => Promise<void>;
  setCueDevice: (id: string) => Promise<void>;
  toggleCue: (deck: DeckId) => void;
  setCueMix: (x: number) => void;
  recording: boolean;
  recordingSince: number;
  vj: VJSettings;
  loading: Record<string, boolean>;
  toast: string | null;
  toastKind: ToastKind;
  /** Optional action button on the toast (e.g. undo). */
  toastAction: { label: string; onClick: () => void } | null;
  seeding: boolean;
  confirmRequest: ConfirmRequest | null;
  confirm: (req: ConfirmRequest) => void;
  closeConfirm: () => void;
  showShortcuts: boolean;
  setShowShortcuts: (on: boolean) => void;
  /** Help overlay: which tab / section to open (null = closed). */
  helpSection: HelpSection | null;
  openHelp: (section?: HelpSection) => void;
  storage: { usage: number; quota: number; persisted: boolean } | null;
  refreshStorage: () => Promise<void>;
  requestPersist: () => Promise<void>;

  autoMatch: boolean;
  setAutoMatch: (on: boolean) => void;
  resetLoops: () => Promise<void>;
  stopAll: () => void;
  stopPad: (i: number) => void;
  quantize: Quantize;
  setQuantize: (q: Quantize) => void;
  keyShift: number;
  matchKey: () => Promise<void>;
  autoDJ: boolean;
  autoFollow: boolean;
  autoStyle: AutoStyle;
  /** Transition chosen ahead of time when autoStyle is "auto" (shown in the countdown). */
  plannedStyle: MixStyle | null;
  planStyle: (from: DeckId) => void;
  autoFx: boolean;
  setAutoFx: (on: boolean) => void;
  mixOut: Record<DeckId, number | null>;
  setAutoFollow: (on: boolean) => void;
  setAutoStyle: (s: AutoStyle) => void;

  /** Auto DJ source: all tracks or just the ticked ones; random or library order; smart = prefer BPM/key matches. */
  djScope: "all" | "selected";
  djOrder: "shuffle" | "sequential" | "queue";
  djMatch: DjMatch;
  djSegment: DjSegment;
  djEntry: DjEntry;
  djEnergy: DjEnergy;
  djPool: string[];
  djQueue: string[];
  queueAdd: (ids: string[]) => void;
  queueRemove: (index: number) => void;
  queueMove: (index: number, dir: -1 | 1) => void;
  queueClear: () => void;
  /** Reorder the queue for smooth BPM / key flow (greedy nearest neighbour on the Camelot wheel + tempo). */
  queueSmartSort: () => void;
  planCurve: PlanCurve;
  setPlanCurve: (c: PlanCurve) => void;
  /** Set plan (time + songs). */
  planMinutes: number;
  planSongs: number;
  plan: DjPlan | null;
  setPlanInputs: (minutes: number, songs: number) => void;
  startPlan: () => Promise<void>;
  stopPlan: (reason?: string) => void;
  /** Seconds the current / next segment should get under the plan. */
  planSegmentSeconds: () => number;
  setDjEnergy: (v: DjEnergy) => void;
  softStart: boolean;
  setSoftStart: (v: boolean) => void;
  harmonicShift: boolean;
  setHarmonicShift: (v: boolean) => void;
  setKeyShift: (deck: DeckId, semitones: number) => void;
  /** Start the idle deck's track with a fade-in (set opener); if a deck is already playing this is a fade blend. */
  fadeIn: () => void;
  setDjMatch: (v: DjMatch) => void;
  setDjSegment: (v: DjSegment) => void;
  setDjEntry: (v: DjEntry) => void;
  /** Turn Auto DJ on and make sure both decks are loaded and music is playing. */
  startAutoDJ: (opts?: { scope?: "all" | "selected" }) => Promise<void>;
  setDjScope: (v: "all" | "selected") => void;
  setDjOrder: (v: "shuffle" | "sequential" | "queue") => void;
  toggleDjPool: (id: string) => void;
  setDjPool: (ids: string[]) => void;
  /** Loads the next Auto DJ pick onto the idle deck ahead of the transition. */
  preloadNext: (from: DeckId) => Promise<void>;
  /** Library "次にこの曲": the next Auto DJ pick (once). */
  nextOverride: string | null;
  setNextOverride: (id: string | null) => void;
  /** What has been played this session (for the set list / history). */
  playLog: { id: string; name: string; at: number }[];
  clearPlayLog: () => void;

  fx: Record<FxName, boolean>;
  fxDepth: number;
  setFx: (name: FxName, on: boolean) => void;
  setFxDepth: (v: number) => void;

  saveMode: SaveMode;
  setSaveMode: (m: SaveMode) => void;
  /** Move a temporary track / sample into permanent storage. */
  keepTrack: (id: string) => Promise<void>;
  keepSample: (id: string) => Promise<void>;
  keepAllTemporary: () => Promise<void>;
  setMixOut: (id: DeckId, t: number | null) => void;
  setAutoDJ: (on: boolean) => void;
  autoMix: (opts?: { loadNext?: boolean; style?: MixStyle; align?: "beat" | "bar"; auto?: boolean; beats?: number }) => Promise<void>;
  mixBeats: number;
  setMixBeats: (n: number) => void;
  fadeOut: () => void;
  doBreak: (beats?: number) => void;
  /** Hype tools: a filtered build-up that lands on a bar line with a drop, and a crowd shout-out. */
  buildDrop: (bars?: number) => void;
  crowd: () => void;
  /** DJ techniques: echo throw (one-beat echo burst), gater (hold), filter rise (one-shot build). */
  echoThrow: () => void;
  gateHold: (division: number | null) => void;
  gateDivision: number | null;
  filterRise: (bars?: number) => void;
  setKeylock: (deck: DeckId, on: boolean) => void;
  /** Change the tempo of the whole set: every playing deck (and a cued-up next deck) by `pct` percent; 0 resets to the tracks' own tempo. */
  nudgeSetTempo: (pct: number | "reset") => void;
  /** Master beat repeat (stutter): slice length in beats, null = off. Starts on the next beat of the playing deck. */
  beatRepeat: number | null;
  setBeatRepeat: (beats: number | null) => void;

  playlists: Playlist[];
  savePlaylist: (name: string, trackIds: string[]) => Promise<void>;
  deletePlaylist: (id: string) => Promise<void>;
  renamePlaylist: (id: string, name: string) => Promise<void>;
  /** Puts a playlist into the Auto DJ pool (and switches the scope to "selected"). */
  applyPlaylist: (id: string) => void;
  setFilterFx: (mode: "hpf" | "lpf" | null) => void;
  filterFx: "hpf" | "lpf" | null;
  echo: boolean;
  /** A transition (auto mix / fade out) is running and can be aborted with cancelMix. */
  mixing: boolean;
  cancelMix: () => void;

  init: () => Promise<void>;
  /** Session snapshot (decks, crossfader, Auto DJ, plan, queue) for "continue where you were" after a reload / crash. */
  saveSession: () => void;
  restoreSession: () => Promise<void>;
  sessionAvailable: SessionSnapshot | null;
  /** Performance dashboard overlay (Tab). */
  liveView: boolean;
  setToast: (m: string | null, kind?: ToastKind, action?: { label: string; onClick: () => void } | null) => void;
  /** Generate built-in sampler kit + demo tracks (skips items that already exist). */
  seedDefaults: (restore?: boolean) => Promise<void>;
  /** Delete every built-in sample / demo song at once (undoable for 6 s), and keep them from being re-created. */
  deleteDefaults: (kind: "samples" | "tracks") => void;
  rememberRemoved: (keys: string[]) => void;

  importTracks: (files: FileList | File[]) => Promise<void>;
  deleteTrack: (id: string) => Promise<void>;
  renameTrack: (id: string, name: string) => Promise<void>;
  setTrackBpm: (id: string, bpm: number | null) => Promise<void>;
  setTrackBeatOffset: (id: string, offset: number) => Promise<void>;
  /** Re-run BPM / first-beat detection (and the chorus detection that depends on it). */
  reanalyzeBpm: (id: string) => Promise<void>;
  /** Mark the chorus by hand: `start` snapped to the bar grid, `bars` long (default 16). */
  setChorus: (id: string, start: number, bars?: number) => Promise<void>;
  clearChorus: (id: string) => Promise<void>;
  /** Re-run the automatic detection (also clears a manual marker). */
  detectChorusFor: (id: string) => Promise<void>;
  /** One switch for "サビだけ繋ぐ": chorus segments + chorus entry (off = back to defaults). */
  setChorusMode: (on: boolean) => void;
  mode: ModeId | null;
  applyMode: (m: ModeId) => void;
  applyTheme: (t: VJTheme) => void;
  applyShow: (s: VJShow) => void;
  /** Looks: saved theme x show x preset combinations. Recall is quantised to the next bar while music plays. */
  looks: VJLook[];
  activeLook: string | null;
  applyLook: (id: string) => void;
  saveLook: (name: string) => Promise<void>;
  deleteLook: (id: string) => Promise<void>;
  /** One switch for the fully automatic VJ: music-follow + preset switching + director + drop / hype reactions. */
  setAutoVJ: (on: boolean) => void;
  /** Preset currently on screen (music-follow may differ from the stored `vj.preset`). */
  vjLive: VJSettings["preset"] | null;

  /** Step sequencer (drum machine). */
  seq: { playing: boolean; step: number; slot: number; patterns: Pattern[]; swing: number; bpm: number; open: boolean };
  seqToggle: () => void;
  seqSetStep: (lane: number, step: number, v: Step) => void;
  seqSetLane: (lane: number, pad: number | null) => void;
  seqSetSlot: (slot: number) => void;
  seqClear: () => void;
  seqSetSwing: (v: number) => void;
  seqSetBpm: (v: number) => void;
  seqSetOpen: (v: boolean) => void;
  /** Fill the lanes with the 8 drum pads of a bank and a basic four-on-the-floor / trap pattern. */
  seqPreset: (name: "house" | "trap" | "breaks" | "techno") => void;
  /** Returns false when the deck is playing and `force` was not given (load lock). */
  loadToDeck: (trackId: string, deck: DeckId, force?: boolean) => Promise<boolean>;
  deckAction: (deck: DeckId, fn: (d: ReturnType<typeof getEngine>["decks"]["A"]) => void) => void;
  syncToOther: (deck: DeckId) => void;
  syncDecks: () => void;

  importSamples: (files: FileList | File[]) => Promise<void>;
  deleteSample: (id: string) => Promise<void>;
  /** Bulk soft delete (one undo for the whole set). */
  deleteSamples: (ids: string[]) => Promise<void>;
  assignSample: (padIndex: number, sampleId: string | null) => Promise<void>;
  updatePad: (padIndex: number, patch: Partial<PadConfig>) => Promise<void>;
  pressPad: (i: number, immediate?: boolean) => void;
  releasePad: (i: number) => void;
  setEcho: (on: boolean) => void;
  micRecording: boolean;
  micSince: number;
  toggleMicRecording: () => Promise<void>;

  previewing: string | null;
  previewSample: (id: string) => Promise<void>;
  previewTrack: (id: string) => Promise<void>;
  stopPreview: () => void;

  exportBackup: () => Promise<void>;
  importBackup: (file: File) => Promise<void>;
  setMedia: (file: File | null) => Promise<void>;
  setLogo: (file: File | null) => Promise<void>;

  setCrossfader: (x: number) => void;
  setMasterVolume: (v: number) => void;
  setSamplerVolume: (v: number) => void;
  toggleRecording: () => Promise<void>;
  setVJ: (patch: Partial<VJSettings>) => void;
}

export const useDJ = create<DJState>((set, get) => {
  const toast = (text: string | null, kind: ToastKind = "info", action: { label: string; onClick: () => void } | null = null) => ({ toast: text, toastKind: kind, toastAction: action });
  const savePrefs = () => {
    const s = get();
    const prefs = Object.fromEntries(PREF_KEYS.map((k) => [k, s[k]])) as unknown as Prefs;
    void db.setSetting("prefs", prefs);
  };
  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K], extra: Partial<DJState> = {}) => {
    set({ [key]: value, ...extra } as Partial<DJState>);
    savePrefs();
  };
  /** Debounced: writes the deck's cues / loop / cue point to the loaded track. */
  const persistDeckTrack = (id: DeckId) => {
    clearTimeout(persistTimers[id]);
    persistTimers[id] = setTimeout(async () => {
      const d = getEngine().decks[id];
      const t = d.track;
      if (!t) return;
      const patch: Partial<TrackMeta> = { cues: [...d.cues], cuePoint: d.cuePoint, loopIn: d.loop.in, loopOut: d.loop.out };
      d.updateTrack(patch);
      await updateTrackRec(t.id, patch);
      set((s) => ({ tracks: s.tracks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) }));
    }, 400);
  };
  const patchTrack = async (id: string, patch: Partial<TrackMeta>) => {
    await updateTrackRec(id, patch);
    for (const d of Object.values(getEngine().decks)) if (d.track?.id === id) d.updateTrack(patch);
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    get().syncDecks();
  };
  let micRecorder: MediaRecorder | null = null;
  let micStream: MediaStream | null = null;
  let preloading = false;
  let preloadCooldown = 0;
  const history: string[] = [];
  const wasPlaying: Record<DeckId, boolean> = { A: false, B: false };

  /** Fire a sampler pad by name (kit sounds used as transition accents) without quantize delay. */
  const hit = (name: string, afterMs = 0) => {
    if (!get().autoFx) return;
    const pad = get().pads.find((p) => p.name === name && p.sampleId);
    if (!pad) return;
    const t = setTimeout(() => (mixTimers.delete(t), get().pressPad(pad.index, true)), Math.max(0, afterMs));
    mixTimers.add(t);
  };

  /** Smart weighting: close BPM (incl. half / double time) and harmonically compatible keys win more often. */
  const pickNext = (from: DeckId): TrackMeta | null => {
    const s = get();
    const cur = s.decks[from].track;
    // "Play this next" from the library wins over the automatic pick (once).
    if (s.nextOverride) {
      const forced = s.tracks.find((t) => t.id === s.nextOverride);
      set({ nextOverride: null });
      if (forced && forced.id !== cur?.id) {
        history.push(forced.id);
        return forced;
      }
    }
    // Ordered set list: take the next entry (consumed). When it runs out, fall back to shuffle.
    if (s.djOrder === "queue") {
      const q = [...s.djQueue];
      while (q.length) {
        const id = q.shift()!;
        const t = s.tracks.find((x) => x.id === id);
        if (t && t.id !== cur?.id) {
          setPref("djQueue", q);
          history.push(t.id);
          return t;
        }
      }
      if (s.djQueue.length) setPref("djQueue", []);
      if (!s.plan) set(toast("キューが終わりました: 以後はシャッフルで続けます"));
    }
    const loaded = new Set([s.decks.A.track?.id, s.decks.B.track?.id]);
    let pool = s.djScope === "selected" ? s.tracks.filter((t) => s.djPool.includes(t.id)) : s.tracks;
    if (!pool.length) pool = s.tracks;
    if (!pool.length) return null;
    if (pool.length === 1) return pool[0];
    if (s.djOrder === "sequential") {
      const i = pool.findIndex((t) => t.id === cur?.id);
      return pool[(i + 1) % pool.length];
    }
    const chorusMode = s.djSegment === "chorus";
    const planMode = !!s.plan;
    // Chorus / plan mode: a long mix with several unplayed hooks (song units) may be picked again even if it was just on.
    const unitsLeft = (t: TrackMeta) => (planMode ? songUnits(t) - (planPlays.get(t.id) ?? 0) : chorusMode ? unplayedChorusCount(t) : 1);
    const avail = (t: TrackMeta) => !loaded.has(t.id) || ((chorusMode || planMode) && t.id !== cur?.id && unitsLeft(t) > 0);
    let cands = pool.filter((t) => avail(t) && (!history.includes(t.id) || ((chorusMode || planMode) && unitsLeft(t) > 1)));
    if (planMode) {
      const fresh = cands.filter((t) => unitsLeft(t) > 0);
      if (fresh.length) cands = fresh;
    }
    if (!cands.length) {
      history.length = 0;
      cands = pool.filter((t) => avail(t));
    }
    if (!cands.length) cands = pool.filter((t) => t.id !== cur?.id);
    const weight = (t: TrackMeta) => {
      let w = chorusMode ? Math.max(1, Math.min(6, unplayedChorusCount(t))) : 1; // many hooks left -> more likely
      if (s.djMatch === "random" || !cur) return w;
      if ((s.djMatch === "bpm" || s.djMatch === "both") && cur.bpm && t.bpm) {
        const r = t.bpm / cur.bpm;
        const d = Math.min(Math.abs(r - 1), Math.abs(r / 2 - 1), Math.abs(r * 2 - 1));
        w *= d < 0.06 ? 4 : d < 0.12 ? 2.5 : d < 0.2 ? 1 : 0.3;
      }
      // Energy design: "up" favours slightly faster / louder tracks than the current one, "wave" alternates.
      if (s.djEnergy !== "flat" && cur.bpm && t.bpm) {
        const up = s.djEnergy === "up" || (s.djEnergy === "wave" && history.length % 2 === 0);
        const dBpm = t.bpm - cur.bpm;
        const dLoud = (t.loudness ?? -16) - (cur.loudness ?? -16);
        const score = (up ? 1 : -1) * (Math.max(-6, Math.min(6, dBpm)) / 6 + Math.max(-6, Math.min(6, dLoud)) / 6);
        w *= 1 + Math.max(-0.7, Math.min(1.5, score));
      }
      // Plan energy curve: prefer tracks whose energy (BPM + loudness rank within the pool) matches the target
      // for this point of the set (warm-up -> peak -> ease out, etc.).
      if (s.plan && s.plan.curve !== "flat" && t.bpm) {
        const p = Math.min(1, (Date.now() - s.plan.startedAt) / 1000 / (s.plan.minutes * 60));
        const target = curveTarget(s.plan.curve, p);
        const bpms = pool.map((x) => x.bpm ?? 0).filter(Boolean);
        const louds = pool.map((x) => x.loudness ?? -16);
        const norm = (v: number, arr: number[]) => {
          const lo = Math.min(...arr);
          const hi = Math.max(...arr);
          return hi > lo ? (v - lo) / (hi - lo) : 0.5;
        };
        const energy = 0.6 * norm(t.bpm, bpms) + 0.4 * norm(t.loudness ?? -16, louds);
        w *= 1 + 2 * (1 - Math.min(1, Math.abs(energy - target) * 2));
      }
      // Key priority is stronger when it is the only criterion: compatible keys dominate, unknown keys stay possible.
      if ((s.djMatch === "key" || s.djMatch === "both") && cur.keyRoot != null) {
        if (keysCompatible(t, cur)) w *= s.djMatch === "key" ? 8 : 2.5;
        else if (t.keyRoot != null && s.djMatch === "key") w *= 0.15;
      }
      return w;
    };
    const ws = cands.map(weight);
    let r = Math.random() * ws.reduce((a, b) => a + b, 0);
    let pick = cands[cands.length - 1];
    for (let i = 0; i < cands.length; i++) {
      r -= ws[i];
      if (r <= 0) {
        pick = cands[i];
        break;
      }
    }
    history.push(pick.id);
    while (history.length > Math.min(8, pool.length - 1)) history.shift();
    if (s.plan) planPlays.set(pick.id, (planPlays.get(pick.id) ?? 0) + 1);
    return pick;
  };
  /** Played-set log (track id + wall-clock time), newest last. */
  const logPlay = (t: TrackMeta | null | undefined) => {
    if (!t) return;
    const last = get().playLog.at(-1);
    if (last?.id === t.id && Date.now() - last.at < 30000) return;
    set((s) => ({ playLog: [...s.playLog, { id: t.id, name: t.name, at: Date.now() }].slice(-200) }));
    if (get().vj.nowPlaying) featureBus.triggerFx({ fx: "lowerthird", hue: get().vj.hue, text: t.name.replace(/\.[a-z0-9]{2,4}$/i, "") });
  };

  /** Beat-matchable pairs get the long blends; far-apart tempos get cuts that do not rely on a shared grid. */
  /** How far the incoming tempo may be bent to match. Wider with key lock, and wider still when the DJ has already
   *  pushed the set tempo away from the tracks' natural speed (they clearly want that tempo kept). */
  const tempoTolerance = (keylock: boolean, srcRate: number) => Math.min(0.25, Math.max(keylock ? 0.16 : 0.12, Math.abs(srcRate - 1) + 0.1));
  const chooseStyle = (a?: TrackMeta | null, b?: TrackMeta | null): MixStyle => {
    const e = getEngine();
    const keylock = e.decks.A.keylock && e.decks.B.keylock;
    const known = !!(a?.bpm && b?.bpm);
    // Compare against the *current* tempo of the deck that holds `a` (the DJ may have moved its pitch).
    const srcRate = e.decks.A.track?.id === a?.id ? e.decks.A.rate : e.decks.B.track?.id === a?.id ? e.decks.B.rate : 1;
    const ratio = known ? (b!.bpm! / (a!.bpm! * srcRate)) : 1;
    const d = known ? Math.min(Math.abs(ratio - 1), Math.abs(ratio / 2 - 1), Math.abs(ratio * 2 - 1)) : 1;
    const close = known && d < tempoTolerance(keylock, srcRate);
    // Medium gap (up to 30%) with key lock: ramp the playing track's tempo over 8 bars, then beat-match - the way a
    // DJ "rides the pitch" into a faster / slower record instead of giving up and fading.
    const rampable = known && !close && keylock && d < 0.3;
    // Beat-matchable: long blends. Unknown / far apart tempo: fades and cuts that need no shared grid.
    const chorus = get().djSegment === "chorus";
    // Chorus mode: keep the energy up - short blends and clean cuts, nothing that stalls (no spin / build-ups).
    // Pro behaviour: beat-matched pairs get long EQ blends almost always (a filter blend now and then);
    // the showy cuts / spinbacks / drops stay manual. Far-apart tempos fade or echo out - never a hard clash.
    const bag: MixStyle[] = chorus
      ? close
        ? ["blend", "blend", "blend", "echo", "filter"]
        : ["fade", "echo", "fade", "fade"]
      : close
        ? ["blend", "blend", "blend", "blend", "filter", "blend", "echo"]
        : rampable
          ? ["ramp", "ramp", "ramp", "fade", "echo"]
          : ["fade", "fade", "fade", "echo", "fade"];
    return bag[Math.floor(Math.random() * bag.length)];
  };

  return {
    ready: false,
    tracks: [],
    samples: [],
    pads: Array.from({ length: PAD_COUNT }, (_, i) => defaultPad(i)),
    activePads: [],
    bank: 0,
    setBank: (bank) => set({ bank }),
    decks: { A: emptyDeck("A"), B: emptyDeck("B") },
    crossfader: 0.5,
    masterVolume: 0.9,
    samplerVolume: 1,
    recording: false,
    recordingSince: 0,
    vj: defaultVJ,
    loading: {},
    toast: null,
    toastKind: "info",
    toastAction: null,
    seeding: false,
    confirmRequest: null,
    confirm: (confirmRequest) => set({ confirmRequest }),
    closeConfirm: () => set({ confirmRequest: null }),
    showShortcuts: false,
    setShowShortcuts: (showShortcuts) => set({ showShortcuts, helpSection: showShortcuts ? "keys" : null }),
    helpSection: null,
    openHelp: (section = "start") => set({ showShortcuts: true, helpSection: section }),
    storage: null,
    refreshStorage: async () => {
      const storage = await db.storageInfo();
      set({ storage });
      if (storage && storage.quota > 0 && storage.usage / storage.quota > 0.85 && !lowSpaceWarned) {
        lowSpaceWarned = true;
        set(toast(`ブラウザの保存容量の ${Math.round((storage.usage / storage.quota) * 100)}% を使用中です。不要な曲 / サンプルの削除か、バックアップ (Library › ⋯) をおすすめします`, "error"));
      }
    },
    requestPersist: async () => {
      const ok = await db.requestPersist();
      set(toast(ok ? "ブラウザがこのサイトのデータを保護するようになりました" : "この環境では永続化を要求できませんでした", ok ? "success" : "error"));
      await get().refreshStorage();
    },

    quantize: "bar",
    setQuantize: (quantize) => setPref("quantize", quantize),
    keyShift: 0,
    autoMatch: true,
    setAutoMatch: (autoMatch) => setPref("autoMatch", autoMatch, toast(autoMatch ? "Auto Match ON: ループを押すと曲のテンポとキーに合わせて作り直します" : "Auto Match OFF")),
    matchKey: async () => {
      const t = matchTarget();
      if (t.pending) return void set(toast("キーを解析中です。少し待ってからもう一度押してください", "error"));
      let n = 0;
      for (const pad of get().pads) {
        if (!pad.loopBpm || !pad.sampleId) continue;
        set(toast(`テンポ/キー合わせ中… ${pad.name}`, "progress"));
        if (await renderPad(pad, t.bpm, t.shift)) n++;
      }
      set({ keyShift: t.shift, ...toast(`${t.label}: ${n} 個のループを合わせました`, "success") });
    },
    resetLoops: async () => {
      const engine = getEngine();
      for (const [index] of matchedPads) {
        const pad = get().pads[index];
        const rec = pad.sampleId ? await getSampleRec(pad.sampleId) : null;
        if (rec) engine.sampler.setBuffer(index, await engine.decode(rec.id, rec.blob));
        engine.sampler.setConfig(pad);
      }
      matchedPads.clear();
      set({ keyShift: 0, ...toast("ループを元のテンポ/キーに戻しました") });
    },
    stopPad: (i) => getEngine().sampler.release(i, true),
    stopAll: () => {
      if (getEngine().sequencer.playing) get().seqToggle();
      getEngine().sampler.stopAll();
      get().stopPreview();
      // Release anything latched on the master: filter sweep, beat repeat, FX sends - the usual reasons
      // the whole mix suddenly sounds muffled or stuttery.
      if (get().filterFx) get().setFilterFx(null);
      if (get().beatRepeat != null) get().setBeatRepeat(null);
      if (get().gateDivision != null) get().gateHold(null);
      for (const [n, on] of Object.entries(get().fx)) if (on) get().setFx(n as FxName, false);
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      featureBus.triggerFx({ fx: "clear", hue: 0 });
      set(toast("全解除しました"));
    },
    autoDJ: false,
    autoFollow: false,
    autoStyle: "auto",
    plannedStyle: null,
    planStyle: (from) => {
      const d = get().decks;
      const to: DeckId = from === "A" ? "B" : "A";
      if (get().autoStyle !== "auto") return void set({ plannedStyle: null });
      let style = chooseStyle(d[from].track, d[to].track);
      // EDM mode: when the incoming track has a detected drop (chorus) and the outgoing has one coming up,
      // use the festival techniques - double drop (both drops on the same bar) or build -> drop swap.
      if (get().mode === "edm" && style !== "fade") {
        const out = d[from].track;
        const inc = d[to].track;
        const nextDrop = out ? chorusesOf(out).find(([a]) => a > d[from].position + 8) : undefined;
        const incHasDrop = !!inc && chorusesOf(inc).length > 0;
        const r = Math.random();
        if (nextDrop && incHasDrop && r < 0.4) style = "doubledrop";
        else if (incHasDrop && r < 0.7) style = "drop";
      }
      set({ plannedStyle: style });
    },
    autoFx: true,
    setAutoFx: (autoFx) => setPref("autoFx", autoFx, toast(autoFx ? "Auto FX ON: 繋ぎにライザー / インパクトなどのサンプルを自動で重ねます" : "Auto FX OFF")),
    djScope: "all",
    djOrder: "shuffle",
    djMatch: "both",
    djSegment: "long",
    djEntry: "always",
    djEnergy: "flat",
    djQueue: [],
    queueAdd: (ids) => {
      const q = [...get().djQueue, ...ids.filter((id) => !get().djQueue.includes(id))];
      setPref("djQueue", q);
      if (get().djOrder !== "queue") setPref("djOrder", "queue");
      set(toast(`キューに ${ids.length} 曲を追加 (${q.length} 曲)`));
    },
    queueRemove: (index) => setPref("djQueue", get().djQueue.filter((_, i) => i !== index)),
    queueMove: (index, dir) => {
      const q = [...get().djQueue];
      const j = index + dir;
      if (j < 0 || j >= q.length) return;
      [q[index], q[j]] = [q[j], q[index]];
      setPref("djQueue", q);
    },
    queueClear: () => setPref("djQueue", []),
    queueSmartSort: () => {
      const s = get();
      const items = s.djQueue.map((id) => s.tracks.find((t) => t.id === id)).filter((t): t is TrackMeta => !!t);
      if (items.length < 3) return;
      const cost = (a: TrackMeta, b: TrackMeta) => {
        let c = 0;
        if (a.bpm && b.bpm) {
          const r = b.bpm / a.bpm;
          const d = Math.min(Math.abs(r - 1), Math.abs(r / 2 - 1), Math.abs(r * 2 - 1));
          c += d * 40; // 10% apart = 4
        } else c += 3;
        if (a.keyRoot != null && b.keyRoot != null) {
          const ca = camelotNumber(a.keyRoot, !!a.keyMinor);
          const cb = camelotNumber(b.keyRoot, !!b.keyMinor);
          const wheel = Math.min(Math.abs(ca - cb), 12 - Math.abs(ca - cb));
          c += wheel * 1.2 + (!!a.keyMinor !== !!b.keyMinor && wheel !== 0 ? 0.6 : 0);
        } else c += 1.5;
        return c;
      };
      // Greedy nearest neighbour from the first entry (keep the opener the DJ chose), then 2-opt passes.
      const order = [items[0]];
      const rest = items.slice(1);
      while (rest.length) {
        const last = order[order.length - 1];
        let bi = 0;
        for (let i = 1; i < rest.length; i++) if (cost(last, rest[i]) < cost(last, rest[bi])) bi = i;
        order.push(rest.splice(bi, 1)[0]);
      }
      const total = (arr: TrackMeta[]) => arr.reduce((acc, t, i) => (i ? acc + cost(arr[i - 1], t) : 0), 0);
      let improved = true;
      let guard = 0;
      while (improved && guard++ < 50) {
        improved = false;
        for (let i = 1; i < order.length - 1; i++)
          for (let j = i + 1; j < order.length; j++) {
            const cand = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
            if (total(cand) + 1e-9 < total(order)) {
              order.splice(0, order.length, ...cand);
              improved = true;
            }
          }
      }
      setPref("djQueue", order.map((t) => t.id));
      set(toast(`キューを相性順に並べ替えました (BPM とキーが滑らかに繋がる順)`, "success"));
    },
    planCurve: "peak",
    setPlanCurve: (c) => setPref("planCurve", c),
    planMinutes: 60,
    planSongs: 15,
    plan: null,
    setPlanInputs: (minutes, songs) => {
      setPref("planMinutes", Math.max(1, Math.round(minutes)));
      setPref("planSongs", Math.max(1, Math.round(songs)));
    },
    planSegmentSeconds: () => {
      const p = get().plan;
      if (!p) return 120;
      const elapsed = (Date.now() - p.startedAt) / 1000;
      const remainingSec = Math.max(0, p.minutes * 60 - elapsed);
      const remainingSongs = Math.max(1, p.songs - p.played);
      return Math.max(30, remainingSec / remainingSongs);
    },
    startPlan: async () => {
      const s = get();
      const pool = s.djScope === "selected" ? s.tracks.filter((t) => s.djPool.includes(t.id)) : s.tracks;
      const units = pool.reduce((n, t) => n + songUnits(t), 0);
      planPlays.clear();
      const prevSegment = s.djSegment === "plan" ? "long" : s.djSegment;
      set({ plan: { minutes: s.planMinutes, songs: s.planSongs, startedAt: Date.now(), played: 0, prevSegment, curve: s.planCurve } });
      setPref("djSegment", "plan");
      if (s.djEntry === "start") setPref("djEntry", "always");
      const per = (s.planMinutes * 60) / s.planSongs;
      set(toast(`セットプラン: ${s.planMinutes} 分 / ${s.planSongs} 曲 → 1 曲 約 ${Math.floor(per / 60)}:${String(Math.round(per % 60)).padStart(2, "0")}${units < s.planSongs ? ` (対象は ${units} 曲分なので一部繰り返します)` : ""}`, "success"));
      await get().startAutoDJ();
    },
    stopPlan: (reason) => {
      const p = get().plan;
      if (!p) return;
      setPref("djSegment", p.prevSegment);
      set({ plan: null, ...toast(reason ?? "セットプランを終了しました") });
    },
    setDjEnergy: (v) => setPref("djEnergy", v),
    softStart: true,
    setSoftStart: (v) => setPref("softStart", v),
    harmonicShift: true,
    setHarmonicShift: (v) => setPref("harmonicShift", v),
    setKeyShift: (deck, semitones) => {
      getEngine().decks[deck].setKeyShift(semitones);
      get().syncDecks();
    },
    fadeIn: () => {
      const e = getEngine();
      const { decks, crossfader, mixBeats } = get();
      if (decks.A.playing || decks.B.playing) return void get().autoMix({ style: "fade" });
      const id: DeckId = decks.A.track && !decks.B.track ? "A" : decks.B.track && !decks.A.track ? "B" : crossfader < 0.5 ? "A" : "B";
      const d = e.decks[id];
      if (!d.track) return void set(toast("デッキに曲がありません", "error"));
      const bpm = d.track.bpm ?? 120;
      const sec = Math.min(30, Math.max(2, ((Math.min(mixBeats, 32) * 60) / bpm)));
      get().setCrossfader(id === "A" ? 0 : 1);
      d.playFadeIn(sec);
      get().syncDecks();
      set(toast(`FADE IN ${id}: ${sec.toFixed(0)} 秒かけて入ります`));
    },
    djPool: [],
    setDjScope: (v) => setPref("djScope", v),
    setDjOrder: (v) => setPref("djOrder", v),
    setDjMatch: (v) => setPref("djMatch", v),
    setDjSegment: (v) => {
      setPref("djSegment", v);
      set({ mode: null });
    },
    setDjEntry: (v) => {
      setPref("djEntry", v);
      set({ mode: null });
    },
    toggleDjPool: (id) => setPref("djPool", get().djPool.includes(id) ? get().djPool.filter((x) => x !== id) : [...get().djPool, id]),
    setDjPool: (ids) => setPref("djPool", ids),
    nextOverride: null,
    setNextOverride: (id) => {
      set({ nextOverride: id });
      if (id) {
        const t = get().tracks.find((x) => x.id === id);
        set(toast(`次は「${t?.name ?? ""}」を流します`, "success"));
        // If the idle deck already holds a different pick, swap it now so the countdown shows the right song.
        const { decks } = get();
        const playing: DeckId | null = decks.A.playing ? "A" : decks.B.playing ? "B" : null;
        if (playing && get().autoDJ) {
          const idle: DeckId = playing === "A" ? "B" : "A";
          if (!decks[idle].playing && decks[idle].track?.id !== id) {
            preloadCooldown = 0;
            spentTracks[idle] = decks[idle].track?.id ?? null; // mark the previous pick as not-ready so preload replaces it
            void get().preloadNext(playing);
          }
        }
      }
    },
    playLog: [],
    clearPlayLog: () => set({ playLog: [] }),
    preloadNext: async (from) => {
      const to: DeckId = from === "A" ? "B" : "A";
      if (preloading || Date.now() < preloadCooldown || get().decks[to].playing) return;
      preloading = true;
      preloadCooldown = Date.now() + 3000;
      try {
        const next = pickNext(from);
        if (!next) return;
        if (await get().loadToDeck(next.id, to, true)) get().planStyle(from);
      } finally {
        preloading = false;
      }
    },

    fx: { echo: false, reverb: false, flanger: false },
    fxDepth: 0.6,
    setFx: (name, on) => {
      getEngine().setFx(name, on ? get().fxDepth : 0, currentBpm(get().decks, get().crossfader));
      set((s) => ({ fx: { ...s.fx, [name]: on } }));
    },
    setFxDepth: (v) => {
      setPref("fxDepth", v);
      const bpm = currentBpm(get().decks, get().crossfader);
      for (const [n, on] of Object.entries(get().fx)) if (on) getEngine().setFx(n as FxName, v, bpm);
    },

    saveMode: "persist",
    // Deliberately NOT persisted: every launch starts in "継続" so nothing is silently lost because "一時" was left on.
    setSaveMode: (m) => set({ saveMode: m, ...toast(m === "temp" ? "一時モード: これから追加する曲・サンプルはこのタブを閉じる / リロードすると消えます" : "継続モード: 追加した曲・サンプルはブラウザに保存されます") }),
    keepTrack: async (id) => {
      const rec = memTracks.get(id);
      if (!rec) return;
      const { temporary: _t, ...clean } = rec;
      void _t;
      await db.putTrack(clean as TrackRecord);
      memTracks.delete(id);
      set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, temporary: false } : t)), ...toast(`「${rec.name}」を保存しました`, "success") }));
      void get().refreshStorage();
    },
    keepSample: async (id) => {
      const rec = memSamples.get(id);
      if (!rec) return;
      const { temporary: _t, ...clean } = rec;
      void _t;
      await db.putSample(clean as SampleRecord);
      memSamples.delete(id);
      set((s) => ({ samples: s.samples.map((x) => (x.id === id ? { ...x, temporary: false } : x)), ...toast(`「${rec.name}」を保存しました`, "success") }));
      void get().refreshStorage();
    },
    keepAllTemporary: async () => {
      for (const id of [...memTracks.keys()]) await get().keepTrack(id);
      for (const id of [...memSamples.keys()]) await get().keepSample(id);
      set(toast("一時データをすべて保存しました", "success"));
    },
    mixOut: { A: null, B: null },
    setAutoFollow: (autoFollow) => setPref("autoFollow", autoFollow, toast(autoFollow ? "Auto Follow ON: 次の曲をセットするとOUT位置で自動ミックス" : "Auto Follow OFF")),
    setAutoStyle: (autoStyle) => setPref("autoStyle", autoStyle),
    setMixOut: (id, t) => {
      set((s) => ({ mixOut: { ...s.mixOut, [id]: t }, ...toast(t == null ? `Deck ${id}: ミックスアウト位置を解除` : `Deck ${id}: ミックスアウト位置を設定`) }));
      const trackId = get().decks[id].track?.id;
      if (trackId) void patchTrack(trackId, { mixOut: t });
    },
    setAutoDJ: (autoDJ) => {
      if (autoDJ) void get().startAutoDJ();
      else {
        set({ autoDJ: false, ...toast("Auto DJ OFF") });
        if (get().plan) get().stopPlan();
      }
    },
    startAutoDJ: async (opts) => {
      if (opts?.scope) setPref("djScope", opts.scope);
      const st = get();
      if (!st.tracks.length) return void set(toast("ライブラリに曲がありません。「+ 追加」で曲を入れてください", "error"));
      if (st.djScope === "selected" && !st.tracks.some((t) => st.djPool.includes(t.id))) {
        return void set(toast("「選んだ曲のみ」ですが、曲にチェックが入っていません。Library で曲にチェックしてください", "error"));
      }
      const e = getEngine();
      await e.resume();
      set({ autoDJ: true });
      const playing: DeckId | null = e.decks.A.playing ? "A" : e.decks.B.playing ? "B" : null;
      if (playing) {
        preloadCooldown = 0;
        set(toast("Auto DJ ON: 次の曲をもう一方のデッキにセットします", "success"));
        return void get().preloadNext(playing);
      }
      // Nothing is playing: start from whatever is already on a deck, otherwise pick the first track.
      const start: DeckId = e.decks.A.track ? "A" : e.decks.B.track ? "B" : "A";
      if (!e.decks[start].track) {
        const first = pickNext(start);
        if (!first) return;
        await get().loadToDeck(first.id, start, true);
      }
      const d = e.decks[start];
      const meta = d.track;
      if (meta && d.buffer) {
        const bounds = boundsOf(meta, d.buffer);
        const off = meta.beatOffset ?? 0;
        if (get().djEntry === "chorus" && meta.bpm) {
          // Start one phrase before the chorus so the first song also builds into its hook.
          const ch = nextChorus(meta);
          segChorus[start] = ch;
          const cs = ch?.[0] ?? pickEntry(d.buffer, meta.bpm, off, bounds);
          d.seek(barAtOrAfter(Math.max(bounds.soundStart, cs - (32 * 60) / meta.bpm) - 1e-3, meta.bpm, off));
        } else d.seek(entryApplies(get().djEntry, d.duration) ? pickEntry(d.buffer, meta.bpm, off, bounds) : Math.max(d.position, barAtOrAfter(bounds.soundStart, meta.bpm, off)));
      }
      newSegment(start, d.position);
      if (get().plan) {
        segCaps[start] = get().planSegmentSeconds();
        planPlays.set(meta?.id ?? "", (planPlays.get(meta?.id ?? "") ?? 0) + 1);
        set((s) => ({ plan: s.plan && { ...s.plan, played: s.plan.played + 1 } }));
      }
      get().setCrossfader(start === "A" ? 0 : 1);
      // Open the set gently: 4 bars of fade-in with the filter opening (unless the DJ turned soft start off).
      if (get().softStart) d.playFadeIn(Math.min(16, (16 * 60) / (meta?.bpm ?? 120)));
      else d.play();
      get().syncDecks();
      set(toast(`Auto DJ 開始: ${meta?.name ?? ""}${get().softStart ? " (フェードイン)" : ""}`, "success"));
      preloadCooldown = 0;
      await get().preloadNext(start);
    },

    filterFx: null,
    echo: false,
    mixing: false,
    setFilterFx: (mode) => {
      getEngine().setFilterFx(mode);
      set({ filterFx: mode });
    },
    cancelMix: () => {
      if (!mixBusy) return;
      mixCancelled = true;
      for (const t of mixTimers) clearTimeout(t);
      mixTimers.clear();
      for (const s of sleepers) {
        clearTimeout(s.t);
        s.res();
      }
      sleepers.clear();
      fadeAbort?.();
    },

    doBreak: (beats = 4) => {
      if (breaking) return;
      breaking = true;
      const e = getEngine();
      const { decks, crossfader } = get();
      const ms = Math.max(800, ((beats * 60) / currentBpm(decks, crossfader)) * 1000);
      const vols = { A: e.decks.A.volume, B: e.decks.B.volume };
      e.decks.A.setVolume(0);
      e.decks.B.setVolume(0);
      featureBus.triggerFx({ fx: "build", hue: get().vj.hue });
      setTimeout(() => get().pressPad(12), Math.max(0, ms - 2200));
      setTimeout(() => {
        e.decks.A.setVolume(vols.A);
        e.decks.B.setVolume(vols.B);
        featureBus.triggerFx({ fx: "drop", hue: get().vj.hue, text: "DROP!" });
        breaking = false;
      }, ms);
    },

    mixBeats: 32,
    setMixBeats: (mixBeats) => setPref("mixBeats", mixBeats),

    nudgeSetTempo: (pct) => {
      const e = getEngine();
      const { decks, crossfader } = get();
      const playing = (["A", "B"] as const).filter((id) => decks[id].playing);
      const master: DeckId = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
      if (pct === "reset") {
        for (const id of ["A", "B"] as const) e.decks[id].setRate(1);
        get().syncDecks();
        return void set(toast("テンポを曲の元の速さに戻しました"));
      }
      const factor = 1 + pct / 100;
      for (const id of ["A", "B"] as const) if (e.decks[id].track) e.decks[id].setRate(Math.min(1.5, Math.max(0.5, e.decks[id].rate * factor)));
      get().syncDecks();
      const m = e.decks[master];
      const bpm = m.track?.bpm ? (m.track.bpm * m.rate).toFixed(1) : null;
      set(toast(`セットのテンポ ${pct > 0 ? "+" : ""}${pct}%${bpm ? ` → ${bpm} BPM` : ""} (次の曲もこのテンポに合わせます)`));
    },
    setKeylock: (deck, on) => {
      getEngine().decks[deck].setKeylock(on);
      get().syncDecks();
    },

    beatRepeat: null,
    setBeatRepeat: (beats) => {
      const e = getEngine();
      const { decks, crossfader } = get();
      const bpm = currentBpm(decks, crossfader);
      // Capture from the next beat line so the stutter is musical, but never wait more than one beat.
      const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
      let wait = 0;
      if (beats != null && playing.length) {
        const id = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
        const d = e.decks[id];
        const tb = d.track!.bpm!;
        const posBeats = ((d.position - (d.track!.beatOffset ?? 0)) * tb) / 60;
        wait = Math.max(0, ((Math.ceil(posBeats - 0.05) - posBeats) * 60) / tb / d.rate);
        if (wait > 0.25) wait = 0; // too far: start right away
      }
      e.beatRepeat(beats, bpm, e.ctx.currentTime + wait);
      set({ beatRepeat: beats });
      if (beats != null) featureBus.triggerFx({ fx: "glitch", hue: get().vj.hue });
    },

    playlists: [],
    savePlaylist: async (name, trackIds) => {
      const pl: Playlist = { id: uid(), name: name.trim() || `セット ${get().playlists.length + 1}`, trackIds, createdAt: Date.now() };
      const playlists = [pl, ...get().playlists];
      set({ playlists, ...toast(`プレイリスト「${pl.name}」を保存しました (${trackIds.length} 曲)`, "success") });
      await db.setSetting("playlists", playlists);
    },
    deletePlaylist: async (id) => {
      const before = get().playlists;
      const pl = before.find((p) => p.id === id);
      const playlists = before.filter((p) => p.id !== id);
      set({
        playlists,
        ...toast(`プレイリスト「${pl?.name ?? ""}」を削除しました`, "info", {
          label: "元に戻す",
          onClick: () => {
            set({ playlists: before, ...toast("元に戻しました", "success") });
            void db.setSetting("playlists", before);
          },
        }),
      });
      await db.setSetting("playlists", playlists);
    },
    renamePlaylist: async (id, name) => {
      const playlists = get().playlists.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
      set({ playlists });
      await db.setSetting("playlists", playlists);
    },
    applyPlaylist: (id) => {
      const pl = get().playlists.find((p) => p.id === id);
      if (!pl) return;
      const have = new Set(get().tracks.map((t) => t.id));
      const ids = pl.trackIds.filter((x) => have.has(x));
      setPref("djPool", ids);
      setPref("djScope", "selected", toast(`「${pl.name}」を選曲対象にしました (${ids.length} 曲${ids.length < pl.trackIds.length ? "、削除済みの曲は除外" : ""})`, "success"));
    },

    buildDrop: (bars = 8) => {
      if (breaking) return;
      if (!get().decks.A.playing && !get().decks.B.playing && !getEngine().sequencer.playing) return void set(toast("再生中の音がありません (デッキかドラムマシンを鳴らしてから)", "error"));
      const e = getEngine();
      const { decks, crossfader } = get();
      const id: DeckId = decks.A.playing && decks.B.playing ? (crossfader < 0.5 ? "A" : "B") : decks.A.playing ? "A" : decks.B.playing ? "B" : "A";
      const d = e.decks[id];
      const bpm = d.track?.bpm ? d.track.bpm * d.rate : currentBpm(decks, crossfader);
      const beat = 60 / bpm;
      // Land the drop on the next bar line that is at least `bars` bars away.
      let T = beat * 4 * bars;
      if (d.playing && d.track?.bpm) {
        const off = d.track.beatOffset ?? 0;
        const posBeats = ((d.position - off) * d.track.bpm) / 60;
        const toBar = ((Math.ceil(posBeats / 4 - 0.02) * 4 - posBeats) * 60) / d.track.bpm / d.rate;
        T = toBar + beat * 4 * bars;
      }
      breaking = true;
      const ms = T * 1000;
      const hue = get().vj.hue;
      set(toast(`BUILD & DROP: ${bars} 小節後にドロップ`));
      featureBus.triggerFx({ fx: "build", hue });
      // Master HPF closes in over the build, snare roll + riser come in for the last 2 bars, then everything opens on the drop.
      const f = e.setFilterFx.bind(e);
      f("hpf");
      const t0 = performance.now();
      const timer = setInterval(() => {
        const p = Math.min(1, (performance.now() - t0) / ms);
        if (p >= 1) clearInterval(timer);
      }, 100);
      const pads = get().pads;
      const fire = (name: string, atMs: number) => {
        const pad = pads.find((x) => x.name === name && x.sampleId);
        if (pad) setTimeout(() => get().pressPad(pad.index, true), Math.max(0, atMs));
      };
      fire(bars >= 4 ? "Build 4 bars" : "Build 2 bars", ms - beat * 4000 * (bars >= 4 ? 4 : 2));
      fire("Riser", ms - 2200);
      fire("Snare Fill", ms - beat * 4000);
      setTimeout(() => {
        f(null);
        fire("Drop Impact", 0);
        fire("Crash", 0);
        featureBus.triggerFx({ fx: "drop", hue, text: "DROP!" });
        setTimeout(() => featureBus.triggerFx({ fx: "confetti", hue }), 150);
        breaking = false;
      }, ms);
    },

    echoThrow: () => {
      // Open the master echo send for one beat and close it: the last word / hit repeats and fades (the classic "throw").
      const e = getEngine();
      const bpm = currentBpm(get().decks, get().crossfader) ?? 120;
      e.setFx("echo", Math.max(0.8, get().fxDepth), bpm);
      setTimeout(() => {
        if (!get().fx.echo) e.setFx("echo", 0, bpm);
      }, (60 / bpm) * 1000);
      featureBus.triggerFx({ fx: "shock", hue: get().vj.hue });
      set(toast("ECHO THROW"));
    },
    gateDivision: null,
    gateHold: (division) => {
      const e = getEngine();
      const bpm = currentBpm(get().decks, get().crossfader) ?? 120;
      set({ gateDivision: division });
      if (division == null) return e.gate(null);
      // Start on the next beat so the chops sit on the grid; re-arm every 2 bars while held.
      const wait = quantizeDelay("beat", get().decks, get().crossfader);
      const arm = () => {
        if (get().gateDivision !== division) return;
        e.gate(division, bpm);
        const t = setTimeout(arm, (8 * 60) / bpm * 1000);
        mixTimers.add(t);
      };
      setTimeout(arm, wait * 1000);
      featureBus.triggerFx({ fx: "glitch", hue: get().vj.hue });
    },
    filterRise: (bars = 4) => {
      const e = getEngine();
      const bpm = currentBpm(get().decks, get().crossfader) ?? 120;
      if (!get().decks.A.playing && !get().decks.B.playing) return void set(toast("再生中のデッキがありません", "error"));
      const wait = quantizeDelay("bar", get().decks, get().crossfader);
      setTimeout(() => {
        e.filterRise(bars, bpm);
        featureBus.triggerFx({ fx: "build", hue: get().vj.hue });
        setTimeout(() => featureBus.triggerFx({ fx: "flash", hue: get().vj.hue }), (bars * 240) / bpm * 1000);
      }, wait * 1000);
      set(toast(`FILTER RISE ${bars} 小節: 次の小節頭から`));
    },
    crowd: () => {
      const pads = get().pads;
      const fire = (name: string, atMs = 0) => {
        const pad = pads.find((x) => x.name === name && x.sampleId);
        if (pad) setTimeout(() => get().pressPad(pad.index, true), atMs);
      };
      fire("Air Horn", 0);
      fire("Crowd Cheer", 150);
      fire("Whistle", 900);
      const hue = get().vj.hue;
      featureBus.triggerFx({ fx: "text", hue, text: "MAKE SOME NOISE!" });
      setTimeout(() => featureBus.triggerFx({ fx: "confetti", hue }), 300);
      setTimeout(() => featureBus.triggerFx({ fx: "emoji", hue, text: "🙌🔥🎉" }), 700);
    },

    fadeOut: () => {
      if (mixBusy) return;
      if (!get().decks.A.playing && !get().decks.B.playing) return void set(toast("再生中のデッキがありません", "error"));
      const e = getEngine();
      const { decks, crossfader, mixBeats } = get();
      const id: DeckId = decks.A.playing && decks.B.playing ? (crossfader < 0.5 ? "A" : "B") : decks.A.playing ? "A" : "B";
      const d = e.decks[id];
      if (!d.playing) return;
      mixBusy = true;
      mixCancelled = false;
      const v0 = d.volume;
      const ms = Math.min(40000, Math.max(3000, ((mixBeats * 60) / currentBpm(decks, crossfader)) * 1000));
      set({ ...toast(`FADE OUT ${id}`), mixing: true });
      const start = performance.now();
      const finish = (stop: boolean) => {
        clearInterval(timer);
        fadeAbort = null;
        if (stop) d.stop();
        d.setVolume(v0);
        d.setFilter(0);
        mixBusy = false;
        set({ mixing: false });
        get().syncDecks();
      };
      fadeAbort = () => {
        finish(false);
        set(toast("フェードアウトを中止しました"));
      };
      const timer = setInterval(() => {
        const p = Math.min(1, (performance.now() - start) / ms);
        d.setVolume(v0 * (1 - p) ** 1.5);
        d.setFilter(-0.8 * p);
        if (p >= 1) finish(true);
      }, 40);
    },

    autoMix: async (opts) => {
      if (mixBusy) return;
      if (!opts?.auto && !get().decks.A.playing && !get().decks.B.playing) {
        return void set(toast("再生中のデッキがありません。曲を再生してから繋いでください (自動で始めるなら Auto DJ)", "error"));
      }
      mixBusy = true;
      mixCancelled = false;
      set({ mixing: true });
      const sleep = (ms: number) =>
        new Promise<void>((res) => {
          if (mixCancelled) return res();
          const entry = { t: setTimeout(() => (sleepers.delete(entry), res()), ms), res };
          sleepers.add(entry);
        });
      /** setTimeout that a cancelled transition can drop. */
      const later = (fn: () => void, ms: number) => {
        const t = setTimeout(() => (mixTimers.delete(t), fn()), Math.max(0, ms));
        mixTimers.add(t);
      };
      const run = (msIn: number, fn: (p: number) => void) =>
        new Promise<void>((resolve) => {
          // A non-finite / tiny duration would loop forever (p never reaches 1) - clamp it.
          const ms = Number.isFinite(msIn) && msIn > 50 ? msIn : 2000;
          const t0 = performance.now();
          const timer = setInterval(() => {
            if (mixCancelled) {
              clearInterval(timer);
              return resolve();
            }
            const p = Math.min(1, (performance.now() - t0) / ms);
            fn(p);
            if (p >= 1) {
              clearInterval(timer);
              resolve();
            }
          }, 40);
        });
      try {
        const e = getEngine();
        const { crossfader } = get();
        let mixBeats = opts?.beats ?? get().mixBeats;
        let decks = get().decks;
        let style: MixStyle = opts?.style ?? "blend";
        const from: DeckId = decks.A.playing && decks.B.playing ? (crossfader < 0.5 ? "A" : "B") : decks.A.playing ? "A" : decks.B.playing ? "B" : crossfader < 0.5 ? "A" : "B";
        const to: DeckId = from === "A" ? "B" : "A";
        if (!decks[to].track || opts?.loadNext) {
          const next = pickNext(from);
          if (!next) return void set(toast("ミックス先の曲がありません。ライブラリに曲を追加してください", "error"));
          await get().loadToDeck(next.id, to, true);
          decks = get().decks;
        }
        const ft = decks[from].track;
        const tt = decks[to].track;
        if (!tt) return;
        const src = e.decks[from];
        const dst = e.decks[to];
        const rate0 = src.rate;

        // Tempo ramp: bend the playing track over 8 bars until its tempo equals the incoming track's natural tempo
        // (key lock keeps the pitch), then continue as a normal beat-matched blend.
        if (style === "ramp" && !(ft?.bpm && tt.bpm && (get().mixOut[from] ?? src.duration) - src.position > ((32 * 60) / (ft.bpm * src.rate)) * 1.5 + 4)) {
          style = "fade"; // not enough of the outgoing track left for a ramp
        }
        if (style === "ramp" && ft?.bpm && tt.bpm) {
          let target = tt.bpm / ft.bpm;
          if (target > 1.45) target /= 2;
          else if (target < 0.69) target *= 2;
          target = Math.max(0.7, Math.min(1.3, target));
          const r0 = src.rate;
          const rampMs = ((32 * 60) / (ft.bpm * r0)) * 1000;
          set(toast(`TEMPO RAMP ${from}: ${(ft.bpm * r0).toFixed(1)} → ${(ft.bpm * target).toFixed(1)} BPM (8 小節)`));
          await run(rampMs, (p) => {
            const k = p * p * (3 - 2 * p); // smoothstep: gentle start / end
            src.setRate(r0 + (target - r0) * k);
          });
          style = "blend"; // (if cancelled meanwhile, the steps below fall through to the cancel clean-up)
        }
        // Tempo: match the incoming track to the outgoing one (folding half / double time) within a safe range.
        if (ft?.bpm && tt.bpm) {
          let ratio = (ft.bpm * src.rate) / tt.bpm;
          if (ratio > 1.45) ratio /= 2;
          else if (ratio < 0.69) ratio *= 2;
          // With key lock the pitch stays put, so a wider tempo window is fine; without it keep the bend subtle.
          // Too far apart: play the new track at its own tempo (grid-free transitions take over, see chooseStyle).
          dst.setRate(Math.abs(ratio - 1) <= tempoTolerance(dst.keylock, src.rate) ? ratio : 1);
        }
        // Harmonic mixing: if the keys clash and key lock is on, nudge the incoming track ±1-2 semitones so the
        // two sit in compatible Camelot positions (what a DJ does with the key-shift buttons).
        dst.setKeyShift(0);
        if (get().harmonicShift && dst.keylock && ft && tt.keyRoot != null && ft.keyRoot != null) {
          const shift = keyShiftToMatch(ft, tt);
          if (shift) dst.setKeyShift(shift);
        }
        // Start the incoming track on its first beat (or its cue point, snapped to the grid).
        const off = tt.beatOffset ?? 0;
        const bounds = dst.buffer ? boundsOf(tt, dst.buffer) : { soundStart: 0, soundEnd: dst.duration };
        // Never start in leading silence; snap to the grid (bar line when we align on bars).
        let startPos = Math.max(dst.cuePoint, off, bounds.soundStart);
        if (tt.bpm) startPos = unitFor(style, opts?.align) === 4 ? barAtOrAfter(startPos, tt.bpm, off) : off + Math.round(((startPos - off) * tt.bpm) / 60) * (60 / tt.bpm);
        // Auto DJ: come in so that a high-energy section (the hook) starts exactly when the blend completes -
        // the pre-hook bars play under the crossfade, the way a DJ lines up the incoming drop with the phrase.
        const overlapBeatsFor = style === "blend" || style === "filter" || style === "fade" ? mixBeats : 0;
        // Double drop / break cut: the incoming hook (drop) lands exactly on the first bar line of the transition.
        if (opts?.auto && dst.buffer && entryApplies(get().djEntry, dst.duration)) {
          const hook = pickEntry(dst.buffer, tt.bpm, off, bounds);
          startPos = tt.bpm ? barAtOrAfter(Math.max(bounds.soundStart, hook - (overlapBeatsFor * 60) / tt.bpm) - 1e-3, tt.bpm, off) : hook;
        }
        // Chorus mode: the hook must land on the bar where the outgoing chorus ends, so start the overlap's length
        // before the chorus (the pre-chorus bars play under the crossfade) - or on the chorus itself for hard cuts.
        segChorus[to] = null;
        if (opts?.auto && tt.bpm && (get().djEntry === "chorus" || (get().plan && tt.duration > 360 && chorusesOf(tt).length > 1))) {
          const ch = nextChorus(tt);
          if (ch) {
            segChorus[to] = ch;
            startPos = Math.max(bounds.soundStart, ch[0] - (overlapBeatsFor * 60) / tt.bpm);
            startPos = barAtOrAfter(startPos - 1e-3, tt.bpm, off);
          }
        }
        // Classic mix-in from the top of the track: blend over the intro and be out before the vocal / drop.
        if (tt.bpm && tt.introBars && startPos <= bounds.soundStart + (240 / tt.bpm) * 1.5 && (style === "blend" || style === "filter" || style === "fade")) {
          const introBeats = tt.introBars * 4;
          if (introBeats < mixBeats) {
            mixBeats = Math.max(8, introBeats);
            set(toast(`イントロ ${tt.introBars} 小節に合わせて ${mixBeats} 拍でブレンド`));
          }
        }
        dst.seek(startPos);
        newSegment(to, startPos);
        if (get().plan) {
          segCaps[to] = get().planSegmentSeconds();
          set((s) => ({ plan: s.plan && { ...s.plan, played: s.plan.played + 1 } }));
        }

        const xSrc = from === "A" ? 0 : 1;
        const x1 = to === "B" ? 1 : 0;
        get().setCrossfader(xSrc);

        // Seconds until the outgoing deck reaches its next beat / bar line; landing there keeps the kicks together.
        const srcBpm = (ft?.bpm ?? 0) * src.rate;
        const beatSec = srcBpm ? 60 / srcBpm : 0.5;
        const wait = (unitBeats: number) => {
          if (!src.playing || !ft?.bpm) return 0;
          const posBeats = ((src.position - (ft.beatOffset ?? 0)) * ft.bpm) / 60;
          const next = Math.ceil(posBeats / unitBeats - 0.02) * unitBeats;
          let d = ((next - posBeats) * 60) / ft.bpm / src.rate;
          if (d < 0.1) d += (unitBeats * 60) / ft.bpm / src.rate;
          return d;
        };
        const unit = unitFor(style, opts?.align);
        let T = wait(unit);
        if (style === "drop") while (T < 4 && src.playing) T += beatSec * 4;
        if (style === "spin") T = 0.9;
        if (style === "roll") while (T < beatSec * 2 && src.playing) T += beatSec * 4; // need two beats to roll in
        const hue = get().vj.hue;
        const NAMES: Record<MixStyle, string> = { blend: "BLEND", filter: "FILTER SWAP", drop: "DROP SWAP", spin: "SPINBACK", echo: "ECHO OUT", reverb: "REVERB OUT", cut: "CUT", roll: "LOOP ROLL", fade: "FADE", doubledrop: "DOUBLE DROP", breakcut: "BREAK CUT", ramp: "TEMPO RAMP → BLEND" };
        set({ ...toast(`${NAMES[style]} ${from} → ${to}${tt.name ? `  ▸ ${tt.name}` : ""}${dst.keyShift ? ` (key ${dst.keyShift > 0 ? "+" : ""}${dst.keyShift})` : ""}`), plannedStyle: null });
        featureBus.triggerFx({ fx: style === "spin" ? "glitch" : "build", hue });
        const at = e.ctx.currentTime + T;
        const barMs = beatSec * 4000;

        if (style === "blend" || style === "filter" || style === "fade") {
          dst.setEQ("low", style === "blend" ? -24 : 0);
          if (style === "filter") dst.setFilter(0.95);
          if (style === "fade") dst.setVolume(0);
          dst.play(at);
          get().syncDecks();
          if (style === "blend") hit("Reverse Crash", T * 1000 - 2000);
          await sleep(T * 1000);
          const target = get().mixOut[from] ?? decks[from].duration;
          const remainMs = ((target - src.position) / src.rate) * 1000;
          const ms = Math.min(mixMs(style, mixBeats, srcBpm || 120), Math.max(2000, remainMs));
          if (style === "filter") hit("Sweep Up");
          const matched = !!(ft?.bpm && tt.bpm) && Math.abs(dst.rate * tt.bpm - srcBpm) < 0.5;
          const v0 = src.volume;
          let lastNudge = 0;
          let lastMeasure = 0;
          let phaseBias = 0;
          // Tempo link: if the DJ moves either pitch fader during the blend, the other deck follows so the two
          // stay beat-matched (the deck that was touched is the master).
          let srcRateSeen = src.rate;
          let dstRateSeen = dst.rate;
          // Vocal clash: both tracks sing during the overlap -> keep the incoming vocal band down until the swap and
          // duck the outgoing mids from the swap on, so only one voice is forward at a time.
          const outVocal = vocalBetween(ft?.vocalMap, ft?.bpm, ft?.beatOffset, src.position, src.position + (ms / 1000) * src.rate);
          const inVocal = vocalBetween(tt.vocalMap, tt.bpm, tt.beatOffset, dst.position, dst.position + (ms / 1000) * dst.rate);
          const vocalClash = style === "blend" && outVocal > 0.55 && inVocal > 0.55;
          if (vocalClash) set(toast(`両方ボーカル区間: 入る曲の中域を抑えて繋ぎます`, "info"));
          // Bass swap happens on a bar line halfway through (bars are counted from the start of the blend).
          const barsTotal = Math.max(1, Math.round(ms / barMs));
          const swapP = barsTotal <= 1 ? 0.5 : Math.max(1, Math.round(barsTotal / 2)) / barsTotal;
          const swapWidth = Math.min(0.25, barMs / 4 / ms); // one beat
          if (style === "blend") {
            dst.setEQ("high", -8);
            if (vocalClash) dst.setEQ("mid", -10);
          }
          await run(ms, (p) => {
            if (style === "blend") {
              // Crossfader eases the mids/highs in; the lows are exchanged quickly on the swap bar; the incoming
              // highs open over the first half; the outgoing mids duck a little at the end so vocals do not fight.
              const xf = p < swapP ? p * 0.5 / swapP : 0.5 + ((p - swapP) / (1 - swapP)) * 0.5;
              get().setCrossfader(xSrc + (x1 - xSrc) * xf);
              const sw = Math.min(1, Math.max(0, (p - swapP) / swapWidth));
              src.setEQ("low", -24 * sw);
              dst.setEQ("low", -24 * (1 - sw));
              dst.setEQ("high", -8 * (1 - Math.min(1, p / swapP)));
              if (vocalClash) {
                // incoming mids stay down until the swap, then open while the outgoing mids go away
                dst.setEQ("mid", -10 * (1 - sw));
                src.setEQ("mid", -10 * sw);
              } else src.setEQ("mid", p > 0.75 ? -6 * ((p - 0.75) / 0.25) : 0);
            } else get().setCrossfader(xSrc + (x1 - xSrc) * p);
            if (style === "filter") {
              src.setFilter(-0.95 * p);
              dst.setFilter(0.95 * (1 - Math.min(1, p / 0.7)));
            } else {
              // fade: smooth equal-power volume swap, outgoing darkens a little so the two do not fight
              dst.setVolume(Math.sin((p * Math.PI) / 2));
              src.setVolume(v0 * Math.cos((p * Math.PI) / 2));
              src.setFilter(-0.4 * p);
            }
            if (matched) {
              if (Math.abs(src.rate - srcRateSeen) > 1e-4) {
                dst.setRate(dst.rate * (src.rate / srcRateSeen));
                dstRateSeen = dst.rate;
              } else if (Math.abs(dst.rate - dstRateSeen) > 1e-4) {
                src.setRate(src.rate * (dst.rate / dstRateSeen));
                srcRateSeen = src.rate;
              }
              srcRateSeen = src.rate;
              dstRateSeen = dst.rate;
            }
            // Drift correction: BPM analysis is only ~0.1 BPM accurate, so re-align the kicks every half second
            // with a tiny tempo nudge on the incoming deck (inaudible with key lock, < 1% without).
            const now = performance.now();
            if (matched && now - lastNudge > 500 && src.playing && dst.playing) {
              lastNudge = now;
              const pa = src.beatPhase;
              const pb = dst.beatPhase;
              // Measured correction: the beat grids are estimates (~10-30 ms off), so every ~6 s compare the real
              // kick envelopes of both decks and bias the grid-based phase loop toward the measured alignment.
              if (pa != null && pb != null && src.buffer && dst.buffer && now - lastMeasure > 6000 && ft?.bpm) {
                lastMeasure = now;
                const m = measureKickLag(kickEnvelope(src.buffer.getChannelData(0), src.buffer.sampleRate, src.position, src.rate), kickEnvelope(dst.buffer.getChannelData(0), dst.buffer.sampleRate, dst.position, dst.rate));
                if (m.confidence > 2) {
                  const beat = 60 / (ft.bpm * src.rate);
                  let g = pa - pb;
                  if (g > 0.5) g -= 1;
                  if (g < -0.5) g += 1;
                  let b = m.lag / beat - g;
                  b -= Math.round(b);
                  phaseBias = Math.abs(b) < 0.2 ? b : phaseBias; // ignore wild readings (wrong beat locked)
                }
              }
              if (pa != null && pb != null) {
                let diff = pa - pb + phaseBias;
                if (diff > 0.5) diff -= 1;
                if (diff < -0.5) diff += 1;
                dst.bend(1 + Math.max(-0.01, Math.min(0.01, diff * 0.06)));
              }
            }
          });
          dst.bend(1);
          if (style === "blend") {
            dst.setEQ("high", 0);
            dst.setEQ("mid", 0);
            src.setEQ("mid", 0);
          }
          if (style === "fade") {
            dst.setVolume(1);
            src.setVolume(v0);
          }
        } else if (style === "breakcut") {
          // Breakdown cut: the outgoing track is already quiet (break), so pull its lows and highs out over one bar
          // and let the incoming drop hit on the bar line - the classic EDM "break into drop".
          dst.play(at);
          later(() => get().setCrossfader(x1), T * 1000 - 30);
          hit("Riser", T * 1000 - 2200);
          await run(T * 1000, (p) => {
            src.setEQ("low", -18 * p);
            src.setFilter(0.6 * p);
          });
          if (!mixCancelled) {
            hit("Drop Impact");
            featureBus.triggerFx({ fx: "drop", hue, text: "DROP!" });
          }
          await sleep(60);
          src.setEQ("low", 0);
          src.setFilter(0);
        } else if (style === "doubledrop") {
          // Double drop: the incoming hook is cued so it lands on the same bar as the outgoing drop; both play full
          // (incoming bass in) for 8 bars, then the outgoing is pulled out with a bass cut + 2-bar fade.
          dst.setEQ("low", -24);
          dst.play(at);
          const eightBars = barMs * 8;
          later(() => {
            dst.setEQ("low", 0);
            get().setCrossfader(0.5);
            if (!mixCancelled) {
              hit("Drop Impact");
              featureBus.triggerFx({ fx: "drop", hue, text: "DOUBLE DROP!" });
            }
          }, T * 1000 - 20);
          hit("Snare Roll", T * 1000 - 2600);
          await sleep(T * 1000 + eightBars);
          await run(barMs * 2, (p) => {
            src.setEQ("low", -24 * Math.min(1, p * 3));
            get().setCrossfader(0.5 + (x1 - 0.5) * p);
          });
        } else if (style === "drop") {
          // Filter the old track down through a build, then cut to the new one exactly on the bar line.
          hit("Riser", T * 1000 - 2200);
          hit("Snare Roll", T * 1000 - 2600);
          dst.play(at);
          later(() => get().setCrossfader(x1), T * 1000 - 60);
          await run(T * 1000, (p) => src.setFilter(0.95 * p * p));
          if (!mixCancelled) {
            hit("Drop Impact");
            featureBus.triggerFx({ fx: "drop", hue, text: "DROP!" });
          }
          await sleep(60);
        } else if (style === "echo") {
          // Throw the outgoing track into the echo, then hard-cut to the new one on the next bar.
          const bpm = srcBpm || 120;
          const depth = Math.max(0.7, get().fxDepth);
          later(() => e.setFx("echo", depth, bpm), T * 1000 - barMs / 2);
          dst.play(at);
          later(() => {
            get().setCrossfader(x1);
            e.setFx("echo", 0, bpm);
          }, T * 1000 - 20);
          hit("Rev Snare", T * 1000 - beatSec * 1000);
          await sleep(T * 1000 + 80);
          if (!mixCancelled) featureBus.triggerFx({ fx: "shock", hue });
          await sleep(barMs); // let the tail ring before the old deck is stopped
        } else if (style === "reverb") {
          // Wash the outgoing track into the reverb, cut to the new one on the bar line; the tail keeps ringing.
          const depth = Math.max(0.8, get().fxDepth);
          later(() => e.setFx("reverb", depth), T * 1000 - barMs / 2);
          dst.play(at);
          later(() => {
            get().setCrossfader(x1);
            e.setFx("reverb", 0);
          }, T * 1000 - 20);
          hit("Sweep Up", T * 1000 - barMs * 2);
          await sleep(T * 1000 + 80);
          if (!mixCancelled) featureBus.triggerFx({ fx: "shock", hue });
        } else if (style === "cut") {
          // Hard cut on the bar line with a crash.
          dst.play(at);
          later(() => get().setCrossfader(x1), T * 1000 - 20);
          hit("Crash", T * 1000 - 10);
          await sleep(T * 1000 + 100);
          if (!mixCancelled) featureBus.triggerFx({ fx: "flash", hue });
        } else if (style === "roll") {
          // Loop roll: the outgoing track stutters 1 beat -> 1/2 -> 1/4 -> 1/8 into the bar line, then cuts to the new one.
          const bpmN = ft?.bpm ?? 0;
          const roll = (beats: number, atMs: number) => later(() => src.setBeatLoop(beats, bpmN || null), atMs);
          roll(1, T * 1000 - beatSec * 2000);
          roll(0.5, T * 1000 - beatSec * 1000);
          roll(0.25, T * 1000 - beatSec * 500);
          roll(0.125, T * 1000 - beatSec * 250);
          dst.play(at);
          later(() => {
            get().setCrossfader(x1);
            src.clearLoop();
          }, T * 1000 - 15);
          hit("Snare Fill", T * 1000 - beatSec * 1000);
          await sleep(T * 1000 + 80);
          if (!mixCancelled) featureBus.triggerFx({ fx: "shock", hue });
        } else {
          // spin: drag the old track to a stop, then start the new one
          hit("Rewind");
          dst.play(at);
          await run(T * 1000, (p) => src.setRate(Math.max(0.05, rate0 * (1 - p) ** 2)));
          get().setCrossfader(x1);
        }

        if (mixCancelled) {
          // Aborted by the user: keep the outgoing deck as the main one and undo everything the transition touched.
          dst.stop();
          for (const d of [src, dst]) {
            d.setEQ("low", 0);
            d.setEQ("mid", 0);
            d.setEQ("high", 0);
            d.setFilter(0);
          }
          src.setRate(rate0);
          src.clearLoop();
          src.setVolume(1);
          dst.setVolume(1);
          dst.bend(1);
          e.setFx("echo", 0, srcBpm || 120);
          e.setFx("reverb", 0);
          get().setCrossfader(xSrc);
          set(toast("ミックスを中止しました"));
          get().syncDecks();
          return;
        }
        spentTracks[from] = ft?.id ?? null;
        src.stop();
        src.setEQ("low", 0);
        dst.setEQ("low", 0);
        src.setFilter(0);
        dst.setFilter(0);
        src.setRate(rate0);
        get().setCrossfader(x1);
        if (style !== "drop") featureBus.triggerFx({ fx: "confetti", hue });
        get().syncDecks();
      } finally {
        mixBusy = false;
        mixCancelled = false;
        mixTimers.clear();
        set({ mixing: false });
      }
    },

    setToast: (m, kind = "info", action = null) => set({ toast: m, toastKind: kind, toastAction: action }),

    rememberRemoved,
    deleteDefaults: (kind) => {
      if (kind === "samples") {
        const ids = get().samples.filter((x) => isDefaultSample(x.name)).map((x) => x.id);
        if (!ids.length) return void set(toast("内蔵サンプルはありません"));
        void get().deleteSamples(ids);
      } else {
        const t = get().tracks.filter((x) => isDefaultTrack(x.name));
        if (!t.length) return void set(toast("デモ曲はありません"));
        for (const x of t) void get().deleteTrack(x.id);
      }
    },
    seedDefaults: async (restore) => {
      if (get().seeding) return;
      if (restore) {
        removedDefaults.clear();
        persistRemoved();
      }
      set({ seeding: true });
      const engine = getEngine();
      try {
        // --- sampler kit ---
        const existing = new Set(get().samples.map((s) => s.name));
        const padsFree = () => get().pads.filter((p) => !p.sampleId).map((p) => p.index);
        for (let i = 0; i < DEFAULT_SAMPLES.length; i++) {
          const def = DEFAULT_SAMPLES[i];
          set(toast(`サンプル生成中… (${i + 1}/${DEFAULT_SAMPLES.length}) ${def.name}`, "progress"));
          let id = get().samples.find((s) => s.name === def.name)?.id;
          if (removedDefaults.has(def.name)) continue;
          if (!existing.has(def.name)) {
            const buffer = await renderSample(def);
            id = uid();
            engine.cache(id, buffer);
            const blob = audioBufferToWav(buffer);
            const sample: SampleMeta = { id, name: def.name, duration: buffer.duration, size: blob.size, createdAt: Date.now() };
            await db.putSample({ ...sample, blob });
            set((s) => ({ samples: [sample, ...s.samples] }));
          }
          // Place on its designated pad if that pad is still empty (or on any free pad otherwise).
          if (id && !get().pads.some((p) => p.sampleId === id)) {
            const free = padsFree();
            const target = def.pad != null && free.includes(def.pad) ? def.pad : free.find((i) => i >= PADS_PER_BANK) ?? free[0];
            if (target != null) {
              await get().assignSample(target, id);
              await get().updatePad(target, {
                mode: def.mode ?? "oneshot",
                choke: def.choke ?? 0,
                color: def.color ?? get().pads[target].color,
                fx: def.fx,
                fxText: def.fxText,
                loopBpm: def.loopBpm,
              });
            }
          } else if (id && def.fx) {
            // Pads from an older kit version: attach the visual effect without touching user edits.
            for (const p of get().pads) if (p.sampleId === id && p.fx === undefined) await get().updatePad(p.index, { fx: def.fx, fxText: def.fxText });
          }
        }
        // --- catchphrase (speech) pads ---
        for (const sp of SPEECH_PADS) {
          const pad = get().pads[sp.pad];
          if (removedDefaults.has(`pad:${sp.pad}`)) continue;
          if (!pad.sampleId && !pad.speech) await get().updatePad(sp.pad, { name: sp.name, speech: sp.text, color: sp.color, fx: "text", fxText: sp.fxText });
        }
        // --- demo tracks ---
        const trackNames = new Set(get().tracks.map((t) => t.name));
        for (let i = 0; i < DEMO_SONGS.length; i++) {
          const song = DEMO_SONGS[i];
          if (trackNames.has(song.name) || removedDefaults.has(song.name)) continue;
          set(toast(`デモ曲を生成中… (${i + 1}/${DEMO_SONGS.length}) ${song.name}`, "progress"));
          const buffer = await renderSong(song);
          const id = uid();
          engine.cache(id, buffer);
          const blob = audioBufferToWav(buffer);
          const track: TrackMeta = { id, name: song.name, duration: buffer.duration, bpm: song.bpm, beatOffset: 0, size: blob.size, createdAt: Date.now() };
          await db.putTrack({ ...track, blob });
          set((s) => ({ tracks: [track, ...s.tracks] }));
        }
        await db.setSetting("seeded", true);
        await db.setSetting("kitVersion", KIT_VERSION);
        set(toast("デフォルト音源の準備ができました", "success"));
        void get().refreshStorage();
      } catch (e) {
        console.error(e);
        set(toast("デフォルト音源の生成に失敗しました", "error"));
      } finally {
        set({ seeding: false });
      }
    },

    sessionAvailable: null,
    liveView: false,
    saveSession: () => {
      const s = get();
      if (!s.ready) return;
      const anyLoaded = s.decks.A.track || s.decks.B.track;
      if (!anyLoaded) return;
      const snap: SessionSnapshot = {
        at: Date.now(),
        decks: {
          A: { trackId: s.decks.A.track?.id ?? null, position: s.decks.A.position, playing: s.decks.A.playing, rate: s.decks.A.rate, keyShift: s.decks.A.keyShift },
          B: { trackId: s.decks.B.track?.id ?? null, position: s.decks.B.position, playing: s.decks.B.playing, rate: s.decks.B.rate, keyShift: s.decks.B.keyShift },
        },
        crossfader: s.crossfader,
        autoDJ: s.autoDJ,
        autoFollow: s.autoFollow,
        plan: s.plan,
        mode: s.mode,
      };
      try {
        localStorage.setItem("session", JSON.stringify(snap));
      } catch {}
    },
    restoreSession: async () => {
      const snap = get().sessionAvailable;
      if (!snap) return;
      set({ sessionAvailable: null, ...toast("前回の続きから復元しています…", "progress") });
      const e = getEngine();
      await e.resume();
      for (const id of ["A", "B"] as const) {
        const d = snap.decks[id];
        if (!d.trackId || !get().tracks.some((t) => t.id === d.trackId)) continue;
        const ok = await get().loadToDeck(d.trackId, id, true);
        if (!ok) continue;
        const deck = e.decks[id];
        deck.setRate(d.rate || 1);
        if (d.keyShift) deck.setKeyShift(d.keyShift);
        deck.seek(Math.max(0, Math.min(deck.duration - 1, d.position)));
        newSegment(id, deck.position);
      }
      get().setCrossfader(snap.crossfader);
      // Resume playback on the deck(s) that were playing, with a short fade-in instead of a hard start.
      for (const id of ["A", "B"] as const) if (snap.decks[id].playing && e.decks[id].track) e.decks[id].playFadeIn(2);
      if (snap.mode) set({ mode: snap.mode });
      if (snap.plan) {
        // Keep the plan's remaining time: shift its start by the time the app was down.
        const down = Date.now() - snap.at;
        set({ plan: { ...snap.plan, startedAt: snap.plan.startedAt + down } });
        setPref("djSegment", "plan");
      }
      if (snap.autoFollow) set({ autoFollow: true });
      if (snap.autoDJ) set({ autoDJ: true });
      get().syncDecks();
      set(toast("前回の続きから再開しました", "success"));
    },
    init: async () => {
      set((st) => ({ cue: { ...st.cue, supported: AudioEngine.cueSupported } }));
      {
        const saved = typeof localStorage !== "undefined" ? localStorage.getItem("cueDevice") : null;
        if (saved && AudioEngine.cueSupported) void getEngine().setCueDevice(saved).then((ok) => ok && set((st) => ({ cue: { ...st.cue, deviceId: saved } })));
      }
      if (get().ready) return;
      const engine = getEngine();
      await engine.resume();
      const [tracks, samples, savedPads, vj, seeded, kitVersion, prefs, playlists, seqPatterns] = await Promise.all([
        db.listTracks(),
        db.listSamples(),
        db.listPads(),
        db.getSetting<VJSettings>("vj"),
        db.getSetting<boolean>("seeded"),
        db.getSetting<number>("kitVersion"),
        db.getSetting<Partial<Prefs>>("prefs"),
        db.getSetting<Playlist[]>("playlists"),
        db.getSetting<Pattern[]>("seqPatterns"),
      ]);
      {
        const saved = await db.getSetting<VJLook[]>("vjLooks");
        if (saved?.length) set({ looks: [...BUILTIN_LOOKS, ...saved] });
      }
      const pads = Array.from({ length: PAD_COUNT }, (_, i) => savedPads.find((p) => p.index === i) ?? defaultPad(i));
      for (let i = 0; i < pads.length; i++) {
        let p = pads[i];
        const rec = p.sampleId ? await getSampleRec(p.sampleId) : null;
        // A pad that pointed at a temporary sample from a previous session is emptied.
        if (p.sampleId && !rec) {
          p = { ...p, sampleId: null, name: p.speech ? p.name : "", start: undefined, end: undefined };
          pads[i] = p;
          void db.putPad(p);
        }
        engine.sampler.setConfig(p);
        if (rec) engine.sampler.setBuffer(p.index, await engine.decode(rec.id, rec.blob));
      }
      engine.sampler.onChange = (active) => set({ activePads: [...active] });
      engine.decks.A.onScratchEnd = engine.decks.B.onScratchEnd = () => get().syncDecks();
      engine.onPreviewEnd = () => set({ previewing: null });
      engine.deckBpm = () => {
        const { decks, crossfader } = get();
        const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
        if (!playing.length) return null;
        const id = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
        return decks[id].track!.bpm! * decks[id].rate;
      };
      if (seqPatterns?.length === 4) {
        set((s) => ({ seq: { ...s.seq, patterns: seqPatterns } }));
        engine.sequencer.pattern = seqPatterns[0];
      }
      // saveMode used to be persisted; ignore it so a leftover "temp" can never silently swallow new additions.
      const { saveMode: _legacy, ...p } = (prefs ?? {}) as Partial<Prefs> & { saveMode?: string };
      void _legacy;
      engine.setMasterVolume(p.masterVolume ?? get().masterVolume);
      engine.sampler.setVolume(p.samplerVolume ?? get().samplerVolume);
      engine.decks.A.onEnded = engine.decks.B.onEnded = () => get().syncDecks();
      const ids = new Set(tracks.map((t) => t.id));
      set({ ready: true, tracks, samples, pads, vj: { ...defaultVJ, ...vj }, ...p, djPool: (p.djPool ?? []).filter((id) => ids.has(id)), playlists: playlists ?? [] });
      // Offer to continue a session that was playing less than 30 minutes ago (reload, crash, accidental close).
      try {
        const raw = localStorage.getItem("session");
        const snap: SessionSnapshot | null = raw ? JSON.parse(raw) : null;
        const hadMusic = snap && (snap.decks.A.playing || snap.decks.B.playing || snap.plan);
        if (snap && hadMusic && Date.now() - snap.at < 30 * 60 * 1000) {
          const names = (["A", "B"] as const).map((id) => tracks.find((t) => t.id === snap.decks[id].trackId)?.name).filter(Boolean);
          set({ sessionAvailable: snap, ...toast(`前回のセッションがあります (${Math.round((Date.now() - snap.at) / 60000)} 分前: ${names.join(" / ").slice(0, 60)})`, "info", { label: "続きから再開", onClick: () => void get().restoreSession() }) });
        }
      } catch {}
      setInterval(() => get().saveSession(), 5000);
      window.addEventListener("pagehide", () => get().saveSession());
      void get().refreshStorage();
      window.addEventListener("beforeunload", (ev) => {
        if (memTracks.size + memSamples.size > 0) {
          ev.preventDefault();
          ev.returnValue = "";
        }
      });
      for (const k of (await db.getSetting<string[]>("removedDefaults")) ?? []) removedDefaults.add(k);
      // First launch: generate the built-in kit & demo tracks in the background.
      if (seeded ? kitVersion !== KIT_VERSION : tracks.length === 0 && samples.length === 0) void get().seedDefaults();
    },

    importTracks: async (files) => {
      const engine = getEngine();
      let n = 0;
      for (const file of Array.from(files)) {
        const id = uid();
        set((s) => ({ loading: { ...s.loading, [id]: true } }));
        try {
          const buffer = await engine.decode(id, file);
          const blob = storable(file, buffer);
          const temp = get().saveMode === "temp";
          const track: TrackMeta = {
            id,
            name: file.name.replace(/\.[^.]+$/, ""),
            duration: buffer.duration,
            bpm: null,
            size: blob.size,
            createdAt: Date.now(),
            ...(temp ? { temporary: true } : {}),
          };
          if (temp) memTracks.set(id, { ...track, blob });
          else {
            await db.putTrack({ ...track, blob });
            if (!persistAsked && !get().storage?.persisted) {
              persistAsked = true;
              void db.requestPersist().then(() => get().refreshStorage());
            }
          }
          set((s) => ({ tracks: [track, ...s.tracks] }));
          n++;
          analyzeKey(id, buffer, set);
          {
            const b = soundBounds(buffer);
            void patchTrack(id, { ...b, loudness: loudnessDb(buffer, b) });
            void loudnessLufs(buffer, b).then((l) => patchTrack(id, { loudness: l, loudnessV: 2 })).catch(() => {});
          }
          detectBPM(buffer).then(async (r) => {
            const patch = { bpm: r?.bpm ?? null, beatOffset: r?.beatOffset ?? 0 };
            await patchTrack(id, patch);
            idle(() => {
              const t = get().tracks.find((x) => x.id === id);
              return t ? ensureChorus(t, buffer, patchTrack) : undefined;
            });
            if (r?.bpm) idle(() => patchTrack(id, { introBars: introBars(buffer, r.bpm!, r.beatOffset ?? 0, boundsOf(get().tracks.find((x) => x.id === id) ?? track, buffer)) }));
            idle(() => ensureVocal(id, patch.bpm, patch.beatOffset, buffer, patchTrack));
          });
        } catch (err) {
          set(toast(storageErrorMessage(err, file.name), "error"));
        } finally {
          set((s) => {
            const loading = { ...s.loading };
            delete loading[id];
            return { loading };
          });
        }
      }
      if (n) {
        set(toast(get().saveMode === "temp" ? `${n} 曲を一時追加しました (リロードで消えます。「保存」で継続保存)` : `${n} 曲を追加して保存しました (BPM / キーを解析中)`, "success"));
        void get().refreshStorage();
      }
    },

    deleteTrack: async (id) => {
      // Soft delete: the row disappears now, the data goes 6 s later unless undone from the toast.
      const meta = get().tracks.find((t) => t.id === id);
      if (!meta) return;
      if (isDefaultTrack(meta.name)) rememberRemoved([meta.name]);
      const pool = get().djPool;
      set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) }));
      setPref("djPool", pool.filter((x) => x !== id));
      const timer = setTimeout(async () => {
        pendingDeletes.delete(id);
        if (memTracks.delete(id)) void 0;
        else await db.deleteTrack(id);
        getEngine().uncache(id);
        void get().refreshStorage();
      }, 6000);
      pendingDeletes.set(id, timer);
      set(
        toast(`「${meta.name}」を削除しました`, "info", {
          label: "元に戻す",
          onClick: () => {
            const t = pendingDeletes.get(id);
            if (!t) return;
            clearTimeout(t);
            pendingDeletes.delete(id);
            set((s) => ({ tracks: [meta, ...s.tracks].sort((a, b) => b.createdAt - a.createdAt), ...toast(`「${meta.name}」を元に戻しました`, "success") }));
            if (pool.includes(id)) setPref("djPool", [...get().djPool, id]);
          },
        }),
      );
    },
    renameTrack: (id, name) => patchTrack(id, { name: name.trim() || "untitled" }),
    setTrackBpm: (id, bpm) => patchTrack(id, { bpm: bpm && bpm > 0 ? Math.round(bpm * 100) / 100 : null }),
    setTrackBeatOffset: (id, beatOffset) => patchTrack(id, { beatOffset: Math.max(0, Math.round(beatOffset * 1000) / 1000) }),
    reanalyzeBpm: async (id) => {
      const rec = await getTrackRec(id);
      if (!rec) return;
      set(toast(`「${rec.name}」の BPM を解析中…`, "progress"));
      const buffer = await getEngine().decode(rec.id, rec.blob);
      const r = await detectBPM(buffer);
      if (!r) return void set(toast("BPM を検出できませんでした", "error"));
      await patchTrack(id, { bpm: r.bpm, beatOffset: r.beatOffset, chorusStart: undefined, chorusEnd: undefined, choruses: undefined, chorusManual: false, vocalMap: undefined });
      void ensureVocal(id, r.bpm, r.beatOffset, buffer, patchTrack);
      const t = get().tracks.find((x) => x.id === id);
      if (t) await ensureChorus({ ...t, chorusStart: undefined }, buffer, patchTrack);
      set(toast(`BPM ${r.bpm} に更新しました (サビも再検出)`, "success"));
    },
    setChorus: async (id, start, bars = 16) => {
      const t = get().tracks.find((x) => x.id === id);
      if (!t) return;
      const off = t.beatOffset ?? 0;
      const barSec = t.bpm ? 240 / t.bpm : 2;
      const s = t.bpm ? off + Math.round((start - off) / barSec) * barSec : start;
      const range: [number, number] = [Math.max(0, Math.round(s * 1000) / 1000), Math.round(Math.min(t.duration, s + bars * barSec) * 1000) / 1000];
      // Manual marks accumulate (long files have many hooks); overlapping ones are replaced.
      const others = chorusesOf(t).filter(([a, b]) => b <= range[0] || a >= range[1]);
      const choruses = [...others, range].sort((x, y) => x[0] - y[0]);
      await patchTrack(id, { chorusStart: range[0], chorusEnd: range[1], choruses, chorusManual: true });
      set(toast(`サビを ${fmtTime(s)} から ${bars} 小節に追加しました (合計 ${choruses.length} 箇所)`, "success"));
    },
    clearChorus: (id) => patchTrack(id, { chorusStart: undefined, chorusEnd: undefined, choruses: undefined, chorusManual: false }),
    detectChorusFor: async (id) => {
      const rec = await getTrackRec(id);
      if (!rec) return;
      const buffer = await getEngine().decode(rec.id, rec.blob);
      const bounds = rec.soundStart != null && rec.soundEnd != null ? { soundStart: rec.soundStart, soundEnd: rec.soundEnd } : soundBounds(buffer);
      const r = detectChorus(buffer, rec.bpm, rec.beatOffset ?? 0, bounds);
      if (!r) return void set(toast("サビを検出できませんでした (曲が短すぎるか BPM 未解析)", "error"));
      await patchTrack(id, { ...r, chorusManual: false });
      set(toast(r.choruses.length > 1 ? `サビを ${r.choruses.length} 箇所検出: ${r.choruses.map(([a]) => fmtTime(a)).join(", ")}` : `サビを検出: ${fmtTime(r.chorusStart)} – ${fmtTime(r.chorusEnd)}`, "success"));
    },
    seq: { playing: false, step: -1, slot: 0, patterns: [emptyPattern(), emptyPattern(), emptyPattern(), emptyPattern()], swing: 0, bpm: 124, open: false },
    seqToggle: () => {
      const e = getEngine();
      const sq = e.sequencer;
      if (sq.playing) {
        sq.stop();
        set((s) => ({ seq: { ...s.seq, playing: false, step: -1 } }));
        return;
      }
      sq.pattern = get().seq.patterns[get().seq.slot];
      sq.swing = get().seq.swing;
      // Lock to the playing deck's next bar line so the drums sit on its grid.
      const { decks, crossfader } = get();
      const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
      let at = e.ctx.currentTime + 0.05;
      if (playing.length) {
        const id = playing.length === 1 ? playing[0] : crossfader < 0.5 ? "A" : "B";
        const d = e.decks[id];
        const bpm = d.track!.bpm!;
        const posBeats = ((d.position - (d.track!.beatOffset ?? 0)) * bpm) / 60;
        const toBar = ((Math.ceil(posBeats / 4 - 0.02) * 4 - posBeats) * 60) / bpm / d.rate;
        at = e.ctx.currentTime + Math.max(0.05, toBar);
      }
      sq.onStep = (step) => set((s) => ({ seq: { ...s.seq, step } }));
      sq.start(at);
      set((s) => ({ seq: { ...s.seq, playing: true } }));
    },
    seqSetStep: (lane, step, v) => {
      const patterns = get().seq.patterns.map((p, i) => (i === get().seq.slot ? { ...p, steps: p.steps.map((row, l) => (l === lane ? row.map((x, k) => (k === step ? v : x)) : row)) } : p));
      set((s) => ({ seq: { ...s.seq, patterns } }));
      getEngine().sequencer.pattern = patterns[get().seq.slot];
      void db.setSetting("seqPatterns", patterns);
    },
    seqSetLane: (lane, pad) => {
      const patterns = get().seq.patterns.map((p, i) => (i === get().seq.slot ? { ...p, lanes: p.lanes.map((x, l) => (l === lane ? pad : x)) } : p));
      set((s) => ({ seq: { ...s.seq, patterns } }));
      getEngine().sequencer.pattern = patterns[get().seq.slot];
      void db.setSetting("seqPatterns", patterns);
    },
    seqSetSlot: (slot) => {
      set((s) => ({ seq: { ...s.seq, slot } }));
      getEngine().sequencer.pattern = get().seq.patterns[slot];
    },
    seqClear: () => {
      const patterns = get().seq.patterns.map((p, i) => (i === get().seq.slot ? emptyPattern(p.lanes) : p));
      set((s) => ({ seq: { ...s.seq, patterns } }));
      getEngine().sequencer.pattern = patterns[get().seq.slot];
      void db.setSetting("seqPatterns", patterns);
    },
    seqSetSwing: (swing) => {
      set((s) => ({ seq: { ...s.seq, swing } }));
      getEngine().sequencer.swing = swing;
    },
    seqSetBpm: (bpm) => {
      set((s) => ({ seq: { ...s.seq, bpm } }));
      getEngine().seqBpm = bpm;
    },
    seqSetOpen: (open) => set((s) => ({ seq: { ...s.seq, open } })),
    seqPreset: (name) => {
      const pads = get().pads;
      const byName = (n: string) => pads.find((p) => p.name === n && p.sampleId)?.index ?? null;
      const kit909 = ["909 Kick", "909 Snare", "909 Clap", "909 HH Closed", "909 HH Open", "909 Ride", "909 Tom Lo", "Clave"];
      const kit808 = ["808 Kick Long", "808 Snare", "808 Clap", "808 HH Closed", "808 HH Open", "808 Cowbell", "808 Bass C", "808 Rimshot"];
      const kitA = ["Kick", "Snare", "Clap", "HH Closed", "HH Open", "Crash", "Tom", "Shaker"];
      const lanes = (name === "trap" ? kit808 : name === "breaks" ? kitA : kit909).map(byName);
      const row = (s: string): Step[] => s.replace(/\s/g, "").split("").map((c) => (c === "X" ? 2 : c === "x" ? 1 : 0)) as Step[];
      const P: Record<string, string[]> = {
        house: ["X...x...X...x...", "....X.......X...", "....x.......x..x", "x.x.x.x.x.x.x.x.", "..x...x...x...x.", "................", "..............x.", "x..x..x...x..x.."],
        techno: ["X...X...X...X...", "................", "....x.......x...", "x.x.x.x.x.x.x.x.", "..x...x...x...x.", "x...............", ".......x......x.", "...x..x....x..x."],
        trap: ["X......x..X.....", "....X.......X...", "....x.......x...", "x.x.xxx.x.x.xxxx", "......x.........", "..x.....x.....x.", "X.........X.....", ".......x......x."],
        breaks: ["X.....X..X......", "....X......X....", "....x.......x...", "x.xxx.xxx.xxx.xx", "......x.......x.", "x...............", "..............xx", "..x...x...x...x."],
      };
      const steps = P[name].map(row);
      const patterns = get().seq.patterns.map((p, i) => (i === get().seq.slot ? { lanes, steps } : p));
      set((s) => ({ seq: { ...s.seq, patterns } }));
      getEngine().sequencer.pattern = patterns[get().seq.slot];
      void db.setSetting("seqPatterns", patterns);
      const missing = lanes.filter((l) => l == null).length;
      set(toast(missing ? `${name} パターンを読み込みました (${missing} 本のパッドが見つかりません。内蔵キットを追加してください)` : `${name} パターンを読み込みました`, "success"));
    },
    mode: null,
    applyMode: (m) => {
      const pref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPref(k, v);
      set({ mode: m });
      switch (m) {
        case "edm":
          pref("djSegment", "long");
          pref("djEntry", "always");
          pref("autoStyle", "auto");
          pref("mixBeats", 32);
          pref("autoFx", true);
          pref("djEnergy", "up");
          pref("djMatch", "both");
          break;
        case "chorus":
          pref("djSegment", "chorus");
          pref("djEntry", "chorus");
          pref("autoStyle", "auto");
          pref("autoFx", true);
          break;
        case "party":
          pref("djSegment", "random");
          pref("djEntry", "always");
          pref("autoStyle", "auto");
          pref("mixBeats", 32);
          pref("djEnergy", "wave");
          pref("autoFx", true);
          break;
        case "chill":
          pref("djSegment", "end");
          pref("djEntry", "start");
          pref("autoStyle", "blend");
          pref("mixBeats", 64);
          pref("djEnergy", "flat");
          pref("autoFx", false);
          break;
        case "classic":
          pref("djSegment", "end");
          pref("djEntry", "start");
          pref("autoStyle", "auto");
          pref("mixBeats", 32);
          pref("djEnergy", "flat");
          pref("autoFx", true);
          break;
        case "drums":
          set({ bank: 6 });
          get().seqSetOpen(true);
          pref("quantize", "bar");
          break;
      }
      const info = MODES.find((x) => x.id === m)!;
      set(toast(`${info.icon} ${info.label}: ${info.desc}`, "success"));
    },
    applyTheme: (t) => {
      set({ activeLook: null });
      const cur = get().vj;
      const patch: Partial<VJSettings> = { theme: t, presetLock: false };
      const caption = cur.overlayText === DEVDAY_CAPTION || cur.overlayText === "" ? (t === "devday" ? DEVDAY_CAPTION : "") : cur.overlayText;
      switch (t) {
        case "devday":
          Object.assign(patch, { pool: "devday", ddTheme: "devday", overlayText: caption, preset: "dd_circles" });
          break;
        case "neon":
          Object.assign(patch, { pool: "devday", ddTheme: "neon", overlayText: caption, preset: "dd_title" });
          break;
        case "classic":
          Object.assign(patch, { pool: "classic", overlayText: caption, preset: "bars" });
          break;
        case "minimal":
          Object.assign(patch, { pool: "calm", overlayText: caption, preset: "rings" });
          break;
        default:
          Object.assign(patch, { pool: "auto", overlayText: caption });
      }
      get().setVJ(patch);
      const info = VJ_THEMES.find((x) => x.id === t)!;
      set(toast(`Theme ${info.label}: ${info.desc}`, "success"));
    },
    looks: BUILTIN_LOOKS,
    activeLook: null,
    applyLook: (id) => {
      const look = get().looks.find((l) => l.id === id);
      if (!look) return;
      const run = () => {
        const s = get();
        if (s.vj.theme !== look.theme) s.applyTheme(look.theme);
        if (s.vj.show !== look.show) s.applyShow(look.show);
        const patch: Partial<VJSettings> = { hue: look.hue, intensity: look.intensity, trails: look.trails, follow: true, director: true };
        if (look.layer2) patch.layer2 = look.layer2;
        if (look.showCustom) patch.showCustom = look.showCustom;
        if (look.colorMode) patch.colorMode = look.colorMode;
        if (look.palette) patch.palette = look.palette;
        if (look.preset) Object.assign(patch, { preset: look.preset, presetLock: true });
        else patch.presetLock = false;
        if (look.overlayText != null) patch.overlayText = look.overlayText;
        s.setVJ(patch);
        set({ activeLook: id, ...toast(`Look「${look.name}」`, "success") });
      };
      // Switch on the next bar line so the change lands musically (immediately when nothing plays).
      const { decks, crossfader } = get();
      const wait = quantizeDelay("bar", decks, crossfader);
      if (wait > 0.08) {
        set({ activeLook: id, ...toast(`Look「${look.name}」: 次の小節頭で切替`) });
        setTimeout(run, wait * 1000);
      } else run();
    },
    saveLook: async (name) => {
      const v = get().vj;
      const look: VJLook = { id: `look-${Date.now()}`, name: name.trim() || `Look ${get().looks.filter((l) => !l.builtin).length + 1}`, theme: v.theme, show: v.show, preset: v.presetLock ? v.preset : null, hue: v.hue, intensity: v.intensity, trails: v.trails, overlayText: v.overlayText, layer2: v.layer2, showCustom: v.showCustom, colorMode: v.colorMode, palette: v.palette };
      const looks = [...get().looks, look];
      set({ looks, activeLook: look.id, ...toast(`Look「${look.name}」を保存しました`, "success") });
      await db.setSetting("vjLooks", looks.filter((l) => !l.builtin));
    },
    deleteLook: async (id) => {
      const looks = get().looks.filter((l) => l.id !== id || l.builtin);
      set({ looks, activeLook: get().activeLook === id ? null : get().activeLook });
      await db.setSetting("vjLooks", looks.filter((l) => !l.builtin));
    },
    applyShow: (id) => {
      const p = showParams(id, 0.5, get().vj.showCustom);
      get().setVJ({ show: id, strobe: p.strobe, autoHype: p.autoHype, hypeLevel: p.hypeLevel, autoDrop: true, trails: p.trails, follow: true, director: true, presetLock: false });
      set({ activeLook: null });
      const info = VJ_SHOWS.find((x) => x.id === id)!;
      set(toast(`演出 ${info.label}: ${info.desc}`, "success"));
    },
    vjLive: null,
    setAutoVJ: (on) => {
      get().setVJ(on ? { follow: true, presetLock: false, director: true, autoDrop: true, autoHype: true, autoCycle: false } : { follow: false, director: false, autoDrop: false, autoHype: false });
      set(toast(on ? "AUTO 演出 ON: 音に合わせて絵・色・カメラ・カットを自動で演出します" : "AUTO 演出 OFF: 選んだプリセットをそのまま表示します"));
    },
    setChorusMode: (on) => {
      set({ mode: null });
      setPref("djSegment", on ? "chorus" : "long");
      setPref("djEntry", on ? "chorus" : "always", toast(on ? "サビモード ON: 各曲のサビだけを繋いでいきます (繋ぎは 2 小節)" : "サビモード OFF"));
      // Make sure every track in the library has a chorus marker.
      if (on) for (const t of get().tracks) if (t.bpm && !t.chorusManual && (t.chorusStart == null || t.chorusStart <= (t.soundStart ?? 0) + 0.5 || (!t.choruses?.length && t.duration >= 360))) void getTrackRec(t.id).then(async (rec) => rec && ensureChorus(t, await getEngine().decode(rec.id, rec.blob), patchTrack));
    },

    loadToDeck: async (trackId, deckId, force = false) => {
      const engine = getEngine();
      const deck = engine.decks[deckId];
      if (deck.playing && !force) {
        set(toast(`Deck ${deckId} は再生中です。停止するか、確認ダイアログで上書きしてください`, "error"));
        return false;
      }
      const rec = await getTrackRec(trackId);
      if (!rec) return false;
      get().stopPreview();
      const buffer = await engine.decode(rec.id, rec.blob);
      // Decoding a long file can take seconds; the deck may have started playing (e.g. Auto DJ) meanwhile.
      if (deck.playing && !force) {
        set(toast(`Deck ${deckId} は再生中になったため「${rec.name}」のロードを中止しました`, "error"));
        return false;
      }
      if (rec.keyRoot == null) analyzeKey(rec.id, buffer, set);
      deck.load(buffer, stripBlob(rec));
      newSegment(deckId, deck.cuePoint);
      segChorus[deckId] = null;
      // Sound bounds are needed right away (entry / mix-out positions); everything else runs in idle slots.
      const b = rec.soundStart != null && rec.soundEnd != null ? { soundStart: rec.soundStart, soundEnd: rec.soundEnd } : soundBounds(buffer);
      if (rec.soundStart == null) void patchTrack(rec.id, b);
      if (rec.loudnessV !== 2) idle(() => loudnessLufs(buffer, b).then((l) => patchTrack(rec.id, { loudness: l, loudnessV: 2 })));
      if (rec.chorusStart == null && rec.bpm) idle(() => ensureChorus(stripBlob(rec), buffer, patchTrack));
      if (rec.introBars == null && rec.bpm) idle(() => patchTrack(rec.id, { introBars: introBars(buffer, rec.bpm!, rec.beatOffset ?? 0, b) }));
      if (!rec.vocalMap && rec.bpm) idle(() => ensureVocal(rec.id, rec.bpm, rec.beatOffset ?? 0, buffer, patchTrack));
      spentTracks[deckId] = null;
      set((s) => ({ mixOut: { ...s.mixOut, [deckId]: rec.mixOut ?? null } }));
      get().syncDecks();
      return true;
    },

    deckAction: (deckId, fn) => {
      const d = getEngine().decks[deckId];
      const before = `${d.cues.join()}|${d.cuePoint}|${d.loop.in}|${d.loop.out}`;
      fn(d);
      if (`${d.cues.join()}|${d.cuePoint}|${d.loop.in}|${d.loop.out}` !== before) persistDeckTrack(deckId);
      get().syncDecks();
    },

    /** Match the other deck's tempo and nudge the position so the beats line up (phase sync). */
    syncToOther: (id) => {
      const e = getEngine();
      const me = e.decks[id];
      const other = e.decks[id === "A" ? "B" : "A"];
      const a = me.track?.bpm;
      const b = other.track?.bpm;
      if (!a || !b) return;
      const target = b * other.rate;
      me.setRate(Math.min(1.5, Math.max(0.5, target / a)));
      const pa = me.beatPhase;
      const pb = other.beatPhase;
      if (pa != null && pb != null && other.playing) {
        let diff = pb - pa; // beats
        if (diff > 0.5) diff -= 1;
        if (diff < -0.5) diff += 1;
        const secs = (diff * 60) / (a * me.rate);
        if (Math.abs(secs) > 0.004) me.seek(me.position + secs);
      }
      set(toast(`Deck ${id}: ${target.toFixed(1)} BPM に同期${other.playing ? " (ビート位相も合わせました)" : ""}`, "success"));
      get().syncDecks();
    },

    syncDecks: () => {
      const e = getEngine();
      const decks = { A: e.decks.A.getState(), B: e.decks.B.getState() };
      for (const id of ["A", "B"] as const) {
        if (decks[id].playing && !wasPlaying[id]) logPlay(decks[id].track);
        wasPlaying[id] = decks[id].playing;
      }
      set({ decks });
    },

    importSamples: async (files) => {
      const engine = getEngine();
      const placed: string[] = [];
      for (const file of Array.from(files)) {
        const id = uid();
        try {
          const buffer = await engine.decode(id, file);
          const blob = storable(file, buffer);
          const temp = get().saveMode === "temp";
          const sample: SampleMeta = {
            id,
            name: file.name.replace(/\.[^.]+$/, ""),
            duration: buffer.duration,
            size: blob.size,
            createdAt: Date.now(),
            ...(temp ? { temporary: true } : {}),
          };
          if (temp) memSamples.set(id, { ...sample, blob });
          else await db.putSample({ ...sample, blob });
          set((s) => ({ samples: [sample, ...s.samples] }));
          // Auto-assign to first empty pad for convenience.
          const empty = get().pads.find((p) => !p.sampleId);
          if (empty) {
            await get().assignSample(empty.index, id);
            placed.push(`${sample.name} → ${padLabel(empty.index)}`);
          }
        } catch (err) {
          set(toast(storageErrorMessage(err, file.name), "error"));
        }
      }
      if (placed.length) set(toast(placed.length === 1 ? `割り当て: ${placed[0]}` : `${placed.length} 個のサンプルを空きパッドに割り当てました (${placed[0]} …)`, "success"));
      void get().refreshStorage();
    },

    deleteSamples: async (ids) => {
      const metas = get().samples.filter((x) => ids.includes(x.id));
      if (!metas.length) return;
      rememberRemoved(metas.filter((m) => isDefaultSample(m.name)).map((m) => m.name));
      const padMap = new Map<string, number[]>();
      for (const p of get().pads) if (p.sampleId && ids.includes(p.sampleId)) padMap.set(p.sampleId, [...(padMap.get(p.sampleId) ?? []), p.index]);
      set((s) => ({ samples: s.samples.filter((x) => !ids.includes(x.id)) }));
      for (const [, idx] of padMap) for (const i of idx) await get().assignSample(i, null);
      const timer = setTimeout(async () => {
        for (const m of metas) {
          pendingDeletes.delete(m.id);
          if (memSamples.delete(m.id)) void 0;
          else await db.deleteSample(m.id);
          getEngine().uncache(m.id);
        }
        void get().refreshStorage();
      }, 6000);
      for (const m of metas) pendingDeletes.set(m.id, timer);
      const padCount = [...padMap.values()].reduce((n, a) => n + a.length, 0);
      set(
        toast(`${metas.length} 件のサンプルを削除しました${padCount ? ` (パッド ${padCount} 個から外しました)` : ""}`, "info", {
          label: "元に戻す",
          onClick: async () => {
            if (!pendingDeletes.has(metas[0].id)) return;
            clearTimeout(timer);
            for (const m of metas) pendingDeletes.delete(m.id);
            set((s) => ({ samples: [...metas, ...s.samples].sort((a, b) => b.createdAt - a.createdAt) }));
            for (const [sid, idx] of padMap) for (const i of idx) await get().assignSample(i, sid);
            set(toast(`${metas.length} 件を元に戻しました`, "success"));
          },
        }),
      );
    },
    deleteSample: async (id) => {
      const meta = get().samples.find((x) => x.id === id);
      if (!meta) return;
      if (isDefaultSample(meta.name)) rememberRemoved([meta.name]);
      const padIdx = get().pads.filter((p) => p.sampleId === id).map((p) => p.index);
      set((s) => ({ samples: s.samples.filter((x) => x.id !== id) }));
      for (const i of padIdx) await get().assignSample(i, null);
      const timer = setTimeout(async () => {
        pendingDeletes.delete(id);
        if (memSamples.delete(id)) void 0;
        else await db.deleteSample(id);
        getEngine().uncache(id);
        void get().refreshStorage();
      }, 6000);
      pendingDeletes.set(id, timer);
      set(
        toast(`「${meta.name}」を削除しました${padIdx.length ? ` (パッド ${padIdx.length} 個から外しました)` : ""}`, "info", {
          label: "元に戻す",
          onClick: async () => {
            const t = pendingDeletes.get(id);
            if (!t) return;
            clearTimeout(t);
            pendingDeletes.delete(id);
            set((s) => ({ samples: [meta, ...s.samples].sort((a, b) => b.createdAt - a.createdAt) }));
            for (const i of padIdx) await get().assignSample(i, id);
            set(toast(`「${meta.name}」を元に戻しました`, "success"));
          },
        }),
      );
    },

    assignSample: async (padIndex, sampleId) => {
      const engine = getEngine();
      const sample = sampleId ? get().samples.find((s) => s.id === sampleId) : null;
      if (sampleId) {
        const rec = await getSampleRec(sampleId);
        engine.sampler.setBuffer(padIndex, rec ? await engine.decode(rec.id, rec.blob) : null);
      } else engine.sampler.setBuffer(padIndex, null);
      await get().updatePad(padIndex, { sampleId, name: sample?.name ?? "", start: undefined, end: undefined });
    },

    updatePad: async (padIndex, patch) => {
      const pad = { ...get().pads[padIndex], ...patch };
      getEngine().sampler.setConfig(pad);
      await db.putPad(pad);
      set((s) => ({ pads: s.pads.map((p) => (p.index === padIndex ? pad : p)) }));
    },

    pressPad: (i, immediate = false) => {
      const pad = get().pads[i];
      if (pad.loopBpm && get().autoMatch && pad.sampleId) {
        const t = matchTarget();
        if (matchedPads.get(i) !== `${t.bpm}|${t.shift}` && (matchedPads.has(i) || t.bpm !== 128 || t.shift !== 0)) {
          void renderPad(pad, t.bpm, t.shift).then(() => pressNow(i, immediate));
          return;
        }
      }
      pressNow(i, immediate);
    },
    releasePad: (i) => getEngine().sampler.release(i),
    setEcho: (on) => {
      getEngine().sampler.setEcho(on, currentBpm(get().decks, get().crossfader));
      set({ echo: on });
    },

    micRecording: false,
    micSince: 0,
    toggleMicRecording: async () => {
      if (micRecorder) {
        const rec = micRecorder;
        micRecorder = null;
        const blob = await new Promise<Blob>((res) => {
          const chunks: Blob[] = [];
          rec.ondataavailable = (e) => chunks.push(e.data);
          rec.onstop = () => res(new Blob(chunks, { type: rec.mimeType }));
          rec.stop();
        });
        micStream?.getTracks().forEach((t) => t.stop());
        micStream = null;
        const secs = (Date.now() - get().micSince) / 1000;
        set({ micRecording: false, micSince: 0 });
        if (secs < 0.2) return void set(toast("録音が短すぎました", "error"));
        const file = new File([blob], `mic ${new Date().toLocaleTimeString()}.webm`, { type: blob.type });
        await get().importSamples([file]);
        return;
      }
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        set(toast("マイクを使用できません。ブラウザのマイク許可を確認してください", "error"));
        return;
      }
      micRecorder = new MediaRecorder(micStream);
      // Collect data while recording so a long take is not lost if the tab is backgrounded.
      micRecorder.start(250);
      set({ micRecording: true, micSince: Date.now(), ...toast("マイク録音中… もう一度押すと停止してパッドに割り当てます", "progress") });
    },

    previewing: null,
    previewSample: async (id) => {
      const engine = getEngine();
      if (get().previewing === id) return get().stopPreview();
      const rec = await getSampleRec(id);
      if (!rec) return;
      engine.preview(await engine.decode(rec.id, rec.blob), 0, 30);
      set({ previewing: id });
    },
    previewTrack: async (id) => {
      const engine = getEngine();
      if (get().previewing === id) return get().stopPreview();
      const rec = await getTrackRec(id);
      if (!rec) return;
      const buf = await engine.decode(rec.id, rec.blob);
      // Start a bit into the track (usually past the intro), for 20 seconds.
      engine.preview(buf, Math.min(buf.duration * 0.3, 60), 20);
      set({ previewing: id });
    },
    stopPreview: () => {
      getEngine().preview(null);
      set({ previewing: null });
    },

    exportBackup: async () => {
      set(toast("バックアップを作成中…", "progress"));
      try {
        const [tracks, samples, pads, settings] = await Promise.all([db.allTrackRecords(), db.allSampleRecords(), db.listPads(), db.allSettings()]);
        const ext = (b: Blob) => (b.type.includes("wav") ? "wav" : b.type.includes("mp4") || b.type.includes("m4a") ? "m4a" : b.type.includes("ogg") ? "ogg" : b.type.includes("webm") ? "webm" : b.type.includes("flac") ? "flac" : "mp3");
        const manifest = {
          version: 1,
          exportedAt: new Date().toISOString(),
          tracks: tracks.map((t) => ({ ...stripBlob(t), file: `tracks/${t.id}.${ext(t.blob)}`, type: t.blob.type })),
          samples: samples.map((s) => ({ ...stripBlob(s), file: `samples/${s.id}.${ext(s.blob)}`, type: s.blob.type })),
          pads,
          settings: {
            ...Object.fromEntries(Object.entries(settings).filter(([k]) => k !== "vjLogo" && k !== "vjMedia")),
            _midiMap: localStorage.getItem("midiMap") ?? undefined,
          },
        };
        const logo = settings.vjLogo as Blob | undefined;
        const media = settings.vjMedia as Blob | undefined;
        const blob = await writeZip(
          [
            { name: "manifest.json", data: JSON.stringify(manifest) },
            ...tracks.map((t, i) => ({ name: manifest.tracks[i].file, data: t.blob })),
            ...samples.map((s, i) => ({ name: manifest.samples[i].file, data: s.blob })),
            ...(logo ? [{ name: "logo.bin", data: logo }] : []),
            ...(media ? [{ name: "media.bin", data: media }] : []),
          ],
          (done, total) => set(toast(`バックアップを作成中… ${done}/${total}`, "progress")),
        );
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: `dj-vj-backup-${new Date().toISOString().slice(0, 10)}.zip` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        set(toast(`バックアップを書き出しました (${(blob.size / 1024 / 1024).toFixed(0)} MB)`, "success"));
      } catch (e) {
        console.error(e);
        set(toast("バックアップの作成に失敗しました", "error"));
      }
    },

    importBackup: async (file) => {
      set(toast("バックアップを読み込み中…", "progress"));
      try {
        const files = await readZip(file);
        const mf = files.find((f) => f.name === "manifest.json");
        if (!mf) throw new Error("manifest missing");
        const manifest = JSON.parse(await mf.text()) as {
          tracks: (TrackMeta & { file: string; type: string })[];
          samples: (SampleMeta & { file: string; type: string })[];
          pads: PadConfig[];
          settings: Record<string, unknown>;
        };
        const byName = new Map(files.map((f) => [f.name, f]));
        const have = new Set([...get().tracks.map((t) => t.id), ...get().samples.map((s) => s.id)]);
        let n = 0;
        for (const t of manifest.tracks) {
          const f = byName.get(t.file);
          if (!f || have.has(t.id)) continue;
          const { file: _f, type, ...meta } = t;
          void _f;
          await db.putTrack({ ...meta, blob: new Blob([await f.blob().arrayBuffer()], { type }) });
          n++;
        }
        for (const s of manifest.samples) {
          const f = byName.get(s.file);
          if (!f || have.has(s.id)) continue;
          const { file: _f, type, ...meta } = s;
          void _f;
          await db.putSample({ ...meta, blob: new Blob([await f.blob().arrayBuffer()], { type }) });
          n++;
        }
        for (const p of manifest.pads ?? []) await db.putPad(p);
        for (const [k, v] of Object.entries(manifest.settings ?? {})) {
          if (k === "_midiMap") {
            if (typeof v === "string") localStorage.setItem("midiMap", v);
          } else await db.setSetting(k, v);
        }
        const logo = byName.get("logo.bin");
        if (logo) await db.setSetting("vjLogo", logo.blob());
        const media = byName.get("media.bin");
        if (media) await db.setSetting("vjMedia", media.blob());
        set(toast(`${n} 件を復元しました。再読み込みします…`, "success"));
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        console.error(e);
        set(toast("バックアップの読み込みに失敗しました (このアプリで書き出した zip を選んでください)", "error"));
      }
    },

    setMedia: async (file) => {
      const m = get().vj.media;
      if (file) await db.setSetting("vjMedia", file);
      else await db.deleteSetting("vjMedia");
      get().setVJ({ media: { ...m, version: m.version + 1, kind: file ? (file.type.startsWith("video") ? "video" : "image") : null } });
      set(toast(file ? "素材をレイヤー 3 に設定しました" : "素材を外しました", "success"));
    },
    setLogo: async (file) => {
      if (file) await db.setSetting("vjLogo", file);
      else await db.deleteSetting("vjLogo");
      get().setVJ({ logoVersion: get().vj.logoVersion + 1 });
      set(toast(file ? "ロゴ画像を設定しました" : "ロゴ画像を削除しました", "success"));
    },

    setCrossfader: (x) => {
      getEngine().setCrossfader(x);
      set({ crossfader: x });
    },
    setMasterVolume: (v) => {
      getEngine().setMasterVolume(v);
      setPref("masterVolume", v);
    },
    setSamplerVolume: (v) => {
      getEngine().sampler.setVolume(v);
      setPref("samplerVolume", v);
    },

    vinyl: { A: false, B: false },
    setVinyl: (deck, on) => set((s) => ({ vinyl: { ...s.vinyl, [deck]: on }, ...toast(on ? `Deck ${deck} VINYL: ジョグを回すとスクラッチ (離すとその位置から再生)` : `Deck ${deck} VINYL OFF (ジョグはナッジ)`) })),
    scratch: (deck, kind, beats) => {
      const e = getEngine();
      const d = e.decks[deck];
      if (!d.track) return void set(toast("デッキに曲がありません", "error"));
      if (d.scratching) return;
      if (!d.playing) return void set(toast("再生中にスクラッチしてください", "error"));
      const bpm = (d.track.bpm ?? 120) * d.rate;
      const n = beats ?? (kind === "scribble" ? 1 : kind === "rewind" ? 2 : 2);
      // Start on the next beat so the pattern sits in the groove.
      const wait = quantizeDelay("beat", get().decks, get().crossfader);
      const go = () => {
        d.scratchPattern(kind, bpm, n);
        get().syncDecks();
        featureBus.triggerFx({ fx: "glitch", hue: get().vj.hue });
      };
      if (wait > 0.03) setTimeout(go, wait * 1000);
      else go();
      const names = { baby: "BABY SCRATCH", chirp: "CHIRP", transformer: "TRANSFORMER", scribble: "SCRIBBLE", stab: "STAB", rewind: "REWIND" };
      set(toast(`${names[kind]} ${deck} (${n} 拍)`));
    },
    mic: { on: false, gain: 1, voice: "clean", echo: false, reverb: false, duck: true, semitones: 0, busy: false },
    setMicOn: async (on) => {
      const e = getEngine();
      if (!on) {
        e.mic.disable();
        return void set((s) => ({ mic: { ...s.mic, on: false }, ...toast("MIC OFF") }));
      }
      set((s) => ({ mic: { ...s.mic, busy: true } }));
      try {
        await e.mic.enable();
        const m = get().mic;
        e.mic.setGain(m.gain);
        e.mic.setVoice(m.voice);
        if (m.semitones) e.mic.setSemitones(m.semitones);
        e.mic.duck = m.duck;
        e.mic.setEcho(m.echo ? 0.6 : 0);
        e.mic.setReverb(m.reverb ? 0.5 : 0);
        e.syncEchoTempo(currentBpm(get().decks, get().crossfader) ?? 120);
        set((s) => ({ mic: { ...s.mic, on: true, busy: false }, ...toast("MIC ON: 話すと音楽が自動で下がります (トークオーバー)", "success") }));
      } catch (err) {
        console.warn(err);
        set((s) => ({ mic: { ...s.mic, on: false, busy: false }, ...toast("マイクを使えませんでした (ブラウザの許可を確認してください)", "error") }));
      }
    },
    setMic: (patch) => {
      const e = getEngine();
      const m = { ...get().mic, ...patch };
      set({ mic: m });
      if (patch.gain != null) e.mic.setGain(patch.gain);
      if (patch.voice) {
        e.mic.setVoice(patch.voice);
        set((s) => ({ mic: { ...s.mic, semitones: e.mic.semitones } }));
      }
      if (patch.semitones != null) e.mic.setSemitones(patch.semitones);
      if (patch.duck != null) e.mic.duck = patch.duck;
      if (patch.echo != null) {
        e.syncEchoTempo(currentBpm(get().decks, get().crossfader) ?? 120);
        e.mic.setEcho(patch.echo ? 0.6 : 0);
      }
      if (patch.reverb != null) e.mic.setReverb(patch.reverb ? 0.5 : 0);
    },
    cue: { supported: false, deviceId: "", devices: [], on: { A: false, B: false }, mix: 0 },
    listCueDevices: async () => {
      if (!AudioEngine.cueSupported) return;
      // Device labels are only revealed after a media permission; ask for the mic once, then release it.
      try {
        const probe = await navigator.mediaDevices.enumerateDevices();
        if (!probe.some((d) => d.kind === "audiooutput" && d.label)) {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach((t) => t.stop());
        }
      } catch {
        /* permission denied: labels stay generic */
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all.filter((d) => d.kind === "audiooutput").map((d, i) => ({ id: d.deviceId, label: d.label || `出力デバイス ${i + 1}` }));
      set((s) => ({ cue: { ...s.cue, devices } }));
    },
    setCueDevice: async (id) => {
      const ok = await getEngine().setCueDevice(id);
      set((s) => ({ cue: { ...s.cue, deviceId: ok ? id : "" }, ...toast(ok ? (id ? "ヘッドホン出力を設定しました。デッキの 🎧 で試聴" : "ヘッドホン出力を解除しました") : "この出力デバイスには送れませんでした", ok ? "success" : "error") }));
      localStorage.setItem("cueDevice", ok ? id : "");
    },
    toggleCue: (deck) => {
      const on = !get().cue.on[deck];
      getEngine().setCue(deck, on);
      set((s) => ({ cue: { ...s.cue, on: { ...s.cue.on, [deck]: on } } }));
    },
    setCueMix: (x) => {
      getEngine().setCueMix(x);
      set((s) => ({ cue: { ...s.cue, mix: x } }));
    },
    toggleRecording: async () => {
      const engine = getEngine();
      if (engine.recording) {
        const blob = await engine.stopRecording();
        set({ recording: false, recordingSince: 0 });
        if (blob) {
          const url = URL.createObjectURL(blob);
          const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
          const a = Object.assign(document.createElement("a"), { href: url, download: `mix-${stamp}.${blob.type.includes("mp4") ? "m4a" : "webm"}` });
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
          set(toast("録音を保存しました", "success"));
        }
      } else {
        engine.startRecording();
        set({ recording: true, recordingSince: Date.now(), ...toast("マスター出力の録音を開始しました") });
      }
    },

    setVJ: (patch) => {
      const vj = { ...get().vj, ...patch };
      set({ vj });
      db.setSetting("vj", vj);
    },
  };
});

/** Plays a pad now (quantised for loops), then fires its VJ effect / speech fallback. */
function pressNow(i: number, immediate = false) {
  const { pads, decks, crossfader, quantize } = useDJ.getState();
  const sampler = getEngine().sampler;
  const pad = pads[i];
  sampler.masterBpm = decks.A.playing || decks.B.playing ? currentBpm(decks, crossfader) : 0;
  const wait = pad.loopBpm && !immediate ? quantizeDelay(quantize, decks, crossfader) : 0;
  if (!sampler.press(i, wait > 0 ? getEngine().ctx.currentTime + wait : 0)) {
    if (!pad.speech || sampler.buffers.has(i)) return;
    speak(pad.speech, pad.pitch, pad.gain);
  }
  const fx = pad.fx ?? "pulse";
  if (fx === "none") return;
  const fire = () => featureBus.triggerFx({ fx, hue: hexToHue(pad.color), text: pad.fxText });
  if (wait > 0.02) setTimeout(fire, wait * 1000);
  else fire();
}
