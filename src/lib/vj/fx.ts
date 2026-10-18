import type { AudioFeatures, VJFxEvent, VJSettings } from "../types";

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const EMOJIS = ["🎉", "🔥", "🙌", "🕺", "💃", "✨", "🪩", "🎊"];

interface Act {
  kind: "text" | "lasers" | "siren" | "build" | "glitch" | "lowerthird";
  t0: number;
  dur: number;
  hue: number;
  text?: string;
  rot?: number;
}
interface Ring {
  t0: number;
  hue: number;
  speed: number;
  width: number;
}
interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  hue: number;
  life: number;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
}
interface Emoji {
  x: number;
  y: number;
  vy: number;
  phase: number;
  size: number;
  ch: string;
}

/**
 * Overlay effects triggered by pad hits / buttons. Independent from the active preset
 * so any sample can punch the visuals (text pops, confetti, lasers, shockwaves, ...).
 */
export class FxEngine {
  private acts: Act[] = [];
  private rings: Ring[] = [];
  private conf: Confetti[] = [];
  private emo: Emoji[] = [];
  private sparks: Spark[] = [];
  private fwq: { at: number; x: number; y: number; hue: number }[] = [];
  private flash = 0;
  private lastFlash = 0;
  private flashHue = 0;
  private flashWhite = true;
  private shake = 0;
  private zoom = 0;
  private last = 0;
  private dt = 1;
  private w = 1;
  private h = 1;

  trigger(e: VJFxEvent, now: number) {
    const { hue, text } = e;
    const t0 = now / 1000;
    const pop = (f: number, white = true) => {
      // Rate-limit full-screen flashes (~3 Hz max) - photosensitivity guidance for club visuals.
      if (now - this.lastFlash < 330) f *= 0.25;
      else this.lastFlash = now;
      this.flash = Math.max(this.flash, f);
      this.flashHue = hue;
      this.flashWhite = white;
    };
    const ring = (n = 1, speed = 1, width = 6) => {
      for (let i = 0; i < n; i++) this.rings.push({ t0: t0 + i * 0.09, hue: hue + i * 40, speed, width });
    };
    switch (e.fx) {
      case "pulse":
        pop(0.22, false);
        ring(1, 0.7, 3);
        this.zoom = Math.max(this.zoom, 0.015);
        break;
      case "flash":
        pop(0.85);
        this.shake = Math.max(this.shake, 0.3);
        break;
      case "shock":
        ring(3, 1, 8);
        this.shake = Math.max(this.shake, 0.55);
        this.zoom = Math.max(this.zoom, 0.05);
        break;
      case "confetti":
        this.confetti(hue, 160);
        break;
      case "lasers":
        this.acts.push({ kind: "lasers", t0, dur: 3.2, hue });
        pop(0.15, false);
        break;
      case "text":
        this.acts.push({ kind: "text", t0, dur: 1.4, hue, text: text || "PARTY!", rot: rnd(-0.1, 0.1) });
        pop(0.2, false);
        this.zoom = Math.max(this.zoom, 0.04);
        break;
      case "clear":
        this.acts = [];
        this.rings = [];
        this.conf = [];
        this.emo = [];
        this.sparks = [];
        this.fwq = [];
        this.flash = this.shake = this.zoom = 0;
        break;
      case "fireworks":
        for (let i = 0; i < 7; i++) this.fwq.push({ at: t0 + i * 0.28, x: rnd(0.12, 0.88), y: rnd(0.12, 0.5), hue: hue + rnd(0, 360) });
        break;
      case "emoji":
        this.emojis(text);
        break;
      case "glitch":
        this.acts.push({ kind: "glitch", t0, dur: 0.55, hue });
        this.shake = Math.max(this.shake, 0.4);
        break;
      case "siren":
        this.acts.push({ kind: "siren", t0, dur: 2.4, hue });
        break;
      case "build":
        this.acts.push({ kind: "build", t0, dur: 2.2, hue });
        break;
      case "airhorn":
        pop(0.7);
        ring(2, 1.1, 10);
        this.shake = Math.max(this.shake, 0.8);
        this.acts.push({ kind: "siren", t0, dur: 1.4, hue });
        this.acts.push({ kind: "text", t0, dur: 1.3, hue, text: text || "AIR HORN!", rot: rnd(-0.08, 0.08) });
        break;
      case "lowerthird":
        // Now-playing card: one at a time.
        this.acts = this.acts.filter((a) => a.kind !== "lowerthird");
        this.acts.push({ kind: "lowerthird", t0, dur: 7, hue, text: text || "" });
        break;
      case "drop":
        pop(1);
        ring(4, 1.3, 12);
        this.shake = 1;
        this.zoom = 0.14;
        this.confetti(hue, 320);
        this.acts.push({ kind: "text", t0, dur: 1.8, hue, text: text || "DROP!", rot: 0 });
        this.acts.push({ kind: "lasers", t0, dur: 3.5, hue });
        break;
    }
  }

