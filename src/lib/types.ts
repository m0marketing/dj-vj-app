export type DeckId = "A" | "B";

export interface TrackMeta {
  id: string;
  name: string;
  duration: number;
  bpm: number | null;
  /** Position (seconds) of the first downbeat; the beat grid is `beatOffset + k * 60 / bpm`. */
  beatOffset?: number;
  key?: string;
  keyRoot?: number;
  keyMinor?: boolean;
  size: number;
  createdAt: number;
  /** Performance data remembered per track. */
  cues?: (number | null)[];
  cuePoint?: number;
  loopIn?: number | null;
  loopOut?: number | null;
  mixOut?: number | null;
  /** Audible range (leading / trailing silence trimmed), seconds. */
  soundStart?: number;
  soundEnd?: number;
  /** Loudness of the body: LUFS (K-weighted, gated) when loudnessV === 2, plain RMS dBFS before that. */
  loudness?: number;
  loudnessV?: number;
  /** Intro length in bars (low-energy bars from the first sound) - the blend window for a classic mix-in. */
  introBars?: number;
  /** Vocal presence per bar (0..1) on the beat grid; used to keep two vocals from clashing in a blend. */
  vocalMap?: number[];
  /** Chorus (サビ) range on the bar grid; `chorusManual` = set by the user, never overwritten by detection. */
  chorusStart?: number;
  chorusEnd?: number;
  chorusManual?: boolean;
  /** All detected chorus sections (long files / mixes contain many songs). [start, end] pairs on the bar grid. */
  choruses?: [number, number][];
  /** Session-only: held in memory, gone after the tab closes unless saved from the library. */
  temporary?: boolean;
}

export interface TrackRecord extends TrackMeta {
  blob: Blob;
}

export interface SampleMeta {
  id: string;
  name: string;
  duration: number;
  size: number;
  createdAt: number;
  temporary?: boolean;
}

export interface SampleRecord extends SampleMeta {
  blob: Blob;
}

export type PadMode = "oneshot" | "gate" | "loop" | "toggle";

export interface PadConfig {
  index: number;
  sampleId: string | null;
  name: string;
  mode: PadMode;
  gain: number;
  pitch: number; // semitones
  choke: number; // 0 = none
  color: string;
  fx?: VJFxId; // visual effect fired on hit (default "pulse")
  fxText?: string; // text / emoji list used by text & emoji effects
  loopBpm?: number; // tempo of a loop sample; playback is stretched to the playing deck BPM
  speech?: string; // if set and no sample is assigned, the pad reads this text aloud
  /** Trim region (seconds into the sample). Undefined = whole sample. */
  start?: number;
  end?: number;
}

export interface AudioFeatures {
  level: number;
  bass: number;
  mid: number;
  high: number;
  beat: boolean;
  beatPhase: number;
  bpm: number | null;
  spectrum: Uint8Array;
  waveform: Uint8Array;
}

export type VJPresetId =
  | "bars"
  | "rings"
  | "particles"
  | "tunnel"
  | "grid"
  | "strobe"
  | "lasers"
  | "disco"
  | "rays"
  | "scope"
  | "kaleido"
  | "starfield"
  | "plasma"
  | "typo"
  | "dd_faces"
  | "dd_title"
  | "dd_products"
  | "dd_ticker"
  | "dd_stack"
  | "dd_terminal"
  | "dd_brackets"
  | "dd_launch"
  | "dd_swarm"
  | "dd_pulse";

export type VJFxId =
  | "none"
  | "pulse"
  | "flash"
  | "shock"
  | "confetti"
  | "lasers"
  | "text"
  | "emoji"
  | "glitch"
  | "siren"
  | "build"
  | "drop"
  | "airhorn"
  | "fireworks"
  | "lowerthird"
  | "clear";

export interface VJFxEvent {
  fx: VJFxId;
  hue: number;
  text?: string;
}

