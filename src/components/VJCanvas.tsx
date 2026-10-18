"use client";

import { useEffect, useRef } from "react";
import { featureBus, type VJFrame } from "@/lib/vj/featureBus";
import { presetById, presets } from "@/lib/vj/presets";
import { FxEngine } from "@/lib/vj/fx";
import { Director } from "@/lib/vj/director";
import { db } from "@/lib/db";
import type { VJPresetId, VJSettings } from "@/lib/types";

/** Persistent caption + logo image drawn on top of every preset (both in the studio and the projector tab). */
function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, s: VJSettings, logo: CanvasImageSource | null) {
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  if (logo) {
    const lw = (logo as HTMLImageElement).width || (logo as ImageBitmap).width;
    const lh = (logo as HTMLImageElement).height || (logo as ImageBitmap).height;
    const maxW = w * 0.18;
    const maxH = h * 0.18;
    const k = Math.min(maxW / lw, maxH / lh, 1);
    ctx.globalAlpha = 0.9;
    ctx.drawImage(logo, w - lw * k - h * 0.03, h * 0.03, lw * k, lh * k);
    ctx.globalAlpha = 1;
  }
  if (s.overlayText) {
    const size = Math.max(12, h * 0.045);
    ctx.font = `600 ${size}px system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const x = h * 0.03;
    const y = h - h * 0.035;
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.lineJoin = "round";
    ctx.strokeText(s.overlayText, x, y);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(s.overlayText, x, y);
  }
  ctx.restore();
}

interface Props {
  source: "local" | "remote";
  className?: string;
}

export default function VJCanvas({ source, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<VJFrame | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const outCtx = canvas.getContext("2d")!;
    // Presets draw into an offscreen scene; the director composites it (or it is blitted 1:1 when off).
    const scene = document.createElement("canvas");
    const ctx = scene.getContext("2d")!;
    // Layer 2: a second preset drawn to its own canvas and blended over the scene.
    const scene2 = document.createElement("canvas");
    const ctx2 = scene2.getContext("2d")!;
    const state2: Record<string, unknown> = {};
    let lastPreset2: VJPresetId | null = null;
    const director = new Director();
    const state: Record<string, unknown> = {};
    let raf = 0;
    let lastPreset: VJPresetId | null = null;
    let cycleAt = performance.now();
    let cyclePreset: VJPresetId | null = null;
    const start = performance.now();

    const onFrame = (f: VJFrame) => {
      frameRef.current = f;
    };
    const fx = new FxEngine();
    let logo: CanvasImageSource | null = null;
    let logoVersion = -1;
    const loadLogo = async (version: number) => {
      logoVersion = version;
      const blob = await db.getSetting<Blob>("vjLogo");
      if (!blob) return void (logo = null);
      try {
        logo = await createImageBitmap(blob);
      } catch {
        logo = null;
      }
    };
    // Layer 3 media (image bitmap or looping muted video), reloaded when settings.media.version changes.
    let media: CanvasImageSource | null = null;
    let mediaVideo: HTMLVideoElement | null = null;
    let mediaVersion = -1;
    let mediaUrl: string | null = null;
    const loadMedia = async (version: number, kind: string | null) => {
      mediaVersion = version;
      if (mediaVideo) {
        mediaVideo.pause();
        mediaVideo.removeAttribute("src");
        mediaVideo = null;
      }
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      mediaUrl = null;
      media = null;
      if (!kind) return;
      const blob = await db.getSetting<Blob>("vjMedia");
      if (!blob) return;
      if (kind === "video") {
        const v = document.createElement("video");
        v.muted = true;
        v.loop = true;
        v.playsInline = true;
        mediaUrl = URL.createObjectURL(blob);
        v.src = mediaUrl;
        await v.play().catch(() => {});
        mediaVideo = v;
        media = v;
      } else media = await createImageBitmap(blob).catch(() => null);
    };
    const unsubFrame = source === "local" ? featureBus.subscribe(onFrame) : featureBus.listenRemote(onFrame);
    const unsubFx = (source === "local" ? featureBus.subscribeFx : featureBus.listenRemoteFx)((e) => fx.trigger(e, performance.now()));
    const unsub = () => {
      unsubFrame();
      unsubFx();
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: w, clientHeight: h } = canvas;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        scene.width = w * dpr;
        scene.height = h * dpr;
        scene2.width = w * dpr;
        scene2.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
      outCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w, h };
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const frame = frameRef.current;
      const { w, h } = resize();
      if (w === 0 || h === 0) return;
      if (!frame) {
        outCtx.fillStyle = "#000";
        outCtx.fillRect(0, 0, w, h);
        return;
      }
      const { features, settings } = frame;
      const now = performance.now();
      if ((settings.logoVersion ?? 0) !== logoVersion) void loadLogo(settings.logoVersion ?? 0);
      const md = settings.media;
      if (md && md.version !== mediaVersion) void loadMedia(md.version, md.kind);

      let presetId = settings.preset;
      if (settings.autoCycle) {
        if (!cyclePreset || now - cycleAt > 16000 || (features.beat && now - cycleAt > 8000 && Math.random() < 0.05)) {
          cycleAt = now;
          cyclePreset = presets[Math.floor(Math.random() * presets.length)].id;
        }
        presetId = cyclePreset;
      }
      const changed = presetId !== lastPreset;
      if (settings.director) director.step(now, features, settings, changed && lastPreset != null, scene);
      if (changed) {
        for (const k of Object.keys(state)) delete state[k];
        lastPreset = presetId;
      }

      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(0,0,0,${1 - settings.trails * 0.95})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";

      fx.step(now, features, settings, w, h);
      ctx.save();
      fx.transform(ctx);

      const draw = () =>
        presetById(presetId).draw({ ctx, w, h, t: (now - start) / 1000, f: features, s: settings, state });

      if (settings.mirror) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, w / 2, h);
        ctx.clip();
        draw();
        ctx.restore();
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.beginPath();
        ctx.rect(0, 0, w / 2, h);
        ctx.clip();
        draw();
        ctx.restore();
      } else draw();
      // Layer 2 (blended over the main preset, under the one-shot FX)
      const l2 = settings.layer2;
      if (l2?.preset && l2.opacity > 0.01) {
        if (l2.preset !== lastPreset2) {
          for (const k of Object.keys(state2)) delete state2[k];
          lastPreset2 = l2.preset;
        }
        ctx2.globalCompositeOperation = "source-over";
        ctx2.fillStyle = `rgba(0,0,0,${1 - settings.trails * 0.95})`;
        ctx2.fillRect(0, 0, w, h);
        ctx2.globalCompositeOperation = "lighter";
        const draw2 = () => presetById(l2.preset!).draw({ ctx: ctx2, w, h, t: (now - start) / 1000, f: features, s: settings, state: state2 });
        if (l2.mirror) {
          ctx2.save();
          ctx2.beginPath();
          ctx2.rect(0, 0, w / 2, h);
          ctx2.clip();
          draw2();
          ctx2.restore();
          ctx2.save();
          ctx2.translate(w, 0);
          ctx2.scale(-1, 1);
          ctx2.beginPath();
          ctx2.rect(0, 0, w / 2, h);
          ctx2.clip();
          draw2();
          ctx2.restore();
        } else draw2();
        ctx.globalCompositeOperation = l2.blend;
        ctx.globalAlpha = l2.opacity;
        ctx.drawImage(scene2, 0, 0, w, h);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "lighter";
      } else lastPreset2 = null;
      // Layer 3: image / video, fitted and blended (opacity can pulse with the kick)
      if (md && media) {
        const mw = media instanceof HTMLVideoElement ? media.videoWidth : (media as ImageBitmap).width;
        const mh = media instanceof HTMLVideoElement ? media.videoHeight : (media as ImageBitmap).height;
        if (mw && mh) {
          const k = (md.fit === "cover" ? Math.max : Math.min)(w / mw, h / mh);
          ctx.globalCompositeOperation = md.blend;
          ctx.globalAlpha = Math.min(1, md.opacity * (md.pulse ? 0.55 + Math.max(features.bass, 1 - features.beatPhase) * 0.6 : 1));
          ctx.drawImage(media, (w - mw * k) / 2, (h - mh * k) / 2, mw * k, mh * k);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "lighter";
        }
      }
      fx.draw(ctx, now, features, settings);
      ctx.restore();
      if (settings.director) director.compose(outCtx, scene, w, h, now, features, settings);
      else {
        outCtx.globalCompositeOperation = "source-over";
        outCtx.drawImage(scene, 0, 0, w, h);
      }
      drawOverlay(outCtx, w, h, settings, logo);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      mediaVideo?.pause();
      if (mediaUrl) URL.revokeObjectURL(mediaUrl);
      unsub();
    };
  }, [source]);

  return <canvas ref={canvasRef} className={className ?? "h-full w-full"} />;
}
