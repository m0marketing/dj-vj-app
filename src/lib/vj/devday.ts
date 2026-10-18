import type { Preset } from "./presets";

/**
 * "DevDay 2026" visual language, checked against devday.openai.com / the DevDay 2026 recap:
 * pure black, flat green #04b84c / purple #924ff7 / blue #006aff / orange #ff8549 / peach #ffc9b8 / white,
 * the wordmark "OpenAI DevDay [2026]" (DevDay in green, 2026 in purple inside white brackets, medium weight),
 * floating circles with thin emoticon eyes (o o / ^ ^ / > < / + + / - -) cropped by the circle edge,
 * and [ square brackets ]. Everything is hard-edged and opaque, so these presets ignore the hue
 * slider and clear the frame themselves. The wordmark here reads "DJ DevDay" on purpose (this is a fan
 * visual, not official OpenAI material).
 */
const C = { green: "#04b84c", purple: "#924ff7", blue: "#006aff", orange: "#ff8549", peach: "#ffc9b8", white: "#ffffff", gray: "#e4e4e4", ball: "#ffc9b8", dim: "#6b6b6b" };
const FACE_COLORS: string[] = [];
const BALL_COLORS: string[] = [];
const THEMES: Record<string, Partial<typeof C>> = {
  devday: { green: "#04b84c", purple: "#924ff7", blue: "#006aff", orange: "#ff8549", peach: "#ffc9b8", ball: "#ffc9b8" },
  neon: { green: "#39ff14", purple: "#c026ff", blue: "#00e5ff", orange: "#ff2bd6", peach: "#fff07a", ball: "#1a1a2e" },
  sunset: { green: "#ffd23f", purple: "#ff4d6d", blue: "#7b2cbf", orange: "#ff8c42", peach: "#ffe0c2", ball: "#4a1d3a" },
};
/** Re-colours every DD preset (called before each draw; cheap). */
function applyTheme(name: string) {
  Object.assign(C, THEMES[name] ?? THEMES.devday);
  FACE_COLORS.splice(0, 5, C.green, C.purple, C.blue, C.orange, C.peach);
  BALL_COLORS.splice(0, 6, C.purple, C.ball, C.green, C.white, C.blue, C.orange);
}
applyTheme("devday");
const BALL_EYES: Eyes[] = ["_", "^", "+", "o", "><", "*"];
const TAU = Math.PI * 2;
const SANS = '"Helvetica Neue","Hiragino Sans","Hiragino Kaku Gothic ProN",Inter,system-ui,sans-serif';
const MONO = '"SF Mono","Menlo","Consolas","Courier New",monospace';

interface Product {
  name: string;
  tag: string;
  jp: string;
  note: string;
  scene?: "glow" | "sun" | "warp";
}

/** Headline launches, wording checked against the official DevDay 2026 recap (openai.com/index/devday-2026-recap). */
export const PRODUCTS: Product[] = [
  { name: "Dots", scene: "glow", tag: "AGENT", jp: "常時稼働のエージェントが、継続的な役割を担う", note: "GPT-6 Astra 搭載 · 専用のクラウドコンピューター / Pro · Business Premium · Enterprise" },
  { name: "GPT-6.1 Sol", scene: "sun", tag: "MODEL", jp: "Astra に迫る知能を、5 分の 1 のトークン料金で", note: "API · Plus · Pro · Business · Enterprise · Edu" },
  { name: "Ultrafast", scene: "warp", tag: "SPEED", jp: "Codex で最大 8 倍 (毎秒 300 トークン)、API で最大 6 倍", note: "GPT-6 Astra Ultrafast: API / Pro 500 · Enterprise で提供中" },
  { name: "Private Intelligence", tag: "PRIVACY", jp: "ゼロデータ保持 × Private Safety Processing × Private Inference", note: "プライバシーを守ってフロンティア AI を活用" },
  { name: "Codex in the Cloud", tag: "CODEX", jp: "PC・スマホ・クラウド、どのデバイスからでも Codex を実行", note: "再利用できる開発環境 / Plus · Pro · Business · Enterprise · Edu" },
  { name: "Codex CLI", tag: "CODEX", jp: "音声でタスクを開始・操作、新しい /agents ビュー", note: "複数エージェントの進捗を一度に確認 / 全プラン" },
  { name: "Code Review", tag: "CODEX", jp: "差分を確認し、不在中もクラウドで初回レビュー", note: "GitHub PR / GitLab MR 対応 · ChatGPT デスクトップアプリ" },
  { name: "Codex Security Cloud", tag: "SECURITY", jp: "リポジトリ全体を継続スキャン、修正までクラウドで", note: "ノート PC を閉じていても作業が続く / Daybreak Blue のモデルを利用" },
  { name: "Decisions API", tag: "API", jp: "Luna の知能でリアルタイムに意思決定", note: "分類・振り分け・次のアクション選択 / 限定プレビュー" },
  { name: "Agents API", tag: "API", jp: "コンピューター操作とマルチエージェントをマネージドで", note: "ツール検索 · コンテキスト圧縮 / Pro 500 · Enterprise" },
  { name: "Bedrock Managed Agents", tag: "AWS", jp: "AWS 上で完結する、OpenAI 製エージェント", note: "Amazon Bedrock Managed Agents, powered by OpenAI" },
  { name: "Plugin Extensions", tag: "PLUGINS", jp: "ChatGPT の中に、アプリそのものを直接構築", note: "サイドバー · インタラクティブパネル · ファイルビューア" },
  { name: "MCP Events", tag: "PLUGINS", jp: "アプリ側の出来事で、プラグインが自動処理を開始", note: "新しいタスクを監視して計画の下書きまで" },
  { name: "ChatGPT Space", tag: "TEAMS", jp: "チーム・ChatGPT・Dot が共有知識で働く新しい拠点", note: "Pages · スライド共同編集 · @ChatGPT in Slack / Teams" },
  { name: "Pro 500", tag: "PLAN", jp: "最も高い利用上限と、OpenAI 最速の Astra Ultrafast", note: "月額 500 ドルの新しい Pro / ChatGPT Work と Codex で最大 8 倍の速度" },
  { name: "OpenAI Marketplace", tag: "PARTNERS", jp: "利用契約額の一部を、承認済みパートナーのソフトウェアに", note: "最初の 32 パートナー: Adobe · Figma · Salesforce · ServiceNow · Harvey … (ベータ)" },
];

/** Session titles from openai.com/devday/2026 (shortened to fit one line on screen). */
const SESSIONS = [
  "Opening Keynote",
  "Codex Has Left the Laptop",
  "From Single Player to Multiplayer with Codex",
  "How OpenAI Puts ChatGPT to Work",
  "Stack Overflow: From Idea to Product",
  "Higgsfield: Agents That Provision Their Own Compute",
  "Stop Overpaying for Intelligence",
  "Qodo: The Last Human Code Review",
  "ClawLabs: Building Open Source Together",
];