export const VJ_FX: { id: VJFxId; label: string }[] = [
  { id: "none", label: "なし" },
  { id: "pulse", label: "Pulse" },
  { id: "flash", label: "Flash" },
  { id: "shock", label: "Shockwave" },
  { id: "confetti", label: "Confetti" },
  { id: "lasers", label: "Lasers" },
  { id: "text", label: "Text" },
  { id: "emoji", label: "Emoji" },
  { id: "glitch", label: "Glitch" },
  { id: "siren", label: "Siren Lights" },
  { id: "build", label: "Build-up" },
  { id: "drop", label: "DROP!" },
  { id: "airhorn", label: "Air Horn" },
  { id: "fireworks", label: "Fireworks" },
  { id: "lowerthird", label: "Now Playing (曲名)" },
];

export type VJTheme = "free" | "devday" | "neon" | "classic" | "minimal";
export const VJ_THEMES: { id: VJTheme; label: string; desc: string }[] = [
  { id: "devday", label: "DevDay 2026", desc: "OpenAI DevDay 2026 の公式配色とビジュアル (Circles / Title / Products / Ticker / Stack / Terminal / Brackets) のみ。キャプション付き、ストロボ OFF" },
  { id: "neon", label: "Neon", desc: "DevDay 系の構図をネオン配色で。ストロボ OFF" },
  { id: "classic", label: "Classic", desc: "スペクトラム / リング / トンネル / レーザーなど定番の音反応ビジュアル" },
  { id: "minimal", label: "Minimal", desc: "落ち着いた絵のみ (リング / プラズマ / スコープ / 星空)。ストロボ OFF" },
  { id: "free", label: "Free (全部)", desc: "全プリセットを使う" },
];