  private confetti(hue: number, n: number) {
    const { w, h } = this;
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      this.conf.push({
        x: left ? w * 0.04 : w * 0.96,
        y: h * 1.02,
        vx: (left ? 1 : -1) * rnd(1, 9) * (h / 700),
        vy: -rnd(0.5, 1.15) * h * 0.04 - rnd(0, 6),
        rot: rnd(0, 6.28),
        vr: rnd(-0.3, 0.3),
        size: rnd(6, 14),
        hue: hue + rnd(-60, 200),
        life: rnd(0.8, 1.2),
      });
    }
  }

  private emojis(text?: string) {
    const set = text ? Array.from(text.replace(/\s/g, "")) : EMOJIS;
    const n = set.length === 1 ? 14 : 26;
    for (let i = 0; i < n; i++)
      this.emo.push({
        x: rnd(0.05, 0.95) * this.w,
        y: this.h * rnd(1.05, 1.5),
        vy: rnd(0.25, 0.55) * this.h,
        phase: rnd(0, 6.28),
        size: rnd(0.06, 0.14) * this.h,
        ch: set[Math.floor(Math.random() * set.length)],
      });
  }

  /** Advance decay timers; call once per frame before transform/draw. */
  step(now: number, f: AudioFeatures, s: VJSettings, w: number, h: number) {
    this.w = w;
    this.h = h;
    this.dt = this.last ? Math.min(3, Math.max(0.2, (now - this.last) / 16.67)) : 1;
    this.last = now;
    const d = this.dt;
    this.flash *= Math.pow(0.88, d);
    this.shake *= Math.pow(0.9, d);
    this.zoom *= Math.pow(0.9, d);
    if (f.beat) this.zoom = Math.max(this.zoom, 0.025 * s.intensity * (0.5 + f.bass));
    const t = now / 1000;
    this.fwq = this.fwq.filter((q) => {
      if (q.at > t) return true;
      this.flash = Math.max(this.flash, 0.12);
      this.flashHue = q.hue;
      this.flashWhite = false;
      for (let i = 0; i < 90; i++) {
        const a = rnd(0, 6.283);
        const sp = rnd(0.2, 1) * h * 0.011 * (i % 3 ? 1 : 1.5);
        this.sparks.push({ x: q.x * w, y: q.y * h, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: q.hue + rnd(-25, 25) });
      }
      return false;
    });
    this.acts = this.acts.filter((a) => t - a.t0 < a.dur);
    this.rings = this.rings.filter((r) => (t - r.t0) * r.speed < 1.4);
  }

  transform(ctx: CanvasRenderingContext2D) {
    const { w, h } = this;
    if (this.shake > 0.01) ctx.translate((Math.random() - 0.5) * this.shake * w * 0.035, (Math.random() - 0.5) * this.shake * h * 0.035);
    if (this.zoom > 0.001) {
      ctx.translate(w / 2, h / 2);
      ctx.scale(1 + this.zoom, 1 + this.zoom);
      ctx.translate(-w / 2, -h / 2);
    }
  }

  draw(ctx: CanvasRenderingContext2D, now: number, f: AudioFeatures, s: VJSettings) {
    const { w, h, dt } = this;
    const t = now / 1000;
    const k = s.strobe ? 1 : 0.35;
    ctx.globalCompositeOperation = "lighter";

    // Shockwave rings
    const maxR = Math.hypot(w, h) / 2;
    for (const r of this.rings) {
      const p = (t - r.t0) * r.speed;
      if (p < 0) continue;
      ctx.strokeStyle = hsl(r.hue, 100, 65, (1 - p / 1.4) * 0.9);
      ctx.lineWidth = r.width * (1 - p / 1.6) * (1 + f.bass);
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, p * maxR * 0.9, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (const a of this.acts) {
      const age = t - a.t0;
      const p = age / a.dur;
      if (a.kind === "lasers") this.drawLasers(ctx, age, p, a.hue, f);
      else if (a.kind === "siren") this.drawSiren(ctx, age, p, k);
      else if (a.kind === "build") this.drawBuild(ctx, age, p, a.hue, k);
      else if (a.kind === "glitch") this.drawGlitch(ctx, p, a.hue);
    }

    // Fireworks
    ctx.globalCompositeOperation = "lighter";
    this.sparks = this.sparks.filter((p) => p.life > 0);
    for (const p of this.sparks) {
      p.vy += 0.045 * (h / 700) * dt;
      p.vx *= Math.pow(0.97, dt);
      p.vy *= Math.pow(0.97, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= 0.012 * dt;
      ctx.fillStyle = hsl(p.hue, 100, 65, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.5 + p.life * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Confetti
    ctx.globalCompositeOperation = "source-over";
    const g = 0.28 * (h / 700) * dt;
    this.conf = this.conf.filter((c) => c.life > 0 && c.y < h + 40);
    for (const c of this.conf) {
      c.vy += g;
      c.vx *= Math.pow(0.98, dt);
      c.vy *= Math.pow(0.96, dt);
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.rot += c.vr * dt;
      c.life -= 0.0018 * dt;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.scale(1, Math.cos(c.rot * 2));
      ctx.fillStyle = hsl(c.hue, 95, 60, clamp01(c.life * 2));
      ctx.fillRect(-c.size / 2, -c.size / 4, c.size, c.size / 2);
      ctx.restore();
    }

    // Emoji
    this.emo = this.emo.filter((e) => e.y > -e.size * 2);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const e of this.emo) {
      e.y -= (e.vy * dt) / 60;
      ctx.font = `${e.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.globalAlpha = clamp01(e.y / (h * 0.3));
      ctx.fillText(e.ch, e.x + Math.sin(t * 3 + e.phase) * e.size * 0.5, e.y);
    }
    ctx.globalAlpha = 1;

    // Text pops
    for (const a of this.acts) if (a.kind === "text") this.drawText(ctx, t - a.t0, (t - a.t0) / a.dur, a);
    for (const a of this.acts) if (a.kind === "lowerthird") this.drawLowerThird(ctx, t - a.t0, (t - a.t0) / a.dur, a);

    // Flash (screen flood)
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = this.flashWhite ? `rgba(255,255,255,${this.flash * k})` : hsl(this.flashHue, 100, 55, this.flash * k);
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private drawText(ctx: CanvasRenderingContext2D, age: number, p: number, a: Act) {
    const { w, h } = this;
    const text = a.text ?? "";
    ctx.save();
    ctx.font = `900 100px Impact, "Arial Black", "Hiragino Sans", sans-serif`;
    const fit = Math.min((w * 0.9) / Math.max(1, ctx.measureText(text).width), (h * 0.42) / 100);
    const size = 100 * fit;
    const inP = clamp01(age / 0.14);
    const c1 = 1.70158 + 1;
    const pop = 1 + c1 * Math.pow(inP - 1, 3) + 1.70158 * Math.pow(inP - 1, 2); // easeOutBack
    const sc = pop * (1 + p * 0.06);
    const alpha = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1;
    ctx.translate(w / 2, h / 2);
    ctx.rotate(a.rot ?? 0);
    ctx.scale(sc, sc);
    ctx.globalAlpha = alpha;
    ctx.font = `900 ${size}px Impact, "Arial Black", "Hiragino Sans", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = size * 0.12;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(text, size * 0.03, size * 0.05);
    ctx.shadowColor = hsl(a.hue + age * 300, 100, 60, 1);
    ctx.shadowBlur = size * 0.35;
    ctx.fillStyle = hsl(a.hue + age * 300, 100, 62);
    ctx.fillText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(text, -size * 0.012, -size * 0.02);
    ctx.restore();
  }

  /** Broadcast-style lower third: colour bar slides in from the left, label + title, slides out at the end. */
  private drawLowerThird(ctx: CanvasRenderingContext2D, age: number, p: number, a: Act) {
    const { w, h } = this;
    const text = a.text ?? "";
    const inP = clamp01(age / 0.45);
    const outP = clamp01((p - 0.88) / 0.12);
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    const slide = ease(inP) * (1 - ease(outP));
    const size = Math.max(14, h * 0.045);
    const pad = size * 0.6;
    ctx.save();
    ctx.font = `700 ${size}px "Helvetica Neue","Hiragino Sans",Inter,system-ui,sans-serif`;
    const tw = Math.min(w * 0.6, ctx.measureText(text).width);
    const boxW = tw + pad * 2 + size * 0.5;
    const boxH = size * 2.4;
    const x = -boxW + boxW * slide + w * 0.04 * slide;
    const y = h * 0.74 - boxH / 2;
    ctx.globalAlpha = Math.min(1, slide * 1.2);
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.fillStyle = hsl(a.hue, 90, 60);
    ctx.fillRect(x, y, size * 0.35, boxH);
    ctx.fillStyle = hsl(a.hue, 90, 70);
    ctx.font = `600 ${size * 0.55}px "SF Mono",Menlo,monospace`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("NOW PLAYING", x + size * 0.35 + pad, y + size * 0.95);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${size}px "Helvetica Neue","Hiragino Sans",Inter,system-ui,sans-serif`;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, boxW - pad * 0.5, boxH);
    ctx.clip();
    ctx.fillText(text, x + size * 0.35 + pad, y + size * 2.0);
    ctx.restore();
    ctx.restore();
  }

  private drawLasers(ctx: CanvasRenderingContext2D, age: number, p: number, hue: number, f: AudioFeatures) {
    const { w, h } = this;
    const env = clamp01(age * 6) * (p > 0.8 ? (1 - p) / 0.2 : 1);
    const len = Math.hypot(w, h) * 1.3;
    const n = 9;
    for (let i = 0; i < n; i++) {
      const ox = ((i + 0.5) / n) * w;
      const top = i % 3 === 0;
      const ang = (top ? Math.PI / 2 : -Math.PI / 2) + Math.sin(age * (1.6 + i * 0.21) + i * 1.7) * (0.55 + f.bass * 0.5);
      const col = hue + i * (360 / n) + age * 60;
      const x2 = ox + Math.cos(ang) * len;
      const y2 = (top ? 0 : h) + Math.sin(ang) * len;
      ctx.lineCap = "round";
      ctx.strokeStyle = hsl(col, 100, 55, 0.18 * env);
      ctx.lineWidth = 16 + f.bass * 20;
      ctx.beginPath();
      ctx.moveTo(ox, top ? 0 : h);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = hsl(col, 100, 80, 0.95 * env);
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  private drawSiren(ctx: CanvasRenderingContext2D, age: number, p: number, k: number) {
    const { w, h } = this;
    const env = clamp01(age * 8) * (p > 0.85 ? (1 - p) / 0.15 : 1);
    const ph = Math.sin(age * 11);
    for (const [side, col, v] of [
      [0, 0, clamp01(ph * 2.5 + 0.5)],
      [1, 220, clamp01(-ph * 2.5 + 0.5)],
    ] as const) {
      const x = side ? w : 0;
      const gr = ctx.createRadialGradient(x, h * 0.5, 0, x, h * 0.5, w * 0.9);
      gr.addColorStop(0, hsl(col, 100, 55, 0.9 * v * env * k));
      gr.addColorStop(1, hsl(col, 100, 50, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawBuild(ctx: CanvasRenderingContext2D, age: number, p: number, hue: number, k: number) {
    const { w, h } = this;
    const maxR = Math.hypot(w, h) / 2;
    const vg = ctx.createRadialGradient(w / 2, h / 2, maxR * (1 - p) * 0.8, w / 2, h / 2, maxR);
    vg.addColorStop(0, hsl(hue, 100, 50, 0));
    vg.addColorStop(1, hsl(hue, 100, 55, 0.15 + p * 0.65));
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const q = (p * (2 + i) + i / 4) % 1;
      ctx.strokeStyle = hsl(hue + i * 30, 100, 65, q * (0.3 + p * 0.6));
      ctx.lineWidth = 2 + p * 10;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, (1 - q) * maxR, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (p > 0.35 && Math.floor(age * (6 + p * 26)) % 2 === 0) {
      ctx.fillStyle = `rgba(255,255,255,${p * 0.35 * k})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawGlitch(ctx: CanvasRenderingContext2D, p: number, hue: number) {
    const { w, h } = this;
    const cv = ctx.canvas;
    const ky = cv.height / h;
    ctx.globalCompositeOperation = "source-over";
    const slices = 9;
    for (let i = 0; i < slices; i++) {
      const sy = Math.random() * h;
      const sh = rnd(0.02, 0.12) * h;
      const dx = rnd(-0.12, 0.12) * w * (1 - p);
      ctx.drawImage(cv, 0, sy * ky, cv.width, sh * ky, dx, sy, w, sh);
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = hsl(hue + 120, 100, 50, 0.1 * (1 - p));
    ctx.fillRect(rnd(-20, 20), 0, w, h);
    ctx.fillStyle = hsl(hue + 300, 100, 50, 0.1 * (1 - p));
    ctx.fillRect(rnd(-20, 20), 0, w, h);
  }
}