const hash = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clear = (ctx: CanvasRenderingContext2D, w: number, h: number, color = "#000") => {
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
};
const decay = (state: Record<string, unknown>, key: string, rate: number, bump: boolean) => {
  const v = bump ? 1 : ((state[key] as number) ?? 0) * rate;
  state[key] = v;
  return v;
};
const specAt = (f: { spectrum: Uint8Array }, frac: number) => f.spectrum[Math.min(f.spectrum.length - 1, Math.floor(frac * f.spectrum.length * 0.5))] / 255;
/** Registers one beat per frame-pair so mirror mode (which draws twice) does not double count. */
const beatTick = (state: Record<string, unknown>, beat: boolean, t: number) => {
  if (beat && t - ((state.lastBeat as number) ?? -1) > 0.05) {
    state.lastBeat = t;
    state.beats = ((state.beats as number) ?? 0) + 1;
    return true;
  }
  return false;
};

type Eyes = "o" | "x" | "><" | "-" | "^" | "+" | "*" | "_";
const isDark = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 90;
};
const eyeKind = (level: number, hit: number, t: number, seed: number): Eyes =>
  hit > 0.7 ? "><" : level > 0.55 ? "x" : (t * 0.4 + seed * 7) % 4 < 0.12 ? "-" : "o";

function glyph(ctx: CanvasRenderingContext2D, kind: Eyes, side: number, s: number) {
  ctx.beginPath();
  if (kind === "o") ctx.ellipse(0, 0, s * 0.95, s * 1.1, 0, 0, TAU);
  else if (kind === "x") {
    ctx.moveTo(-s, -s);
    ctx.lineTo(s, s);
    ctx.moveTo(s, -s);
    ctx.lineTo(-s, s);
  } else if (kind === "+") {
    ctx.moveTo(-s, 0);
    ctx.lineTo(s, 0);
    ctx.moveTo(0, -s);
    ctx.lineTo(0, s);
  } else if (kind === "*") {
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI) / 3 + Math.PI / 2;
      ctx.moveTo(-Math.cos(a) * s, -Math.sin(a) * s);
      ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
    }
  } else if (kind === "^") {
    ctx.moveTo(-s, s * 0.5);
    ctx.lineTo(0, -s * 0.6);
    ctx.lineTo(s, s * 0.5);
  } else if (kind === "><") {
    ctx.moveTo(-side * s, -s);
    ctx.lineTo(side * s * 0.6, 0);
    ctx.lineTo(-side * s, s);
  } else {
    ctx.moveTo(-s, kind === "_" ? s * 0.6 : 0);
    ctx.lineTo(s, kind === "_" ? s * 0.6 : 0);
  }
  ctx.stroke();
}

/**
 * The DevDay emoticon. "badge" (session cards): big heavy glyphs on a tilted pair that sits off-centre and is
 * cropped by the circle. "ball" (recap page): small floating ball, thin glyphs fully inside, low on the face.
 */
function face(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, kind: Eyes, t: number, seed: number, ball = false) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.strokeStyle = isDark(color) ? "#fff" : "#000";
  ctx.lineWidth = Math.max(1.5, r * (ball ? 0.07 : 0.075));
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  const ang = ball ? Math.sin(t * 0.7 + seed * 6) * 0.12 : 0.5 + Math.sin(t * 0.8 + seed * TAU) * 0.4;
  const cx = x + r * (ball ? Math.sin(t * 0.6 + seed * 9) * 0.16 : -0.28 + Math.sin(t * 0.9 + seed * 9) * 0.14);
  const cy = y + r * (ball ? 0.28 + Math.cos(t * 0.5 + seed * 5) * 0.07 : -0.26 + Math.cos(t * 0.7 + seed * 5) * 0.1);
  const half = r * (ball ? 0.5 : 0.46);
  const s = r * (ball ? 0.17 : 0.2);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(cx + Math.cos(ang) * half * side, cy + Math.sin(ang) * half * side);
    if (!ball) ctx.rotate(ang * 0.7 + (side > 0 ? 0.15 : -0.1));
    glyph(ctx, kind, side, s);
    ctx.restore();
  }
  ctx.restore();
}