/** Show style = how the visuals move (camera, cuts, hits, pacing). Combined freely with a Theme (= what is drawn). */
export type VJShow = "auto" | "festival" | "club" | "cinema" | "keynote" | "minimal" | "custom";
/** Second visual layer composited over the main preset. */
export type VJBlend = "screen" | "lighter" | "overlay" | "multiply" | "difference" | "source-over";
export interface VJLayer2 {
  preset: VJPresetId | null;
  blend: VJBlend;
  opacity: number; // 0..1
  /** Draw the layer mirrored (kaleidoscope-ish) */
  mirror?: boolean;
}
export const VJ_BLENDS: { id: VJBlend; label: string; desc: string }[] = [
  { id: "screen", label: "スクリーン", desc: "明るい部分を重ねる (黒は透ける)。標準" },
  { id: "lighter", label: "加算", desc: "光が足し合わさる。派手" },
  { id: "overlay", label: "オーバーレイ", desc: "コントラストを強めながら重ねる" },
  { id: "multiply", label: "乗算", desc: "暗く沈ませる。マスクのように使う" },
  { id: "difference", label: "差の絶対値", desc: "色が反転して混ざるサイケ系" },
  { id: "source-over", label: "通常", desc: "上に不透明度だけで重ねる" },
];
/** Layer 3: a user image / video (stored in IndexedDB as "vjMedia"), blended over the generated visuals. */
export interface VJMedia {
  version: number; // bumped on every change so the canvases (and the /vj window) reload it
  kind: "image" | "video" | null;
  blend: VJBlend;
  opacity: number;
  fit: "cover" | "contain";
  /** Opacity follows the music (kick pulse) instead of staying constant. */
  pulse: boolean;
}
/** Colour source for music-follow: key of the track, a fixed hue, or a palette that steps every phrase. */
export type VJColorMode = "follow" | "fixed" | "palette";
export const VJ_PALETTES: { id: string; label: string; hues: number[] }[] = [
  { id: "devday", label: "DevDay (青・緑・紫・橙)", hues: [213, 145, 262, 22] },
  { id: "neon", label: "ネオン (マゼンタ・シアン・ライム)", hues: [300, 185, 90] },
  { id: "sunset", label: "サンセット (赤・橙・ピンク)", hues: [10, 35, 330] },
  { id: "ocean", label: "オーシャン (青・水色・エメラルド)", hues: [205, 225, 165] },
  { id: "warm", label: "ウォーム (金・琥珀・赤)", hues: [45, 30, 5] },
  { id: "mono", label: "モノ (白寄り)", hues: [220] },
];
export interface VJShowParams {
  /** Multipliers for the director's camera punch, shake, RGB split, glitch, flash frames, grain, light leak. */
  punch: number;
  shake: number;
  aberr: number;
  glitch: number;
  flash: number;
  grain: number;
  leak: number;
  vignette: number;
  /** Letterbox bars close in during breakdowns. */
  letterbox: boolean;
  /** Allowed cut transitions when the preset changes, and their duration scale. */
  cuts: ("zoom" | "wipe" | "slide" | "dissolve" | "flash" | "spin")[];
  cutDur: number;
  /** Preset change every N bars (music-follow). */
  phraseBars: number;
  /** Extra one-shot FX fired on detected drops. */
  dropFx: boolean;
  strobe: boolean;
  autoHype: boolean;
  hypeLevel: "low" | "mid" | "high";
  trails: number;
}
export const VJ_SHOWS: { id: VJShow; label: string; desc: string; p: VJShowParams }[] = [
  {
    id: "auto",
    label: "おまかせ (曲に合わせる)",
    desc: "曲のエネルギーで演出が変わる: ブレイク = シネマ、通常 = クラブ、盛り上がり / ドロップ = フェス。数値はなめらかに補間",
    p: { punch: 1, shake: 1, aberr: 1, glitch: 1, flash: 1, grain: 0.8, leak: 0.8, vignette: 1, letterbox: true, cuts: ["zoom", "wipe", "slide", "dissolve", "flash", "spin"], cutDur: 1, phraseBars: 8, dropFx: true, strobe: false, autoHype: true, hypeLevel: "mid", trails: 0.25 },
  },
  {
    id: "custom",
    label: "カスタム",
    desc: "細かい設定で自分で決めた動き (カメラ・揺れ・グリッチ・粒子・カットの種類・切替間隔)",
    p: { punch: 1, shake: 0.8, aberr: 0.8, glitch: 0.6, flash: 0.8, grain: 0.8, leak: 0.8, vignette: 1, letterbox: false, cuts: ["zoom", "wipe", "dissolve"], cutDur: 1, phraseBars: 8, dropFx: true, strobe: false, autoHype: true, hypeLevel: "mid", trails: 0.25 },
  },
  {
    id: "festival",
    label: "フェス",
    desc: "最大エネルギー。4 小節ごとに絵が変わり、ドロップでレーザー + 紙吹雪 + フラッシュ、カメラは強く揺れる",
    p: { punch: 1.3, shake: 1.2, aberr: 1.3, glitch: 1.1, flash: 1.5, grain: 0.5, leak: 1, vignette: 0.8, letterbox: false, cuts: ["flash", "zoom", "spin", "wipe", "slide"], cutDur: 0.8, phraseBars: 4, dropFx: true, strobe: true, autoHype: true, hypeLevel: "high", trails: 0.2 },
  },
  {
    id: "club",
    label: "クラブ",
    desc: "キックでズーム、8 小節ごとにカット、RGB ずれ・グリッチあり。標準的なクラブ VJ",
    p: { punch: 1, shake: 1, aberr: 1, glitch: 1, flash: 1, grain: 0.8, leak: 0.8, vignette: 1, letterbox: false, cuts: ["zoom", "wipe", "slide", "dissolve", "flash", "spin"], cutDur: 1, phraseBars: 8, dropFx: true, strobe: true, autoHype: true, hypeLevel: "mid", trails: 0.25 },
  },
  {
    id: "cinema",
    label: "シネマ",
    desc: "映画的。ゆっくりしたカメラ、ディゾルブ中心、黒帯・グレイン・ライトリーク強め、16 小節ごとに場面転換",
    p: { punch: 0.4, shake: 0.3, aberr: 0.5, glitch: 0, flash: 0.3, grain: 1.3, leak: 1.4, vignette: 1.2, letterbox: true, cuts: ["dissolve", "zoom"], cutDur: 1.5, phraseBars: 16, dropFx: false, strobe: false, autoHype: false, hypeLevel: "low", trails: 0.45 },
  },
  {
    id: "keynote",
    label: "キーノート",
    desc: "カンファレンス向け。揺れ・グリッチ・ストロボなし、ディゾルブ / ワイプのみ、16 小節ごとに切替、キャプション重視",
    p: { punch: 0.2, shake: 0, aberr: 0, glitch: 0, flash: 0.15, grain: 0.3, leak: 0.4, vignette: 0.6, letterbox: false, cuts: ["dissolve", "wipe"], cutDur: 1.3, phraseBars: 16, dropFx: false, strobe: false, autoHype: false, hypeLevel: "low", trails: 0.2 },
  },
  {
    id: "minimal",
    label: "ミニマル",
    desc: "静か。色と明るさだけが音に反応、絵は 32 小節ごとにゆっくり変わる",
    p: { punch: 0.25, shake: 0, aberr: 0, glitch: 0, flash: 0, grain: 0.6, leak: 0.3, vignette: 1, letterbox: false, cuts: ["dissolve"], cutDur: 1.8, phraseBars: 32, dropFx: false, strobe: false, autoHype: false, hypeLevel: "low", trails: 0.5 },
  },
];
const SHOW_BY_ID = (id: VJShow) => (VJ_SHOWS.find((s) => s.id === id) ?? VJ_SHOWS[2]).p;
const NUM_KEYS = ["punch", "shake", "aberr", "glitch", "flash", "grain", "leak", "vignette", "cutDur", "trails"] as const;
/**
 * Parameters of a show style. For "auto" the numbers are interpolated by the music's energy (0..1, smoothed by
 * the caller): breakdown -> cinema, mid -> club, peak -> festival; the discrete choices (cuts, pacing) follow the
 * nearest regime. This is the "energy-matched visuals" rule every VJ follows by hand.
 */
