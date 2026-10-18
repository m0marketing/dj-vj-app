import { showParams, type AudioFeatures, type VJSettings } from "../types";

/**
 * "Director": an automatic motion-graphics post stage on top of whatever preset is drawing.
 * The preset renders to an offscreen scene; the director then composites it with camera moves and
 * finishing effects timed to the music, the way an After Effects comp would be animated:
 *
 *  - camera: punch-zoom on kicks, shake on big hits, slow drift / roll
 *  - cuts: when the preset changes, a transition (zoom-through, wipe, slide, dissolve, flash cut)
 *  - hits: RGB split (chromatic aberration), glitch slices, flash frames on the downbeat
 *  - finish: light leak, film grain, vignette, letterbox bars that close in on breakdowns
 *
 * Everything decays on its own; intensity scales with settings.intensity.
 */
export class Director {
  private punch = 0; // zoom impulse
  private shake = 0;
  private shakeX = 0;
  private shakeY = 0;
  private aberr = 0;
  private flash = 0;
  private flashColor = "#fff";
  private glitchUntil = 0;
  private glitchSeed = 0;
  private letterbox = 0; // 0..1
  private leakPhase = Math.random() * 100;
  private energy = 0;
  private setEnergy = 0.5;
  private lastFlashAt = 0;
  /** Smoothed music energy (0..1) that the auto show follows; read by the ticker for its own pacing. */
  get energyLevel() {
    return this.setEnergy;
  }
  /** Flash frames are rate-limited to ~3 Hz (photosensitivity guidance) regardless of the show. */
  private safeFlash(v: number, now: number) {
    if (now - this.lastFlashAt < 330) return;
    this.lastFlashAt = now;
    this.flash = Math.max(this.flash, v);
  }
  private beats = 0;
  private lastBeatAt = 0;
  private quietSince = 0;
  private transition: { kind: "zoom" | "wipe" | "slide" | "dissolve" | "flash" | "spin"; t0: number; dur: number } | null = null;
  private prev: HTMLCanvasElement | null = null;
  private tmp: HTMLCanvasElement | null = null;
  private grain: HTMLCanvasElement | null = null;
  private last = 0;

  /** Call once per frame before drawing the scene. `presetChanged` starts a cut transition. */
  step(now: number, f: AudioFeatures, s: VJSettings, presetChanged: boolean, scene: HTMLCanvasElement) {
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    const k = s.intensity;
    const level = Math.min(1, f.level * 1.6);
    this.energy += (level - this.energy) * 0.08;
    // Slow "set energy" (seconds, not beats) drives the auto show between cinema / club / festival.
    this.setEnergy += (level - this.setEnergy) * Math.min(1, dt * 0.35);
    const sp = showParams(s.show, this.setEnergy, s.showCustom);
    if (level < 0.22) this.quietSince ||= now;
    else if (this.quietSince && now - this.quietSince > 300) this.quietSince = 0;
    const breakdown = !!this.quietSince && now - this.quietSince > 2000;

    // Decay
    const decay = (v: number, rate: number) => v * Math.exp(-rate * dt);
    this.punch = decay(this.punch, 9);
    this.shake = decay(this.shake, 10);
    this.aberr = decay(this.aberr, 8);
    this.flash = decay(this.flash, 12);
    this.letterbox += ((breakdown && sp.letterbox ? 1 : 0) - this.letterbox) * Math.min(1, dt * 2.5);

    if (f.beat && now - this.lastBeatAt > 120) {
      this.lastBeatAt = now;
      this.beats++;
      const downbeat = this.beats % 4 === 1;
      const bass = Math.min(1, f.bass * 1.4);
      this.punch = Math.max(this.punch, (0.025 + bass * 0.045) * k * sp.punch);
      if ((downbeat || bass > 0.75) && sp.shake > 0) {
        this.shake = Math.max(this.shake, (downbeat ? 0.5 : 0.3) * bass * k * sp.shake);
        this.shakeX = (Math.random() - 0.5) * 2;
        this.shakeY = (Math.random() - 0.5) * 2;
      }
      if (downbeat && this.energy > 0.5 && sp.aberr > 0) this.aberr = Math.max(this.aberr, (3 + f.high * 6) * k * sp.aberr);
      // Flash frame on the first beat of every 4 bars when the music is loud (classic edit hit).
      if (this.beats % 16 === 1 && this.energy > 0.55 && sp.flash > 0) {
        this.safeFlash(0.45 * k * sp.flash, now);
        this.flashColor = `hsl(${s.hue} 90% 70%)`;
      }
      // Occasional glitch slice at bar starts in loud parts.
      if (downbeat && this.energy > 0.6 && sp.glitch > 0 && Math.random() < 0.3 * k * sp.glitch) {
        this.glitchUntil = now + 110 + Math.random() * 120;
        this.glitchSeed = Math.random() * 1000;
      }
    }

    if (presetChanged) {
      // Snapshot the outgoing scene for the transition.
      if (!this.prev) this.prev = document.createElement("canvas");
      if (this.prev.width !== scene.width || this.prev.height !== scene.height) {
        this.prev.width = scene.width;
        this.prev.height = scene.height;
      }
      this.prev.getContext("2d")!.drawImage(scene, 0, 0);
      const kinds: ("zoom" | "wipe" | "slide" | "dissolve" | "flash" | "spin")[] = sp.cuts.length ? sp.cuts : ["dissolve"];
      const kind = this.energy > 0.5 || kinds.length === 1 ? kinds[Math.floor(Math.random() * kinds.length)] : "dissolve";
      this.transition = { kind, t0: now, dur: (kind === "flash" ? 260 : kind === "dissolve" ? 700 : 480) * sp.cutDur };
      if (kind === "flash") this.safeFlash(0.9 * Math.max(0.3, sp.flash), now);
      if (sp.aberr > 0) this.aberr = Math.max(this.aberr, 6 * k * sp.aberr);
    }
  }

