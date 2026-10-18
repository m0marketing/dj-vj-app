import type { AudioFeatures, VJPresetId, VJSettings } from "../types";
import { devdayPresets } from "./devday";

export interface PresetContext {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  t: number; // seconds
  f: AudioFeatures;
  s: VJSettings;
  state: Record<string, unknown>;
}

export type Preset = { id: VJPresetId; name: string; draw: (p: PresetContext) => void };

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h % 360}, ${s}%, ${l}%, ${a})`;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  hue: number;
  size: number;
}

export const presets: Preset[] = [
  {
    id: "bars",
    name: "Spectrum Bars",
    draw({ ctx, w, h, f, s }) {
      const n = Math.min(96, f.spectrum.length);
      const step = Math.floor(f.spectrum.length / n);
      const bw = w / n;
      for (let i = 0; i < n; i++) {
        const v = (f.spectrum[i * step] / 255) * s.intensity;
        const bh = v * h * 0.9;
        const hue = s.hue + (i / n) * 120 + f.bass * 60;
        ctx.fillStyle = hsl(hue, 90, 45 + v * 30);
        ctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
        ctx.fillStyle = hsl(hue, 90, 70, 0.4);
        ctx.fillRect(i * bw + 1, h - bh - 6, bw - 2, 3);
      }
      if (f.beat) {
        ctx.fillStyle = hsl(s.hue + 180, 100, 60, 0.25);
        ctx.fillRect(0, 0, w, h);
      }
    },
  },
  {
    id: "rings",
    name: "Pulse Rings",
    draw({ ctx, w, h, f, s, t, state }) {
      const rings = (state.rings ??= []) as { r: number; hue: number; a: number }[];
      if (f.beat) rings.push({ r: 10, hue: s.hue + f.high * 180, a: 1 });
      const cx = w / 2;
      const cy = h / 2;
      const maxR = Math.hypot(cx, cy);
      for (const ring of rings) {
        ring.r += (3 + f.level * 20) * s.intensity;
        ring.a *= 0.97;
        ctx.strokeStyle = hsl(ring.hue, 100, 60, ring.a);
        ctx.lineWidth = 2 + f.bass * 12;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      state.rings = rings.filter((r) => r.r < maxR * 1.2 && r.a > 0.02);
      const core = 40 + f.bass * 220 * s.intensity;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, core);
      grad.addColorStop(0, hsl(s.hue, 100, 80, 0.9));
      grad.addColorStop(1, hsl(s.hue + 60, 100, 50, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, core, 0, Math.PI * 2);
      ctx.fill();
      // Waveform ring
      ctx.strokeStyle = hsl(s.hue + 120, 100, 70, 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      const n = f.waveform.length;
      for (let i = 0; i <= n; i++) {
        const v = (f.waveform[i % n] - 128) / 128;
        const r = core * 1.6 + v * 60 * s.intensity;
        const a = (i / n) * Math.PI * 2 + t * 0.2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    },
  },
  {
    id: "particles",
    name: "Particle Burst",
    draw({ ctx, w, h, f, s, state }) {
      const ps = (state.ps ??= []) as Particle[];
      const cx = w / 2;
      const cy = h / 2;
      const spawn = f.beat ? 120 : Math.floor(f.level * 8 * s.intensity);
      for (let i = 0; i < spawn; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = (2 + Math.random() * 6) * (1 + f.bass * 3) * s.intensity;
        ps.push({
          x: cx,
          y: cy,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp,
          life: 1,
          hue: s.hue + Math.random() * 80 + f.high * 200,
          size: 1 + Math.random() * 4,
        });
      }
      for (const p of ps) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.03;
        p.life -= 0.012;
        ctx.fillStyle = hsl(p.hue, 100, 65, p.life);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + f.level), 0, Math.PI * 2);
        ctx.fill();
      }
      state.ps = ps.filter((p) => p.life > 0 && p.x > -50 && p.x < w + 50 && p.y < h + 50).slice(-2500);
    },
  },
  {
    id: "tunnel",
    name: "Hyper Tunnel",
    draw({ ctx, w, h, f, s, t, state }) {
      const z = (state.z = ((state.z as number) ?? 0) + 0.02 + f.level * 0.15 * s.intensity);
      const cx = w / 2 + Math.sin(t * 0.7) * w * 0.08 * f.mid;
      const cy = h / 2 + Math.cos(t * 0.5) * h * 0.08 * f.mid;
      const layers = 24;
      for (let i = 0; i < layers; i++) {
        const depth = ((i / layers + z) % 1) ** 2;
        const size = depth * Math.max(w, h) * 1.4;
        const hue = s.hue + i * 12 + f.bass * 90;
        ctx.strokeStyle = hsl(hue, 100, 55, depth * 0.9);
        ctx.lineWidth = 1 + depth * (4 + f.bass * 14);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * 0.3 + i * 0.1 + f.high * 2);
        const sides = 4 + Math.floor(f.mid * 4);
        ctx.beginPath();
        for (let k = 0; k <= sides; k++) {
          const a = (k / sides) * Math.PI * 2;
          const x = Math.cos(a) * size;
          const y = Math.sin(a) * size;
          if (k) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.restore();
      }
    },
  },
  {
    id: "grid",
    name: "Neon Grid",
    draw({ ctx, w, h, f, s, t }) {
      const cols = 16;
      const rows = 9;
      const cw = w / cols;
      const ch = h / rows;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const idx = Math.floor(((x + y * cols) / (cols * rows)) * f.spectrum.length * 0.5);
          const v = (f.spectrum[idx] / 255) * s.intensity;
          const wave = Math.sin(t * 2 + x * 0.5 + y * 0.7) * 0.5 + 0.5;
          const sz = Math.max(0, v * 0.9 + wave * 0.15) * Math.min(cw, ch);
          ctx.fillStyle = hsl(s.hue + v * 160 + x * 4, 100, 50 + v * 25, 0.3 + v);
          ctx.fillRect(x * cw + (cw - sz) / 2, y * ch + (ch - sz) / 2, sz, sz);
        }
      }
      ctx.strokeStyle = hsl(s.hue + 180, 100, 60, 0.15 + f.bass * 0.5);
      ctx.lineWidth = 1;
      const off = (t * 40 * (1 + f.level)) % ch;
      for (let y = -ch; y < h + ch; y += ch) {
        ctx.beginPath();
        ctx.moveTo(0, y + off);
        ctx.lineTo(w, y + off);
        ctx.stroke();
      }
    },
  },
  {
    id: "strobe",
    name: "Beat Strobe",
    draw({ ctx, w, h, f, s, t, state }) {
      let flash = ((state.flash as number) ?? 0) * 0.82;
      if (f.beat) flash = 1;
      state.flash = flash;
      const hue = s.hue + t * 40;
      ctx.fillStyle = hsl(hue, 100, 50, flash * s.intensity);
      ctx.fillRect(0, 0, w, h);
      // Big typographic BPM / level meter
      ctx.fillStyle = hsl(hue + 180, 100, 85, 0.9);
      ctx.font = `bold ${Math.floor(h * (0.25 + f.bass * 0.2))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.bpm ? `${f.bpm}` : "—", w / 2, h / 2);
      const bars = 32;
      for (let i = 0; i < bars; i++) {
        const v = f.spectrum[Math.floor((i / bars) * f.spectrum.length * 0.5)] / 255;
        ctx.fillStyle = hsl(hue + i * 6, 100, 60, 0.7);
        ctx.fillRect((i / bars) * w, h - v * h * 0.3, w / bars - 2, v * h * 0.3);
      }
    },
  },
  {
    id: "lasers",
    name: "Laser Show",
    draw({ ctx, w, h, f, s, t }) {
      const len = Math.hypot(w, h) * 1.3;
      const spread = 0.45 + f.mid * 1.1;
      const alpha = 0.3 + f.level * 0.7 + (f.beat ? 0.3 : 0);
      const sources: [number, number, number][] = [];
      const n = 9;
      for (let i = 0; i < n; i++) sources.push([((i + 0.5) / n) * w, h, -Math.PI / 2]);
      for (let i = 0; i < 4; i++) sources.push([((i + 0.5) / 4) * w, 0, Math.PI / 2]);
      ctx.lineCap = "round";
      sources.forEach(([x, y, base], i) => {
        const ang = base + Math.sin(t * (0.7 + i * 0.11) + i * 1.3) * spread * (0.6 + f.bass);
        const hue = s.hue + i * 28 + t * 30;
        const x2 = x + Math.cos(ang) * len;
        const y2 = y + Math.sin(ang) * len;
        ctx.strokeStyle = hsl(hue, 100, 55, alpha * 0.18);
        ctx.lineWidth = (10 + f.bass * 26) * s.intensity;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.strokeStyle = hsl(hue, 100, 80, Math.min(1, alpha));
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      const haze = ctx.createLinearGradient(0, h, 0, h * 0.6);
      haze.addColorStop(0, hsl(s.hue + 40, 100, 50, 0.25 * f.level * s.intensity));
      haze.addColorStop(1, hsl(s.hue + 40, 100, 50, 0));
      ctx.fillStyle = haze;
      ctx.fillRect(0, h * 0.6, w, h * 0.4);
    },
  },
  {
    id: "disco",
    name: "Disco Ball",
    draw({ ctx, w, h, f, s, t }) {
      const cx = w / 2;
      const cy = h * 0.42;
      const R = h * (0.2 + f.bass * 0.06 * s.intensity);
      const rot = t * 0.7;
      const maxR = Math.hypot(w, h) / 2;
      // Light spots swept across the room.
      for (let k = 0; k < 56; k++) {
        const a = (k / 56) * Math.PI * 2 + rot * (k % 2 ? 1 : -0.8);
        const r = (0.25 + ((k * 0.618) % 1) * 0.75) * maxR;
        const x = cx + Math.cos(a) * r * 1.25;
        const y = cy + Math.sin(a) * r * 0.85;
        const v = f.spectrum[(k * 3) % Math.max(1, Math.floor(f.spectrum.length * 0.5))] / 255;
        const rad = (6 + v * 34 + f.bass * 14) * s.intensity;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, hsl(s.hue + k * 17, 100, 75, 0.8));
        g.addColorStop(1, hsl(s.hue + k * 17, 100, 55, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
      }
      // String + ball facets.
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(cx - 1, 0, 2, cy - R);
      const rows = 14;
      for (let la = 0; la < rows; la++) {
        const lat = (la / (rows - 1) - 0.5) * Math.PI * 0.96;
        const cols = Math.max(6, Math.round(Math.cos(lat) * 30));
        for (let lo = 0; lo < cols; lo++) {
          const ang = (lo / cols) * Math.PI * 2 + rot;
          const depth = Math.cos(ang);
          if (depth <= 0) continue;
          const x = cx + Math.sin(ang) * Math.cos(lat) * R;
          const y = cy + Math.sin(lat) * R;
          const sz = ((R * Math.PI * 2) / 30 / 1.7) * depth;
          const hsh = Math.abs(Math.sin(la * 12.9898 + lo * 78.233 + Math.floor(t * 4 + lo) * 0.3) * 43758.5453) % 1;
          const bright = 25 + depth * 25 + (hsh > 0.8 ? 40 + f.high * 30 : 0);
          ctx.fillStyle = hsl(s.hue + hsh * 60, hsh > 0.8 ? 40 : 10, bright, 0.9);
          ctx.fillRect(x - sz / 2, y - sz / 2, sz * 0.9, sz * 0.9);
        }
      }
      const glow = ctx.createRadialGradient(cx, cy, R * 0.8, cx, cy, R * 2.2);
      glow.addColorStop(0, hsl(s.hue, 100, 70, 0.25 + f.bass * 0.3));
      glow.addColorStop(1, hsl(s.hue, 100, 60, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "rays",
    name: "Sunburst",
    draw({ ctx, w, h, f, s, t, state }) {
      let rot = (state.rot as number) ?? 0;
      let kick = ((state.kick as number) ?? 0) * 0.92;
      if (f.beat) kick = 1;
      rot += 0.004 + kick * 0.03 + f.level * 0.01;
      state.rot = rot;
      state.kick = kick;
      const cx = w / 2;
      const cy = h / 2;
      const far = Math.hypot(w, h);
      const n = 20;
      for (let i = 0; i < n; i++) {
        const a0 = rot + (i / n) * Math.PI * 2;
        const wd = (Math.PI / n) * (0.55 + f.mid * 0.5);
        ctx.fillStyle = hsl(s.hue + i * 9 + t * 20, 100, 55, (0.18 + kick * 0.3) * s.intensity);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a0) * far, cy + Math.sin(a0) * far);
        ctx.lineTo(cx + Math.cos(a0 + wd) * far, cy + Math.sin(a0 + wd) * far);
        ctx.closePath();
        ctx.fill();
      }
      for (let i = 0; i < 5; i++) {
        const r = (((t * 0.5 + i / 5) % 1) ** 1.5) * far * 0.5;
        ctx.strokeStyle = hsl(s.hue + 150 + i * 20, 100, 65, (1 - r / (far * 0.5)) * (0.2 + f.bass * 0.6));
        ctx.lineWidth = 2 + f.bass * 8;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      const core = h * (0.08 + f.bass * 0.18 + kick * 0.05) * s.intensity;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, core * 2);
      g.addColorStop(0, hsl(s.hue + 40, 100, 90, 1));
      g.addColorStop(0.4, hsl(s.hue, 100, 60, 0.7));
      g.addColorStop(1, hsl(s.hue, 100, 50, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, core * 2, 0, Math.PI * 2);
      ctx.fill();
    },
  },
  {
    id: "scope",
    name: "Oscilloscope",
    draw({ ctx, w, h, f, s, t, state }) {
      // Classic XY-ish scope: layered waveform traces with phosphor glow; the mid band bends the trace into a lissajous.
      const n = f.waveform.length;
      const traces = 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const kick = ((state.kick as number) ?? 0) * 0.9 + (f.beat ? 1 : 0);
      state.kick = Math.min(1, kick);
      for (let k = 0; k < traces; k++) {
        const amp = (0.18 + k * 0.08 + f.bass * 0.25 + kick * 0.1) * h * s.intensity;
        const hue = s.hue + k * 40 + f.high * 120;
        ctx.strokeStyle = hsl(hue, 100, 60 + k * 10, 0.9 - k * 0.2);
        ctx.lineWidth = 2.5 - k * 0.5;
        ctx.shadowColor = hsl(hue, 100, 60, 0.9);
        ctx.shadowBlur = 12 + f.level * 20;
        ctx.beginPath();
        const twist = f.mid * 2.5 * s.intensity;
        for (let i = 0; i <= n; i++) {
          const u = i / n;
          const v = (f.waveform[(i + k * 97) % n] - 128) / 128;
          const x = (u + Math.sin(u * Math.PI * 2 + t * 0.6) * 0.04 * twist) * w;
          const y = h / 2 + v * amp + Math.sin(u * Math.PI * 2 * (1 + k) + t * (1.2 + k * 0.3)) * h * 0.06 * twist;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      // Faint graticule.
      ctx.strokeStyle = hsl(s.hue, 60, 60, 0.12);
      ctx.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        ctx.beginPath();
        ctx.moveTo((i / 8) * w, 0);
        ctx.lineTo((i / 8) * w, h);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
    },
  },
  {
    id: "kaleido",
    name: "Kaleidoscope",
    draw({ ctx, w, h, f, s, t, state }) {
      // Spectrum shapes drawn into one wedge, then mirrored around the centre (N-fold symmetry).
      const segs = 6 + Math.floor(f.mid * 4) * 2;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.hypot(cx, cy);
      const rot = (state.rot = ((state.rot as number) ?? 0) + 0.003 + f.level * 0.02 * s.intensity + (f.beat ? 0.08 : 0));
      const bars = 24;
      for (let k = 0; k < segs; k++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot + (k / segs) * Math.PI * 2);
        if (k % 2) ctx.scale(1, -1);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, R, 0, (Math.PI * 2) / segs);
        ctx.closePath();
        ctx.clip();
        for (let i = 0; i < bars; i++) {
          // Log-ish frequency mapping so highs get as many shapes as the bass.
          const bin = Math.floor(Math.pow(i / bars, 1.8) * f.spectrum.length * 0.45);
          const v = Math.min(1, (f.spectrum[bin] / 255) * 1.2 * s.intensity);
          const r0 = 40 + (i / bars) * R * 0.8;
          const a = (Math.PI / segs) * (0.15 + 0.7 * ((i * 0.37) % 1)) + v * 0.25 + Math.sin(t * 0.5 + i) * 0.06;
          const len = 14 + v * R * 0.22;
          const hue = s.hue + i * 12 + f.bass * 60 + t * 12;
          ctx.fillStyle = hsl(hue, 95, 55 + v * 20, 0.3 + v * 0.55);
          ctx.beginPath();
          ctx.ellipse(Math.cos(a) * r0, Math.sin(a) * r0, len, 5 + v * 22, a, 0, Math.PI * 2);
          ctx.fill();
          if (i % 3 === 0) {
            ctx.strokeStyle = hsl(hue + 40, 100, 75, 0.2 + v * 0.5);
            ctx.lineWidth = 1 + v * 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
            ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, 25 + f.bass * 70);
      core.addColorStop(0, hsl(s.hue + 180, 100, 85, 0.6));
      core.addColorStop(1, hsl(s.hue + 180, 100, 50, 0));
      ctx.fillStyle = core;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "starfield",
    name: "Starfield Warp",
    draw({ ctx, w, h, f, s, state }) {
      // 3D starfield; speed follows level, each beat kicks the warp. Hue tints the far stars.
      type Star = { x: number; y: number; z: number; pz: number };
      const stars = (state.stars ??= Array.from({ length: 420 }, () => ({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random(), pz: 0 }))) as Star[];
      let warp = ((state.warp as number) ?? 0) * 0.92;
      if (f.beat) warp = 1;
      state.warp = warp;
      const speed = (0.004 + f.level * 0.03 + warp * 0.04) * s.intensity;
      const cx = w / 2;
      const cy = h / 2;
      const fl = Math.min(w, h) * 0.9;
      ctx.lineCap = "round";
      for (const st of stars) {
        st.pz = st.z;
        st.z -= speed;
        if (st.z <= 0.02) {
          st.x = Math.random() * 2 - 1;
          st.y = Math.random() * 2 - 1;
          st.z = 1;
          st.pz = 1;
        }
        const sx = cx + (st.x / st.z) * fl;
        const sy = cy + (st.y / st.z) * fl;
        const px = cx + (st.x / st.pz) * fl;
        const py = cy + (st.y / st.pz) * fl;
        if (sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) {
          st.z = 0;
          continue;
        }
        const depth = 1 - st.z;
        ctx.strokeStyle = hsl(s.hue + depth * 60 + f.high * 100, 80, 60 + depth * 35, 0.3 + depth * 0.7);
        ctx.lineWidth = 0.5 + depth * (2 + warp * 2);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.6);
      g.addColorStop(0, hsl(s.hue, 100, 60, 0.12 + f.bass * 0.25));
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
  },
  {
    id: "plasma",
    name: "Plasma",
    draw({ ctx, w, h, f, s, t, state }) {
      // Old-school sine plasma on a tiny offscreen buffer, scaled up (cheap, smooth). Bass pushes the palette.
      const W = 96;
      const H = Math.max(1, Math.round((W * h) / Math.max(1, w)));
      let off = state.off as OffscreenCanvas | HTMLCanvasElement | undefined;
      if (!off || off.width !== W || off.height !== H) {
        off = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
        state.off = off;
        state.img = (off.getContext("2d") as CanvasRenderingContext2D).createImageData(W, H);
      }
      const octx = off.getContext("2d") as CanvasRenderingContext2D;
      const img = state.img as ImageData;
      const d = img.data;
      const tt = t * (0.6 + f.level * 1.5);
      const z = 1 + f.bass * 2.5 * s.intensity;
      const hueBase = s.hue + f.high * 90;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const u = (x / W) * 4 * z;
          const v = (y / H) * 4 * z;
          const p = Math.sin(u + tt) + Math.sin((v + tt) * 0.7) + Math.sin((u + v + tt) * 0.5) + Math.sin(Math.hypot(u - 2 * z, v - 2 * z) - tt * 1.3);
          const hue = (hueBase + p * 45 + 360) % 360;
          const l = 0.35 + 0.25 * Math.sin(p * 1.5 + tt) + (f.beat ? 0.1 : 0);
          // hsl -> rgb (s = 1)
          const c = (1 - Math.abs(2 * l - 1)) * 1;
          const hp = hue / 60;
          const xx = c * (1 - Math.abs((hp % 2) - 1));
          const [r, g, b] = hp < 1 ? [c, xx, 0] : hp < 2 ? [xx, c, 0] : hp < 3 ? [0, c, xx] : hp < 4 ? [0, xx, c] : hp < 5 ? [xx, 0, c] : [c, 0, xx];
          const m = l - c / 2;
          const i = (y * W + x) * 4;
          d[i] = (r + m) * 255;
          d[i + 1] = (g + m) * 255;
          d[i + 2] = (b + m) * 255;
          d[i + 3] = 255;
        }
      }
      octx.putImageData(img, 0, 0);
      ctx.save();
      ctx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = Math.min(1, 0.7 + f.level * 0.5);
      ctx.drawImage(off, 0, 0, w, h);
      ctx.restore();
    },
  },
  {
    id: "typo",
    name: "Big Type",
    draw({ ctx, w, h, f, s, t, state }) {
      // Oversized words that slam in on the beat; the live BPM sits in the corner. Great for hype moments.
      const WORDS = ["LOUDER", "HANDS UP", "BASS", "JUMP", "DANCE", "MAKE NOISE", "ONE MORE", "DROP"];
      let idx = (state.idx as number) ?? 0;
      let since = (state.since as number) ?? -10;
      if (f.beat && t - since > 1.2) {
        idx = (idx + 1 + Math.floor(Math.random() * 2)) % WORDS.length;
        since = t;
      }
      state.idx = idx;
      state.since = since;
      const age = Math.min(1, (t - since) / 0.25);
      const scale = 1.6 - 0.6 * age + f.bass * 0.08;
      const word = WORDS[idx];
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((1 - age) * 0.08 * (idx % 2 ? 1 : -1));
      ctx.scale(scale, scale);
      ctx.font = `900 100px Impact, "Arial Black", sans-serif`;
      const fit = Math.min((w * 0.85) / Math.max(1, ctx.measureText(word).width), h * 0.0045) * 100;
      ctx.font = `900 ${fit}px Impact, "Arial Black", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = fit * 0.06;
      ctx.strokeStyle = hsl(s.hue + 180, 100, 60, 0.9);
      ctx.strokeText(word, 0, 0);
      ctx.fillStyle = hsl(s.hue + f.high * 60, 100, 55 + age * 30, 1);
      ctx.fillText(word, 0, 0);
      ctx.restore();
      // Spectrum ribbon along the bottom + BPM.
      const bars = 48;
      for (let i = 0; i < bars; i++) {
        const v = (f.spectrum[Math.floor((i / bars) * f.spectrum.length * 0.5)] / 255) * s.intensity;
        ctx.fillStyle = hsl(s.hue + i * 4, 100, 60, 0.6);
        ctx.fillRect((i / bars) * w, h - v * h * 0.2, w / bars - 2, v * h * 0.2);
      }
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = `bold ${h * 0.05}px monospace`;
      ctx.textAlign = "right";
      ctx.textBaseline = "top";
      ctx.fillText(f.bpm ? `${f.bpm} BPM` : "", w - 16, 12);
    },
  },
  ...devdayPresets,
];

export const presetById = (id: VJPresetId) => presets.find((p) => p.id === id) ?? presets[0];