export const showParams = (id: VJShow | undefined, energy = 0.5, custom?: VJShowParams): VJShowParams => {
  if (id === "custom") return custom ?? SHOW_BY_ID("custom");
  if (id !== "auto") return SHOW_BY_ID(id ?? "club");
  const cinema = SHOW_BY_ID("cinema");
  const club = SHOW_BY_ID("club");
  const fest = SHOW_BY_ID("festival");
  const e = Math.min(1, Math.max(0, energy));
  // 0..0.35: cinema -> club, 0.35..0.75: club, 0.75..1: club -> festival
  const [a, b, k] = e < 0.35 ? [cinema, club, e / 0.35] : e < 0.75 ? [club, club, 0] : [club, fest, (e - 0.75) / 0.25];
  const near = e < 0.2 ? cinema : e > 0.85 ? fest : club;
  const out: VJShowParams = { ...near, strobe: false };
  for (const key of NUM_KEYS) out[key] = a[key] + (b[key] - a[key]) * k;
  out.letterbox = e < 0.3;
  return out;
};

/** A saved look = the whole combination (theme x show x fixed preset or auto switching x colour / overlay). */
export interface VJLook {
  id: string;
  name: string;
  theme: VJTheme;
  show: VJShow;
  /** null = let music-follow pick presets; otherwise lock this preset. */
  preset: VJPresetId | null;
  hue: number;
  intensity: number;
  trails: number;
  overlayText?: string;
  layer2?: VJLayer2;
  showCustom?: VJShowParams;
  colorMode?: VJColorMode;
  palette?: string;
  builtin?: boolean;
}
export const BUILTIN_LOOKS: VJLook[] = [
  { id: "warmup", name: "ウォームアップ", theme: "minimal", show: "cinema", preset: null, hue: 200, intensity: 0.8, trails: 0.45, builtin: true },
  { id: "peak", name: "ピーク", theme: "classic", show: "festival", preset: null, hue: 320, intensity: 1.2, trails: 0.2, builtin: true },
  { id: "breakdown", name: "ブレイクダウン", theme: "minimal", show: "minimal", preset: "rings", hue: 230, intensity: 0.7, trails: 0.5, builtin: true },
  { id: "keynote", name: "DevDay キーノート", theme: "devday", show: "keynote", preset: "dd_title", hue: 210, intensity: 1, trails: 0.2, overlayText: "OpenAI DevDay [2026] Hackathon", builtin: true },
  { id: "devday_party", name: "DevDay パーティー", theme: "devday", show: "festival", preset: null, hue: 210, intensity: 1.1, trails: 0.2, overlayText: "OpenAI DevDay [2026] Hackathon", builtin: true },
  { id: "devday_auto", name: "DevDay おまかせ", theme: "devday", show: "auto", preset: null, hue: 210, intensity: 1, trails: 0.25, overlayText: "OpenAI DevDay [2026] Hackathon", builtin: true },
  { id: "devday_layers", name: "DevDay レイヤー", theme: "free", show: "club", preset: "tunnel", hue: 213, intensity: 1, trails: 0.3, layer2: { preset: "dd_swarm", blend: "screen", opacity: 0.75 }, colorMode: "palette", palette: "devday", overlayText: "OpenAI DevDay [2026] Hackathon", builtin: true },
  { id: "psy", name: "サイケ", theme: "free", show: "festival", preset: "kaleido", hue: 300, intensity: 1.1, trails: 0.5, layer2: { preset: "plasma", blend: "difference", opacity: 0.7, mirror: true }, colorMode: "palette", palette: "neon", builtin: true },
  { id: "deep", name: "ディープ", theme: "classic", show: "cinema", preset: "starfield", hue: 205, intensity: 0.9, trails: 0.6, layer2: { preset: "rings", blend: "lighter", opacity: 0.5 }, colorMode: "palette", palette: "ocean", builtin: true },
];