/** B&W portrait badge: studio-grey backdrop, shoulders, head with hair / glasses / beard variants. */
function portrait(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, bob: number, look: number, seed: number) {
  const hairStyle = Math.floor(seed * 4) % 4; // 0 short, 1 long, 2 bald, 3 curly
  const glasses = hash(seed, 3) > 0.55;
  const beard = hash(seed, 5) > 0.7 && hairStyle !== 1;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.clip();
  const bg = ctx.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r * 1.1);
  bg.addColorStop(0, "#f0f0f0");
  bg.addColorStop(1, "#c8c8c8");
  ctx.fillStyle = bg;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  const hx = x + look * r * 0.05;
  const hy = y - r * 0.12 + bob * r;
  if (hairStyle === 1) {
    ctx.fillStyle = "#2a2a2a";
    ctx.beginPath();
    ctx.ellipse(hx, hy + r * 0.12, r * 0.42, r * 0.58, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#4b4b4b";
  ctx.beginPath();
  ctx.ellipse(x, y + r * 1.0 + bob * r * 0.5, r * 0.82, r * 0.52, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#9a9a9a";
  ctx.fillRect(hx - r * 0.1, hy + r * 0.2, r * 0.2, r * 0.3);
  const sk = ctx.createLinearGradient(hx - r * 0.3, 0, hx + r * 0.3, 0);
  sk.addColorStop(0, "#a9a9a9");
  sk.addColorStop(1, "#7d7d7d");
  ctx.fillStyle = sk;
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.29, r * 0.37, 0, 0, TAU);
  ctx.fill();
  if (hairStyle !== 2) {
    ctx.fillStyle = hairStyle === 3 ? "#1e1e1e" : "#2f2f2f";
    ctx.beginPath();
    if (hairStyle === 3) {
      for (let k = 0; k < 9; k++) {
        const a = Math.PI + (k / 8) * Math.PI;
        ctx.moveTo(hx + Math.cos(a) * r * 0.3 + r * 0.14, hy - r * 0.05 + Math.sin(a) * r * 0.4);
        ctx.arc(hx + Math.cos(a) * r * 0.3, hy - r * 0.05 + Math.sin(a) * r * 0.4, r * 0.14, 0, TAU);
      }
    } else ctx.ellipse(hx, hy - r * 0.22, r * 0.31, r * 0.2, 0, Math.PI, TAU);
    ctx.fill();
  }
  if (beard) {
    ctx.fillStyle = "#3a3a3a";
    ctx.beginPath();
    ctx.ellipse(hx, hy + r * 0.2, r * 0.25, r * 0.17, 0, 0, Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = "#1a1a1a";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + side * r * 0.11, hy - r * 0.03, r * 0.03, r * 0.022, 0, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = "#e8e8e8";
  ctx.beginPath();
  ctx.ellipse(hx, hy + r * 0.2, r * 0.09, r * 0.03 + Math.abs(bob) * r * 0.4, 0, 0, Math.PI);
  ctx.fill();
  if (glasses) {
    ctx.strokeStyle = "#151515";
    ctx.lineWidth = r * 0.025;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.rect(hx + side * r * 0.11 - r * 0.075, hy - r * 0.095, r * 0.15, r * 0.12);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const faceColor = (seed: number) => FACE_COLORS[Math.floor(seed * FACE_COLORS.length) % FACE_COLORS.length];

/** Fit `text` into maxW and maxH (px); returns the font size. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: number, maxW: number, maxH: number, family = SANS) {
  ctx.font = `${weight} 100px ${family}`;
  return Math.min((maxW / Math.max(1, ctx.measureText(text).width)) * 100, maxH);
}
function lines2(ctx: CanvasRenderingContext2D, text: string, weight: number, maxW: number, maxH: number): { lines: string[]; size: number } {
  const one = fit(ctx, text, weight, maxW, maxH);
  const i = text.lastIndexOf(" ");
  if (one > maxH * 0.62 || i < 0) return { lines: [text], size: one };
  const mid = text.length / 2;
  let best = text.indexOf(" ");
  for (let k = 0; k < text.length; k++) if (text[k] === " " && Math.abs(k - mid) < Math.abs(best - mid)) best = k;
  const a = text.slice(0, best);
  const b = text.slice(best + 1);
  const two = Math.min(fit(ctx, a, weight, maxW, maxH / 1.9), fit(ctx, b, weight, maxW, maxH / 1.9));
  return two > one ? { lines: [a, b], size: two } : { lines: [text], size: one };
}
function wrapJP(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const out: string[] = [];
  let cur = "";
  for (const ch of Array.from(text)) {
    if (ctx.measureText(cur + ch).width > maxW && cur) {
      out.push(cur);
      cur = ch;
      if (out.length === maxLines) break;
    } else cur += ch;
  }
  if (cur && out.length < maxLines) out.push(cur);
  return out;
}

/** Floating DevDay-recap balls: small flat spheres with thin glyph eyes that hop on the beat. */
function balls(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, state: Record<string, unknown>, beat: boolean, hit: number, level: number) {
  type Ball = { x: number; y: number; vx: number; vy: number; r: number; c: number };
  let bs = state.balls as Ball[] | undefined;
  if (!bs) {
    bs = Array.from({ length: 7 }, (_, i) => ({
      x: (0.1 + hash(i, 1) * 0.8) * w,
      y: (0.1 + hash(i, 2) * 0.8) * h,
      vx: (hash(i, 3) - 0.5) * 0.4,
      vy: (hash(i, 4) - 0.5) * 0.4,
      r: h * (0.04 + hash(i, 5) * 0.03),
      c: i % 6,
    }));
    state.balls = bs;
  }
  bs.forEach((b, i) => {
    if (beat && hash(i, Math.floor(t)) > 0.35) {
      b.vy -= 2 + level * 3;
      b.vx += (hash(i, Math.floor(t * 3)) - 0.5) * 3;
    }
    b.vy += 0.03;
    b.vx *= 0.985;
    b.vy *= 0.985;
    b.x += b.vx;
    b.y += b.vy;
    if (b.x < b.r) {
      b.x = b.r;
      b.vx = Math.abs(b.vx);
    }
    if (b.x > w - b.r) {
      b.x = w - b.r;
      b.vx = -Math.abs(b.vx);
    }
    if (b.y < b.r) {
      b.y = b.r;
      b.vy = Math.abs(b.vy);
    }
    if (b.y > h - b.r) {
      b.y = h - b.r;
      b.vy = -Math.abs(b.vy) * 0.9 - 0.4;
    }
    const dx = (b.x - w / 2) / (w * 0.32);
    const dy = (b.y - h * 0.48) / (h * 0.2);
    if (dx * dx + dy * dy < 1) {
      b.vx += dx * 0.12;
      b.vy += dy * 0.12;
    }
    face(ctx, b.x, b.y, b.r * (1 + hit * 0.08), BALL_COLORS[b.c], hit > 0.75 ? "><" : BALL_EYES[b.c], t, i / 7, true);
  });
}

function starfield(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, state: Record<string, unknown>, n: number) {
  type Star = { x: number; y: number; r: number; p: number };
  const key = `stars${n}`;
  const st = ((state[key] as Star[]) ??= Array.from({ length: n }, (_, i) => ({ x: hash(i, 7), y: hash(i, 8), r: 0.4 + hash(i, 9) * 1.6, p: hash(i, 10) * TAU })));
  for (const s of st) {
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.p))})`;
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r * (h / 700), 0, TAU);
    ctx.fill();
  }
}

/** Glowing sun with a diagonal dust band, like the GPT-6.1 Sol key art. */
function sun(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: number, level: number) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const ang = -0.45;
  for (let i = 0; i < 160; i++) {
    const u = hash(i, 11) * 2 - 1;
    const off = (hash(i, 12) - 0.5) * (0.5 - Math.abs(u) * 0.35) * r * 1.3;
    const d = u * r * 5.5;
    const x = cx + Math.cos(ang) * d - Math.sin(ang) * off;
    const y = cy + Math.sin(ang) * d + Math.cos(ang) * off;
    const hot = hash(i, 13);
    ctx.fillStyle = hot > 0.9 ? "rgba(120,170,255,0.9)" : hot > 0.75 ? "rgba(255,170,90,0.9)" : `rgba(255,255,255,${0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 2 + i))})`;
    ctx.beginPath();
    ctx.arc(x, y, (0.6 + hash(i, 14) * 2.2) * (r / 100), 0, TAU);
    ctx.fill();
  }
  const g = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.6);
  g.addColorStop(0, `rgba(255,214,120,${0.55 + level * 0.3})`);
  g.addColorStop(1, "rgba(255,160,60,0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r * 3, cy - r * 3, r * 6, r * 6);
  ctx.globalCompositeOperation = "source-over";
  const core = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, r * 0.1, cx, cy, r);
  core.addColorStop(0, "#fffbe8");
  core.addColorStop(0.8, "#ffe9a8");
  core.addColorStop(1, "#ffc864");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** Hyperspace streaks radiating from the centre (Ultrafast key art). */
function warp(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, state: Record<string, unknown>, level: number, hit: number) {
  type Streak = { a: number; z: number; l: number };
  const st = ((state.warp as Streak[]) ??= Array.from({ length: 170 }, (_, i) => ({ a: hash(i, 21) * TAU, z: hash(i, 22), l: 0.04 + hash(i, 23) * 0.12 })));
  const R = Math.hypot(w, h) / 2;
  const sp = 0.004 + level * 0.03 + hit * 0.02;
  ctx.save();
  ctx.lineCap = "round";
  for (const s of st) {
    s.z += sp * (0.4 + s.l * 4);
    if (s.z > 1) {
      s.z = 0;
      s.a = Math.random() * TAU;
    }
    const r0 = Math.pow(s.z, 2.2) * R;
    const r1 = Math.pow(Math.min(1, s.z + s.l * (0.3 + level * 3)), 2.2) * R;
    ctx.strokeStyle = `rgba(255,255,255,${0.15 + s.z * 0.85})`;
    ctx.lineWidth = 0.6 + s.z * 2.4;
    ctx.beginPath();
    ctx.moveTo(w / 2 + Math.cos(s.a) * r0, h / 2 + Math.sin(s.a) * r0);
    ctx.lineTo(w / 2 + Math.cos(s.a) * r1, h / 2 + Math.sin(s.a) * r1);
    ctx.stroke();
  }
  ctx.restore();
}


const baseDevdayPresets: Preset[] = [
  {
    id: "dd_faces",
    name: "DD Circles",
    draw({ ctx, w, h, f, s, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const cols = 7;
      const d = w / cols;
      const rows = Math.ceil(h / d) + 1;
      const oy = (h - rows * d) / 2;
      const key = `${cols}x${rows}`;
      if (state.key !== key) {
        state.key = key;
        state.cells = Array.from({ length: cols * rows }, () => ({ seed: Math.random(), pop: 0 }));
      }
      const cells = state.cells as { seed: number; pop: number }[];
      const hit = decay(state, "hit", 0.88, f.beat);
      if (f.beat) {
        const n = 2 + Math.floor(f.bass * 6);
        for (let k = 0; k < n; k++) {
          const c = cells[Math.floor(Math.random() * cells.length)];
          c.seed = Math.random();
          c.pop = 1;
        }
      }
      cells.forEach((c, idx) => {
        const i = idx % cols;
        const j = Math.floor(idx / cols);
        c.pop *= 0.9;
        const v = Math.min(1, specAt(f, idx / cells.length) * s.intensity * 1.2);
        const r = (d / 2) * (0.97 + 0.03 * v);
        const x = (i + 0.5) * d;
        const y = oy + (j + 0.5) * d;
        if (c.seed < 0.58) portrait(ctx, x, y, r, Math.sin(t * 4 + idx) * 0.03 * (0.3 + f.bass) + hit * 0.04, Math.sin(t * 0.7 + i), c.seed / 0.58);
        else face(ctx, x, y, r, c.pop > 0.35 ? "#fff" : faceColor((c.seed - 0.58) / 0.42), eyeKind(f.level, hit * (c.pop > 0.2 ? 1 : 0.3), t, c.seed), t, c.seed);
      });
      ctx.restore();
    },
  },
  {
    id: "dd_title",
    name: "DD Title",
    draw({ ctx, w, h, f, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const hit = decay(state, "hit", 0.9, f.beat);
      beatTick(state, f.beat, t);
      const beats = (state.beats as number) ?? 0;
      const idx = Math.floor(beats / 8) % SESSIONS.length;
      if (state.idx !== idx) {
        state.idx = idx;
        state.subT0 = t;
      }
      balls(ctx, w, h, t, state, f.beat, hit, f.level);

      // Wordmark: [ ] clamp apart with the bass; sliced sideways on strong hits.
      ctx.font = `500 100px ${SANS}`;
      const unit = ctx.measureText("DJ DevDay [2026]").width / 100;
      const size = Math.min(h * 0.26, (w * 0.92) / (unit + 1.4));
      const y = h * 0.52;
      ctx.font = `500 ${size}px ${SANS}`;
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      const gap = size * 0.08 + f.bass * size * 0.5 + hit * size * 0.12;
      const parts: [string, string][] = [["DJ ", C.white], ["DevDay", C.green]];
      const widths = parts.map(([a]) => ctx.measureText(a).width);
      const total = widths[0] + widths[1] + ctx.measureText(" [").width + gap + ctx.measureText("2026").width + gap + ctx.measureText("]").width;
      const x0 = (w - total) / 2;
      const bands = 3;
      for (let k = 0; k < bands; k++) {
        const shift = hit > 0.6 ? (hash(k, Math.floor(t * 30)) - 0.5) * w * 0.05 * hit : 0;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y - size * 0.85 + (k * size) / bands, w, size / bands + 1);
        ctx.clip();
        let x = x0 + shift;
        parts.forEach(([a, col], i) => {
          ctx.fillStyle = col;
          ctx.fillText(a, x, y);
          x += widths[i];
        });
        ctx.fillStyle = C.white;
        ctx.fillText(" [", x, y);
        x += ctx.measureText(" [").width + gap;
        ctx.fillStyle = C.purple;
        ctx.fillText("2026", x, y);
        x += ctx.measureText("2026").width + gap;
        ctx.fillStyle = C.white;
        ctx.fillText("]", x, y);
        ctx.restore();
      }

      // Session line (typewriter) + BPM.
      const sub = SESSIONS[idx];
      const n = Math.floor((t - ((state.subT0 as number) ?? t)) * 42);
      ctx.textAlign = "center";
      ctx.fillStyle = C.white;
      ctx.font = `500 ${h * 0.05}px ${SANS}`;
      ctx.fillText(sub.slice(0, Math.max(0, n)), w / 2, y + h * 0.13);
      ctx.fillStyle = C.dim;
      ctx.font = `${h * 0.03}px ${MONO}`;
      ctx.fillText(f.bpm ? `[ ${f.bpm} BPM ]` : "[ LIVE ]", w / 2, y + h * 0.2);
      ctx.restore();
    },
  },
  {
    id: "dd_products",
    name: "DD Products",
    draw({ ctx, w, h, f, s, t, state }) {
      ctx.save();
      const k = s.strobe ? 1 : 0.35;
      const hit = decay(state, "hit", 0.88, f.beat);
      beatTick(state, f.beat, t);
      const beats = (state.beats as number) ?? 0;
      const idx0 = (state.idx as number) ?? 0;
      const t0 = (state.t0 as number) ?? t;
      const beatsAt = (state.beatsAt as number) ?? 0;
      let idx = idx0;
      let start = t0;
      if (state.idx === undefined || (beats - beatsAt >= 8 && t - t0 > 2.5) || t - t0 > 9) {
        idx = state.idx === undefined ? 0 : (idx0 + 1) % PRODUCTS.length;
        start = t;
        state.idx = idx;
        state.t0 = t;
        state.beatsAt = beats;
      }
      const p = PRODUCTS[idx];
      const scene = p.scene ?? (idx % 2 ? "card" : "balls");
      const accent = FACE_COLORS[idx % FACE_COLORS.length];
      const since = t - start;
      const enter = clamp01(since / 0.35);
      clear(ctx, w, h);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "center";
      const cx = w / 2;
      const cy = h / 2;
      const pulse = 1 + hit * 0.012 * k + (1 - enter) * 0.05;
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      ctx.translate(-cx, -cy);

      const tagLine = () => {
        ctx.fillStyle = C.dim;
        ctx.font = `${h * 0.03}px ${MONO}`;
        ctx.fillText(`DevDay 2026  ·  ${p.tag}  ·  ${String(idx + 1).padStart(2, "0")}/${PRODUCTS.length}`, cx, h * 0.38);
      };
      const desc = (y: number, col = C.dim) => {
        ctx.fillStyle = col;
        ctx.font = `400 ${h * 0.04}px ${SANS}`;
        wrapJP(ctx, p.jp, w * 0.6, 2).forEach((l, i) => ctx.fillText(l, cx, y + i * h * 0.058));
        ctx.font = `${h * 0.026}px ${MONO}`;
        ctx.fillStyle = "#555";
        ctx.fillText(p.note.slice(0, Math.floor((w * 0.7) / (h * 0.016))), cx, y + h * 0.14);
      };

      if (scene === "sun") {
        starfield(ctx, w, h, t, state, 140);
        sun(ctx, cx, cy - h * 0.04, h * (0.17 + f.bass * 0.015 + hit * 0.01), t, f.level);
        const [a, b] = p.name.split(" ");
        const size = Math.min(h * 0.14, fit(ctx, p.name, 600, w * 0.36, h * 0.14));
        ctx.font = `600 ${size}px ${SANS}`;
        ctx.fillStyle = C.white;
        ctx.textAlign = "left";
        ctx.fillText(a, w * 0.05, cy);
        ctx.textAlign = "right";
        ctx.fillText(b, w * 0.95, cy);
        ctx.textAlign = "center";
        desc(h * 0.8);
      } else if (scene === "warp") {
        warp(ctx, w, h, t, state, f.level, hit);
        const size = Math.min(h * 0.24, fit(ctx, p.name, 700, w * 0.6, h * 0.24));
        ctx.font = `700 ${size}px ${SANS}`;
        ctx.fillStyle = C.white;
        ctx.shadowColor = "rgba(255,255,255,0.8)";
        ctx.shadowBlur = size * 0.12;
        ctx.fillText(p.name, cx, cy + size * 0.1);
        ctx.shadowBlur = 0;
        ctx.fillStyle = C.white;
        ctx.font = `600 ${h * 0.04}px ${SANS}`;
        wrapJP(ctx, p.jp, w * 0.5, 2).forEach((l, i) => ctx.fillText(l, cx, cy + size * 0.1 + h * 0.1 + i * h * 0.055));
      } else if (scene === "glow") {
        starfield(ctx, w, h, t, state, 60);
        const size = Math.min(h * 0.26, fit(ctx, p.name, 700, w * 0.5, h * 0.26));
        ctx.font = `700 ${size}px ${SANS}`;
        const spread = size * (0.025 + f.bass * 0.03 + hit * 0.02);
        ctx.globalCompositeOperation = "lighter";
        const rainbow = ["#ff3b6b", "#ffb12b", "#2bff88", "#2b9bff", "#a24bff"];
        rainbow.forEach((col, i) => {
          const a = (i / rainbow.length) * TAU + t * 0.8;
          ctx.shadowColor = col;
          ctx.shadowBlur = size * 0.2;
          ctx.fillStyle = col;
          ctx.globalAlpha = 0.55;
          ctx.fillText(p.name, cx + Math.cos(a) * spread, cy + Math.sin(a) * spread);
        });
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = C.white;
        ctx.fillText(p.name, cx, cy);
        desc(cy + h * 0.14, "#9a9a9a");
      } else if (scene === "card") {
        const r = h * 0.4;
        face(ctx, w - r * 0.6, cy, r, accent, eyeKind(f.level, hit, t, idx / 14), t, idx / 14);
        ctx.textAlign = "left";
        const px = w * 0.07;
        ctx.fillStyle = C.dim;
        ctx.font = `${h * 0.03}px ${MONO}`;
        ctx.fillText(`[ ${String(idx + 1).padStart(2, "0")} / ${PRODUCTS.length} ]  ${p.tag}`, px, h * 0.26);
        const { lines, size } = lines2(ctx, p.name, 600, w * 0.6, h * 0.22);
        ctx.fillStyle = C.white;
        ctx.font = `600 ${size}px ${SANS}`;
        lines.forEach((l, i) => ctx.fillText(l, px, h * 0.26 + h * 0.05 + size * 0.85 + i * size * 0.95));
        const dy = h * 0.26 + h * 0.05 + size * 0.85 + (lines.length - 1) * size * 0.95 + h * 0.1;
        ctx.fillStyle = "#9a9a9a";
        ctx.font = `400 ${h * 0.04}px ${SANS}`;
        wrapJP(ctx, p.jp, w * 0.5, 3).forEach((l, i) => ctx.fillText(l, px, dy + i * h * 0.058));
        ctx.font = `${h * 0.026}px ${MONO}`;
        ctx.fillStyle = "#555";
        ctx.fillText(p.note.slice(0, Math.floor((w * 0.55) / (h * 0.016))), px, dy + h * 0.2);
      } else {
        balls(ctx, w, h, t, state, f.beat, hit, f.level);
        tagLine();
        const size = Math.min(h * 0.17, fit(ctx, p.name, 600, w * 0.55, h * 0.17));
        ctx.font = `600 ${size}px ${SANS}`;
        ctx.fillStyle = C.white;
        ctx.fillText(p.name, cx, cy + size * 0.2);
        desc(cy + size * 0.2 + h * 0.1);
      }

      // Fade-in from black on each product change.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.restore();
      ctx.save();
      if (enter < 1) {
        ctx.fillStyle = `rgba(0,0,0,${1 - enter})`;
        ctx.fillRect(0, 0, w, h);
      }
      if (hit > 0.7 && k === 1 && scene !== "sun") {
        ctx.fillStyle = `rgba(255,255,255,${(hit - 0.7) * 0.12})`;
        ctx.fillRect(0, 0, w, h);
      }
      ctx.restore();
    },
  },
  {
    id: "dd_ticker",
    name: "DD Ticker",
    draw({ ctx, w, h, f, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const hit = decay(state, "hit", 0.85, f.beat);
      beatTick(state, f.beat, t);
      const rows = 5;
      const rh = h / rows;
      const dt = Math.min(0.1, Math.max(0, t - ((state.lt as number) ?? t)));
      state.lt = t;
      const pos = ((state.pos as number[]) ??= Array.from({ length: rows }, () => Math.random() * 1000));
      const kick = decay(state, "kick", 0.9, f.beat);
      if (f.beat) {
        state.hot = Math.floor(Math.random() * rows);
        state.hotColor = Math.floor(Math.random() * FACE_COLORS.length);
        if (f.bass > 0.6) state.pop = 1;
      }
      const pop = ((state.pop as number) ?? 0) * 0.92;
      state.pop = pop;
      const hot = hit > 0.35 ? (state.hot as number) : -1;
      const names = PRODUCTS.map((q) => q.name.toUpperCase());
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      ctx.font = `700 ${rh * 0.8}px ${SANS}`;
      for (let i = 0; i < rows; i++) {
        const dir = i % 2 ? 1 : -1;
        pos[i] += dir * dt * (rh * 0.9 + f.level * rh * 5 + kick * rh * 4);
        const rot = names.slice((i * 3) % names.length).concat(names.slice(0, (i * 3) % names.length));
        const text = rot.join("  [ ]  ") + "  [ ]  ";
        const tw = ctx.measureText(text).width;
        const x = (((pos[i] % tw) + tw) % tw) * -1;
        const y = i * rh + rh * 0.8;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, i * rh, w, rh);
        ctx.clip();
        const isHot = i === hot;
        if (isHot) {
          ctx.fillStyle = FACE_COLORS[(state.hotColor as number) % FACE_COLORS.length];
          ctx.fillRect(0, i * rh, w, rh);
        }
        const mode = i % 4;
        ctx.lineWidth = Math.max(2, rh * 0.03);
        ctx.lineJoin = "miter";
        for (const ox of [x, x + tw]) {
          if (isHot) {
            ctx.fillStyle = "#000";
            ctx.fillText(text, ox, y);
          } else if (mode === 0 || mode === 2) {
            ctx.fillStyle = mode === 0 ? C.white : C.purple;
            ctx.fillText(text, ox, y);
          } else {
            ctx.strokeStyle = mode === 1 ? C.green : C.white;
            ctx.strokeText(text, ox, y);
          }
        }
        ctx.restore();
        ctx.fillStyle = C.dim;
        ctx.fillRect(0, i * rh, w, 1);
      }
      if (pop > 0.02) {
        const r = h * 0.32 * (0.6 + 0.4 * Math.min(1, pop * 1.6));
        face(ctx, w / 2, h / 2, r, FACE_COLORS[Math.floor(((state.beats as number) ?? 0) % FACE_COLORS.length)], "><", t, 0.42);
      }
      ctx.restore();
    },
  },
  {
    id: "dd_stack",
    name: "DD Stack",
    draw({ ctx, w, h, f, s, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const d = h / 4;
      const cols = Math.ceil(w / d) + 1;
      const ox = (w - (cols - 1) * d) / 2;
      const hit = decay(state, "hit", 0.88, f.beat);
      type Col = { pos: number; target: number };
      if (state.cols == null || (state.cols as Col[]).length !== cols) state.cols = Array.from({ length: cols }, () => ({ pos: 0, target: 0 }));
      const colsState = state.cols as Col[];
      if (f.beat) {
        const all = f.bass > 0.55;
        colsState.forEach((c, i) => {
          if (all || Math.random() < 0.35) c.target += d * (i % 2 ? -1 : 1);
        });
      }
      for (let c = 0; c < cols; c++) {
        const col = colsState[c];
        col.pos += (col.target - col.pos) * 0.18 + (c % 2 ? -1 : 1) * (0.2 + f.level * 1.2);
        col.target += (c % 2 ? -1 : 1) * (0.2 + f.level * 1.2);
        const x = ox + c * d;
        const first = Math.floor(col.pos / d) - 1;
        const count = Math.ceil(h / d) + 3;
        for (let k = first; k < first + count; k++) {
          const y = k * d - col.pos + d / 2;
          const seed = hash(c, k);
          const v = Math.min(1, specAt(f, (c + 0.5) / cols) * s.intensity * 1.2);
          const r = (d / 2) * (0.985 + 0.015 * v);
          if (seed < 0.62) portrait(ctx, x, y, r, Math.sin(t * 4 + c + k) * 0.03 * (0.3 + f.bass) + hit * 0.04, Math.sin(t * 0.7 + c), seed / 0.62);
          else face(ctx, x, y, r, faceColor((seed - 0.62) / 0.38), eyeKind(f.level, hit, t, seed), t, seed);
        }
      }
      ctx.restore();
    },
  },
  {
    id: "dd_terminal",
    name: "DD Terminal",
    draw({ ctx, w, h, f, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      type Seg = [string, string];
      type Line = { segs: Seg[]; t0: number };
      const lines = ((state.lines as Line[]) ??= []);
      const n = (state.n as number) ?? 0;
      const last = (state.last as number) ?? -10;
      const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
      if ((f.beat && t - last > 0.05) || t - last > 1.4) {
        const tasks = ["fix-incident-0200", "review-pr-482", "ship-release", "summarize-standup", "migrate-db", "cut-token-cost"];
        const prod = pick(PRODUCTS);
        const k = n % 6;
        const segs: Seg[] =
          k === 0
            ? [["$ ", C.green], ["codex cloud run ", C.white], [`--task ${pick(tasks)}`, C.purple]]
            : k === 1
              ? [["[ ", C.white], [`${Math.floor(20 + Math.random() * 80)}%`, C.purple], [" ] ", C.white], [`agents running: ${1 + Math.floor(Math.random() * 12)}`, C.dim]]
              : k === 2
                ? [["✓ ", C.green], [`${Math.floor(80 + Math.random() * 320)} tests passed`, C.white]]
                : k === 3
                  ? [["★ ", C.orange], ["launch ", C.white], [prod.name, C.green], [` [${prod.tag}]`, C.purple]]
                  : k === 4
                    ? [["→ ", C.purple], ["deploying to ", C.white], ["prod", C.green], [" ...", C.dim]]
                    : [["$ ", C.green], ["git push origin ", C.white], ["main", C.purple]];
        lines.push({ segs, t0: t });
        state.n = n + 1;
        state.last = t;
      }
      const lh = h / 20;
      const maxLines = Math.floor((h * 0.78) / lh);
      while (lines.length > maxLines) lines.shift();
      ctx.font = `${lh * 0.72}px ${MONO}`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const cw = ctx.measureText("M").width;
      const x0 = w * 0.06;
      let endX = x0;
      let endY = h * 0.08;
      lines.forEach((L, i) => {
        let left = Math.floor((t - L.t0) * 70);
        let x = x0;
        const y = h * 0.08 + i * lh;
        for (const [str, col] of L.segs) {
          if (left <= 0) break;
          const part = str.slice(0, left);
          ctx.fillStyle = col;
          ctx.fillText(part, x, y);
          x += part.length * cw;
          left -= part.length;
        }
        endX = x;
        endY = y;
      });
      if (Math.floor(t * 2) % 2 === 0) {
        ctx.fillStyle = C.purple;
        ctx.fillRect(endX + cw * 0.2, endY - lh * 0.35, cw * 0.7, lh * 0.7);
      }
      const blocks = "▁▂▃▄▅▆▇█";
      const cols = Math.min(64, Math.floor((w * 0.88) / cw));
      for (let i = 0; i < cols; i++) {
        const v = Math.min(1, specAt(f, i / cols) * 1.25);
        ctx.fillStyle = `rgb(${Math.round(4 + (146 - 4) * (i / cols))},${Math.round(184 + (79 - 184) * (i / cols))},${Math.round(76 + (247 - 76) * (i / cols))})`;
        ctx.fillText(blocks[Math.min(7, Math.floor(v * 8))], x0 + i * cw, h * 0.9);
      }
      const barN = 24;
      const filled = Math.round(Math.min(1, f.level * 1.6) * barN);
      let x = x0;
      for (const [str, col] of [
        ["[", C.white],
        ["█".repeat(filled), C.green],
        ["░".repeat(barN - filled), C.dim],
        ["] ", C.white],
        [`${Math.round(Math.min(1, f.level * 1.6) * 100)}%`, C.purple],
      ] as Seg[]) {
        ctx.fillStyle = col;
        ctx.fillText(str, x, h * 0.95);
        x += str.length * cw;
      }
      ctx.textAlign = "right";
      ctx.fillStyle = C.dim;
      ctx.fillText(f.bpm ? `${f.bpm} BPM` : "listening…", w - w * 0.06, h * 0.95);
      ctx.restore();
    },
  },
  {
    id: "dd_brackets",
    name: "DD Brackets",
    draw({ ctx, w, h, f, s, state }) {
      ctx.save();
      clear(ctx, w, h);
      const n = 20;
      const hit = decay(state, "hit", 0.85, f.beat);
      const hist = ((state.hist as Float32Array[]) ??= []);
      const snap = new Float32Array(n);
      for (let i = 0; i < n; i++) snap[i] = Math.min(1, Math.pow(specAt(f, Math.pow(i / n, 1.6)), 0.7) * 1.4 * s.intensity);
      hist.unshift(snap);
      if (hist.length > 16) hist.pop();
      const cell = w / n;
      const rowGap = h * 0.27;
      const pal = [C.green, C.purple, C.white, C.orange, C.blue, C.peach];
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      for (const r of [1, -1, 0]) {
        const row = hist[Math.min(hist.length - 1, Math.abs(r) * 6)];
        const cy = h / 2 + r * rowGap;
        ctx.globalAlpha = r === 0 ? 1 : 0.55;
        for (let i = 0; i < n; i++) {
          const v = row[i];
          const cx = (i + 0.5) * cell;
          const half = cell * (0.1 + v * 0.34 + hit * 0.04);
          const bh = cell * (0.38 + v * 0.55);
          const arm = cell * 0.14;
          ctx.strokeStyle = pal[(i + Math.abs(r)) % pal.length];
          ctx.lineWidth = Math.max(2, cell * 0.075);
          ctx.beginPath();
          ctx.moveTo(cx - half + arm, cy - bh);
          ctx.lineTo(cx - half, cy - bh);
          ctx.lineTo(cx - half, cy + bh);
          ctx.lineTo(cx - half + arm, cy + bh);
          ctx.moveTo(cx + half - arm, cy - bh);
          ctx.lineTo(cx + half, cy - bh);
          ctx.lineTo(cx + half, cy + bh);
          ctx.lineTo(cx + half - arm, cy + bh);
          ctx.stroke();
          ctx.fillStyle = i % 2 ? C.blue : C.purple;
          ctx.beginPath();
          ctx.arc(cx, cy, cell * 0.11 * (0.4 + v * 1.9), 0, TAU);
          ctx.fill();
        }
      }
      ctx.restore();
    },
  },
  {
    // Kinetic launch typography: every phrase a product name slams in with a flash, the bracket pair snaps around it,
    // the Japanese line types in underneath; on the drop the whole word shatters into dots.
    id: "dd_launch",
    name: "DD Launch",
    draw({ ctx, w, h, f, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const hit = decay(state, "hit", 0.86, f.beat);
      const beat = beatTick(state, f.beat, t);
      const beats = (state.beats as number) ?? 0;
      const idx = Math.floor(beats / 16) % PRODUCTS.length;
      if (state.idx !== idx) {
        state.idx = idx;
        state.slamAt = t;
        state.col = [C.green, C.purple, C.blue, C.orange][idx % 4];
      }
      const since = t - ((state.slamAt as number) ?? t);
      const p = PRODUCTS[idx];
      const col = (state.col as string) ?? C.green;
      // Flash frame on the slam
      if (since < 0.12) {
        ctx.fillStyle = col;
        ctx.globalAlpha = 1 - since / 0.12;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      // Tag line (small, mono) sliding in from the left
      const slide = clamp01(since / 0.35);
      const ease = 1 - Math.pow(1 - slide, 3);
      ctx.font = `600 ${h * 0.03}px ${MONO}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = col;
      ctx.fillText(`[ ${p.tag} ]  ${String(idx + 1).padStart(2, "0")} / ${PRODUCTS.length}`, w * 0.08 - (1 - ease) * w * 0.3, h * 0.26);
      // Product name: slams from oversized to final size, with a kick-driven micro punch
      const scale = 1 + (1 - ease) * 1.6 + hit * 0.04 + f.bass * 0.03;
      const { lines, size } = lines2(ctx, p.name, 800, w * 0.84, h * 0.3);
      ctx.save();
      ctx.translate(w * 0.08, h * 0.5);
      ctx.scale(scale, scale);
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${size}px ${SANS}`;
      ctx.textBaseline = "alphabetic";
      lines.forEach((ln, i) => ctx.fillText(ln, 0, (i - (lines.length - 1) / 2) * size * 1.02 + size * 0.36));
      ctx.restore();
      // Bracket pair snapping around the name
      const tw = Math.max(...lines.map((ln) => (ctx.font = `800 ${size}px ${SANS}`, ctx.measureText(ln).width)));
      const bx0 = w * 0.08 - size * 0.25;
      const bx1 = w * 0.08 + tw + size * 0.25;
      const by = h * 0.5 - size * 0.5 * lines.length - size * 0.1;
      const bh = size * 1.02 * lines.length + size * 0.4;
      const open = 1 + (1 - clamp01(since / 0.5)) * 0.6;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(3, size * 0.07);
      const arm = size * 0.28;
      for (const [x, dir] of [
        [w * 0.5 - (w * 0.5 - bx0) * open, 1],
        [w * 0.5 + (bx1 - w * 0.5) * open, -1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(x + dir * arm, by);
        ctx.lineTo(x, by);
        ctx.lineTo(x, by + bh);
        ctx.lineTo(x + dir * arm, by + bh);
        ctx.stroke();
      }
      // Japanese line typing in
      const jpSize = h * 0.045;
      ctx.font = `500 ${jpSize}px ${SANS}`;
      const chars = Math.floor(clamp01((since - 0.3) / 1.2) * p.jp.length);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.jp.slice(0, chars) + (chars < p.jp.length && Math.floor(t * 6) % 2 ? "▌" : ""), w * 0.08, h * 0.5 + size * 0.6 * lines.length + jpSize * 1.4);
      ctx.font = `400 ${h * 0.026}px ${MONO}`;
      ctx.fillStyle = C.gray;
      ctx.globalAlpha = clamp01((since - 1.4) / 0.6);
      ctx.fillText(p.note, w * 0.08, h * 0.5 + size * 0.6 * lines.length + jpSize * 2.9);
      ctx.globalAlpha = 1;
      // Beat dots marching along the bottom (one per beat of the phrase)
      const dots = 16;
      for (let i = 0; i < dots; i++) {
        const on = i <= beats % 16;
        ctx.fillStyle = on ? col : "#2a2a2a";
        ctx.beginPath();
        ctx.arc(w * 0.08 + i * (w * 0.84) / (dots - 1), h * 0.16, h * (on && i === beats % 16 && beat ? 0.012 : 0.007), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    },
  },
  {
    // Swarm: a few hundred DevDay dots (circles with eyes) flock around, and on every phrase they gather into a
    // word ("DevDay", "2026", "[ ]", "OpenAI") sampled from a text mask, then scatter on the next drop.
    id: "dd_swarm",
    name: "DD Swarm",
    draw({ ctx, w, h, f, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const WORDS = ["DevDay", "[2026]", "OpenAI", "Codex", "dots"];
      type P = { x: number; y: number; vx: number; vy: number; tx: number; ty: number; c: string; seed: number };
      const N = 220;
      if (!state.pts || state.w !== w) {
        state.w = w;
        state.pts = Array.from({ length: N }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: 0, vy: 0, tx: 0, ty: 0, c: BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)], seed: Math.random() }));
        state.word = -1;
      }
      const pts = state.pts as P[];
      beatTick(state, f.beat, t);
      const beats = (state.beats as number) ?? 0;
      const phase = Math.floor(beats / 8) % 2; // gather on even phrases, scatter on odd
      const word = Math.floor(beats / 16) % WORDS.length;
      if (state.word !== word || state.phase !== phase) {
        state.word = word;
        state.phase = phase;
        if (phase === 0) {
          // Sample the word mask into target points.
          const m = document.createElement("canvas");
          m.width = 160;
          m.height = 90;
          const mc = m.getContext("2d")!;
          mc.fillStyle = "#000";
          mc.fillRect(0, 0, 160, 90);
          mc.fillStyle = "#fff";
          mc.textAlign = "center";
          mc.textBaseline = "middle";
          mc.font = `800 ${WORDS[word].length > 5 ? 34 : 44}px ${SANS}`;
          mc.fillText(WORDS[word], 80, 47);
          const img = mc.getImageData(0, 0, 160, 90).data;
          const targets: [number, number][] = [];
          for (let y = 0; y < 90; y += 2) for (let x = 0; x < 160; x += 2) if (img[(y * 160 + x) * 4] > 128) targets.push([x / 160, y / 90]);
          for (let i = targets.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [targets[i], targets[j]] = [targets[j], targets[i]];
          }
          pts.forEach((p, i) => {
            const tg = targets[i % Math.max(1, targets.length)] ?? [0.5, 0.5];
            p.tx = tg[0] * w;
            p.ty = tg[1] * h;
          });
        }
      }
      const hit = decay(state, "hit", 0.85, f.beat);
      const r = Math.min(w, h) * 0.022 * (1 + f.bass * 0.25);
      for (const p of pts) {
        if (phase === 0) {
          p.vx += (p.tx - p.x) * 0.08;
          p.vy += (p.ty - p.y) * 0.08;
          p.vx *= 0.72;
          p.vy *= 0.72;
        } else {
          // Free swarm: orbit a ring around the centre (spring to radius R) with a swirl, puffed outward on beats.
          const dx = p.x - w / 2;
          const dy = p.y - h / 2;
          const d = Math.hypot(dx, dy) + 1;
          const R = Math.min(w, h) * (0.22 + 0.12 * p.seed);
          const spring = (R - d) * 0.004;
          const swirl = 0.9 * (p.seed > 0.5 ? 1 : -1);
          p.vx += (dx / d) * spring + (-dy / d) * swirl + (Math.random() - 0.5) * 0.5 + (dx / d) * hit * 1.8;
          p.vy += (dy / d) * spring + (dx / d) * swirl + (Math.random() - 0.5) * 0.5 + (dy / d) * hit * 1.8;
          p.vx *= 0.9;
          p.vy *= 0.9;
        }
        p.x += p.vx;
        p.y += p.vy;
        // keep every dot on screen
        if (p.x < r) {
          p.x = r;
          p.vx = Math.abs(p.vx);
        } else if (p.x > w - r) {
          p.x = w - r;
          p.vx = -Math.abs(p.vx);
        }
        if (p.y < r) {
          p.y = r;
          p.vy = Math.abs(p.vy);
        } else if (p.y > h - r) {
          p.y = h - r;
          p.vy = -Math.abs(p.vy);
        }
        face(ctx, p.x, p.y, r, p.c, hit > 0.6 ? "><" : phase === 0 ? "o" : BALL_EYES[Math.floor(p.seed * BALL_EYES.length)], t, p.seed, true);
      }
      // Phrase label
      ctx.font = `600 ${h * 0.028}px ${MONO}`;
      ctx.fillStyle = C.gray;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(phase === 0 ? `[ ${WORDS[word]} ]` : "[ · · · ]", w - h * 0.04, h - h * 0.05);
      ctx.restore();
    },
  },
  {
    // Pulse: one giant bracket pair breathing with the kick, the beat count inside, bar lines racing out on every
    // downbeat and a full-screen colour slam on the phrase - the "stadium screen" look.
    id: "dd_pulse",
    name: "DD Pulse",
    draw({ ctx, w, h, f, t, state }) {
      ctx.save();
      clear(ctx, w, h);
      const beat = beatTick(state, f.beat, t);
      const beats = (state.beats as number) ?? 0;
      const hit = decay(state, "hit", 0.84, f.beat);
      const bar = beats % 4;
      const phraseBar = Math.floor(beats / 4) % 8;
      const col = [C.green, C.purple, C.blue, C.orange][Math.floor(beats / 32) % 4];
      // Phrase slam
      if (beat && beats % 32 === 0) state.slam = t;
      const slam = clamp01(1 - (t - ((state.slam as number) ?? -9)) / 0.35);
      if (slam > 0) {
        ctx.fillStyle = col;
        ctx.globalAlpha = slam * 0.9;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      // Rings racing out on downbeats
      const rings = (state.rings as number[]) ?? (state.rings = []);
      if (beat && bar === 0) rings.push(t);
      while (rings.length && t - rings[0] > 1.6) rings.shift();
      for (const r0 of rings) {
        const k = (t - r0) / 1.6;
        ctx.strokeStyle = col;
        ctx.globalAlpha = (1 - k) * 0.8;
        ctx.lineWidth = Math.max(2, h * 0.01 * (1 - k));
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.max(w, h) * 0.75 * k + h * 0.2, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // Giant brackets breathing with the kick
      const size = h * (0.62 + hit * 0.06 + f.bass * 0.04);
      const half = size * 0.42;
      const arm = size * 0.16;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = Math.max(6, size * 0.055);
      ctx.lineCap = "butt";
      for (const dir of [-1, 1] as const) {
        const x = w / 2 + dir * half;
        ctx.beginPath();
        ctx.moveTo(x - dir * arm, h / 2 - size / 2);
        ctx.lineTo(x, h / 2 - size / 2);
        ctx.lineTo(x, h / 2 + size / 2);
        ctx.lineTo(x - dir * arm, h / 2 + size / 2);
        ctx.stroke();
      }
      // Beat number, huge
      ctx.fillStyle = bar === 0 ? col : "#fff";
      ctx.font = `800 ${size * 0.62}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(bar + 1), w / 2, h / 2 + size * 0.03);
      // Phrase bars across the bottom
      const bw = (w * 0.6) / 8;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i < phraseBar ? col : i === phraseBar ? "#fff" : "#2a2a2a";
        ctx.fillRect(w * 0.2 + i * bw + 3, h * 0.085, bw - 6, h * 0.012);
      }
      ctx.font = `600 ${h * 0.028}px ${MONO}`;
      ctx.fillStyle = C.gray;
      ctx.textAlign = "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`DevDay [2026]  ·  bar ${phraseBar + 1}/8`, w - h * 0.04, h * 0.06);
      ctx.restore();
    },
  },
];

export const devdayPresets: Preset[] = baseDevdayPresets.map((p) => ({
  ...p,
  draw: (c) => {
    applyTheme(c.s.ddTheme);
    p.draw(c);
  },
}));