  /** Composite the rendered scene onto `ctx` (CSS px size w x h). */
  compose(ctx: CanvasRenderingContext2D, scene: HTMLCanvasElement, w: number, h: number, now: number, f: AudioFeatures, s: VJSettings) {
    const k = s.intensity;
    const sp = showParams(s.show, this.setEnergy, s.showCustom);
    const t = now / 1000;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);

    // Camera
    const drift = Math.max(0.2, sp.punch);
    const zoom = 1 + this.punch + 0.012 * Math.sin(t * 0.37) * k * drift;
    const roll = ((0.6 * Math.sin(t * 0.21) * Math.PI) / 180) * drift + this.shake * 0.01 * this.shakeX;
    const sx = this.shake * 14 * this.shakeX + 6 * Math.sin(t * 0.29) * k * drift;
    const sy = this.shake * 10 * this.shakeY + 4 * Math.cos(t * 0.23) * k * drift;
    ctx.translate(w / 2 + sx, h / 2 + sy);
    ctx.rotate(roll);
    ctx.scale(zoom, zoom);
    ctx.translate(-w / 2, -h / 2);

    const drawScene = (src: CanvasImageSource, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.drawImage(src, 0, 0, w, h);
      ctx.globalAlpha = 1;
    };

    const tr = this.transition;
    if (tr) {
      const p = Math.min(1, (now - tr.t0) / tr.dur);
      const ease = 1 - Math.pow(1 - p, 3);
      if (p >= 1) this.transition = null;
      switch (tr.kind) {
        case "dissolve":
          drawScene(scene);
          if (this.prev) drawScene(this.prev, 1 - ease);
          break;
        case "zoom": {
          // Old scene flies into the camera while the new one settles from slightly zoomed in.
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.scale(1 + 0.25 * (1 - ease), 1 + 0.25 * (1 - ease));
          ctx.translate(-w / 2, -h / 2);
          drawScene(scene);
          ctx.restore();
          if (this.prev) {
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(1 + ease * 1.6, 1 + ease * 1.6);
            ctx.translate(-w / 2, -h / 2);
            drawScene(this.prev, 1 - ease);
            ctx.restore();
          }
          break;
        }
        case "wipe": {
          if (this.prev) drawScene(this.prev);
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, w * ease, h);
          ctx.clip();
          drawScene(scene);
          ctx.restore();
          ctx.fillStyle = `hsl(${s.hue} 90% 65%)`;
          ctx.fillRect(w * ease - 3, 0, 6, h);
          break;
        }
        case "slide": {
          ctx.save();
          ctx.translate(0, -h * (1 - ease));
          drawScene(scene);
          ctx.restore();
          if (this.prev) {
            ctx.save();
            ctx.translate(0, h * ease);
            drawScene(this.prev);
            ctx.restore();
          }
          break;
        }
        case "spin": {
          ctx.save();
          ctx.translate(w / 2, h / 2);
          ctx.rotate((1 - ease) * 0.35);
          ctx.scale(0.7 + 0.3 * ease, 0.7 + 0.3 * ease);
          ctx.translate(-w / 2, -h / 2);
          drawScene(scene);
          ctx.restore();
          if (this.prev) {
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.rotate(-ease * 0.5);
            ctx.scale(1 + ease, 1 + ease);
            ctx.translate(-w / 2, -h / 2);
            drawScene(this.prev, 1 - ease);
            ctx.restore();
          }
          break;
        }
        default:
          drawScene(scene);
      }
    } else drawScene(scene);

    // Chromatic aberration: red / blue copies pushed apart, screened on top.
    if (this.aberr > 0.6) {
      const d = this.aberr;
      const tmp = this.tmpCanvas(scene.width, scene.height);
      const tc = tmp.getContext("2d")!;
      for (const [color, dx] of [
        ["#ff2a2a", -d],
        ["#2a7bff", d],
      ] as const) {
        tc.globalCompositeOperation = "source-over";
        tc.clearRect(0, 0, tmp.width, tmp.height);
        tc.drawImage(scene, 0, 0);
        tc.globalCompositeOperation = "multiply";
        tc.fillStyle = color;
        tc.fillRect(0, 0, tmp.width, tmp.height);
        tc.globalCompositeOperation = "destination-in";
        tc.drawImage(scene, 0, 0);
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = Math.min(0.8, d / 10);
        ctx.drawImage(tmp, dx, 0, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // Glitch slices
    if (now < this.glitchUntil) {
      const n = 6;
      let seed = this.glitchSeed + Math.floor(now / 40);
      const rnd = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };
      for (let i = 0; i < n; i++) {
        const y = rnd() * h;
        const hh = 6 + rnd() * h * 0.08;
        const dx = (rnd() - 0.5) * w * 0.12 * k;
        const sy = (y / h) * scene.height;
        const sh = (hh / h) * scene.height;
        ctx.drawImage(scene, 0, sy, scene.width, sh, dx, y, w, hh);
      }
    }
    ctx.restore();

    // Light leak (warm/hue-tinted soft blob drifting across), stronger on loud parts.
    const leak = (0.08 + this.energy * 0.22) * k * sp.leak;
    if (leak > 0.02) {
      const lx = w * (0.5 + 0.45 * Math.sin(t * 0.13 + this.leakPhase));
      const ly = h * (0.4 + 0.35 * Math.cos(t * 0.17 + this.leakPhase));
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(w, h) * 0.55);
      g.addColorStop(0, `hsla(${(s.hue + 30) % 360} 100% 70% / ${leak})`);
      g.addColorStop(0.5, `hsla(${(s.hue + 60) % 360} 100% 60% / ${leak * 0.35})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Flash frame
    if (this.flash > 0.01) {
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    // Film grain
    const grain = this.grainCanvas();
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = (0.07 + 0.06 * k) * sp.grain;
    const pat = ctx.createPattern(grain, "repeat")!;
    ctx.save();
    ctx.translate(Math.floor(Math.random() * 128), Math.floor(Math.random() * 128));
    ctx.fillStyle = pat;
    ctx.fillRect(-128, -128, w + 256, h + 256);
    ctx.restore();
    ctx.globalAlpha = 1;

    // Vignette
    ctx.globalCompositeOperation = "source-over";
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, (0.45 + 0.2 * this.letterbox) * sp.vignette)})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);

    // Letterbox bars (close in during breakdowns, snap open on the drop)
    if (this.letterbox > 0.01) {
      const bar = h * 0.11 * this.letterbox;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
    }
  }

  private tmpCanvas(w: number, h: number) {
    if (!this.tmp) this.tmp = document.createElement("canvas");
    if (this.tmp.width !== w || this.tmp.height !== h) {
      this.tmp.width = w;
      this.tmp.height = h;
    }
    return this.tmp;
  }

  private grainCanvas() {
    if (this.grain) return this.grain;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const img = g.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 100 + Math.random() * 90;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.grain = c;
    return c;
  }
}