export interface VJSettings {
  preset: VJPresetId;
  hue: number;
  intensity: number;
  sensitivity: number;
  autoCycle: boolean;
  mirror: boolean;
  trails: number;
  strobe: boolean;
  autoDrop: boolean;
  autoHype: boolean;
  ddTheme: "devday" | "neon" | "sunset";
  /** Music-reactive mode: hue follows the key, intensity follows energy, presets change on 8-bar phrases, drops / breakdowns are staged. */
  follow: boolean;
  /** How often Auto Hype fires (every 32 / 16 / 8 beats). */
  hypeLevel: "low" | "mid" | "high";
  /** Which presets the music-follow mode may switch between (set by the Theme). */
  pool: "auto" | "devday" | "classic" | "calm";
  /** Visual theme (look) - independent from the performance Mode. */
  theme: VJTheme;
  /** Show style (motion / pacing) - combined freely with the theme. */
  show: VJShow;
  /** Lower-third "now playing" card when a new track starts. */
  nowPlaying: boolean;
  /** Second visual layer (preset blended over the main one). */
  layer2: VJLayer2;
  /** Third layer: image / video. */
  media: VJMedia;
  /** Parameters used when show === "custom". */
  showCustom?: VJShowParams;
  /** Where the colour comes from in music-follow. */
  colorMode: VJColorMode;
  palette: string;
  /** A preset picked by hand stays on screen; music-follow then only drives colour / intensity, not the preset. */
  presetLock: boolean;
  /** Director: automatic motion-graphics post stage (camera punch / shake, cuts, RGB split, glitch, grain, letterbox). */
  director: boolean;
  /** Desktop layout: VJ column wide (default) or DJ-heavy. */
  layout?: "vj" | "dj";
  /** Persistent caption (event name, hashtag…) drawn in the corner of every preset. */
  overlayText: string;
  /** Bumped whenever the logo image stored in IndexedDB changes so canvases reload it. */
  logoVersion: number;
}

export const PAD_BANKS = 8;
export const PADS_PER_BANK = 16;
export const PAD_COUNT = PAD_BANKS * PADS_PER_BANK;
export const BANK_NAMES = ["A", "B", "C", "D", "E", "F", "G", "H"];

export const PAD_KEYS = ["1", "2", "3", "4", "q", "w", "e", "r", "a", "s", "d", "f", "z", "x", "c", "v"];

export const PAD_COLORS = ["#f43f5e", "#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899"];

export const defaultPad = (index: number): PadConfig => ({
  index,
  sampleId: null,
  name: "",
  mode: "oneshot",
  gain: 1,
  pitch: 0,
  choke: 0,
  color: PAD_COLORS[index % PAD_COLORS.length],
});

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

export type ToastKind = "info" | "success" | "error" | "progress";
