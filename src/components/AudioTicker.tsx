"use client";

import { useEffect } from "react";
import { getEngine } from "@/lib/audio/engine";
import type { DeckState } from "@/lib/audio/deck";
import { showParams, VJ_PALETTES, type AudioFeatures, type DeckId, type VJSettings } from "@/lib/types";
import { autoTarget, beatsFor, effectiveStyle, leadMs, nextDropAfter, segCaps, segStarts, snapToPhrase, spentTracks, useDJ } from "@/lib/store";
import { featureBus } from "@/lib/vj/featureBus";

const POOLS: Record<VJSettings["pool"], { hot: readonly VJSettings["preset"][]; calm: readonly VJSettings["preset"][] }> = {
  auto: { hot: ["strobe", "lasers", "typo", "kaleido", "tunnel", "particles", "rays", "starfield"], calm: ["rings", "plasma", "scope", "disco", "grid", "bars"] },
  classic: { hot: ["strobe", "lasers", "tunnel", "particles", "rays", "bars"], calm: ["rings", "disco", "grid", "bars"] },
  calm: { hot: ["rings", "plasma", "starfield", "disco", "kaleido"], calm: ["rings", "plasma", "scope", "starfield"] },
  // DevDay 2026: the branded presets only - loud sections get the bold ones, breakdowns the quiet terminal / brackets.
  devday: { hot: ["dd_launch", "dd_pulse", "dd_swarm", "dd_faces", "dd_title", "dd_products", "dd_ticker", "dd_stack"], calm: ["dd_terminal", "dd_brackets", "dd_title", "dd_swarm"] },
};
/** Music-reactive VJ: derived settings published every frame (the stored settings are left untouched). */
const fm = { hue: 200, intensity: 1, trails: 0.25, preset: null as VJSettings["preset"] | null, lastBar: -1, calm: false, quietSince: 0, lastDrop: 0, setEnergy: 0.5, lastT: 0 };
function followMusic(vj: VJSettings, f: AudioFeatures, decks: Record<DeckId, DeckState>, xf: number, now: number): VJSettings {
  const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track);
  const id = playing.length === 1 ? playing[0] : xf < 0.5 ? "A" : "B";
  const d = decks[id];
  const t = d.track;
  // Hue from the musical key (Camelot neighbours end up as neighbouring hues), slowly eased.
  // Colour: key of the track (follow), a fixed hue, or a palette stepping one colour per 8-bar phrase.
  const keyHue = t?.keyRoot != null ? (((t.keyRoot * 7) % 12) * 30 + (t.keyMinor ? 15 : 0)) % 360 : vj.hue;
  const pal = VJ_PALETTES.find((p) => p.id === vj.palette) ?? VJ_PALETTES[0];
  const phraseIdx = t?.bpm && d.playing ? Math.floor(((d.position - (t.beatOffset ?? 0)) * t.bpm) / 60 / 32) : 0;
  const targetHue = vj.colorMode === "fixed" ? vj.hue : vj.colorMode === "palette" ? pal.hues[((phraseIdx % pal.hues.length) + pal.hues.length) % pal.hues.length] : keyHue;
  const dh = ((targetHue - fm.hue + 540) % 360) - 180;
  fm.hue = (fm.hue + dh * 0.02 + 360) % 360;
  // Intensity breathes with the energy; trails open up in quiet parts.
  const energy = Math.min(1, f.level * 1.6);
  fm.intensity += (vj.intensity * (0.75 + energy * 0.6) - fm.intensity) * 0.1;
  // Slow set energy (same constant as the Director) for the auto show's pacing decisions.
  const dtE = Math.min(0.1, (now - (fm.lastT || now)) / 1000);
  fm.lastT = now;
  fm.setEnergy += (energy - fm.setEnergy) * Math.min(1, dtE * 0.35);
  const quiet = energy < 0.22;
  if (quiet) fm.quietSince ||= now;
  else if (fm.quietSince && now - fm.quietSince > 400) fm.quietSince = 0;
  const breakdown = !!fm.quietSince && now - fm.quietSince > 2500 && d.playing;
  fm.trails += ((breakdown ? 0.6 : vj.trails) - fm.trails) * 0.05;
  // A preset picked by hand stays: follow then only drives colour / intensity / trails.
  if (vj.presetLock || vj.autoCycle) {
    fm.preset = null;
    return { ...vj, hue: fm.hue, intensity: fm.intensity, trails: fm.trails };
  }
  // Pool changed (a Theme switch): leave presets that are not part of it right away.
  {
    const p = POOLS[vj.pool ?? "auto"];
    if (fm.preset && !p.hot.includes(fm.preset) && !p.calm.includes(fm.preset)) fm.preset = (fm.calm ? p.calm : p.hot)[0];
  }
  // Phrase boundaries from the beat grid of the playing deck: new preset every N bars (N from the show style),
  // calm presets in breakdowns.
  const every = showParams(vj.show, fm.setEnergy, vj.showCustom).phraseBars;
  if (t?.bpm && d.playing) {
    const bar = Math.floor(((d.position - (t.beatOffset ?? 0)) * t.bpm) / 60 / 4);
    if (bar !== fm.lastBar) {
      const wasCalm = fm.calm;
      fm.calm = breakdown;
      if (fm.lastBar >= 0 && (bar % every === 0 || wasCalm !== fm.calm || !fm.preset)) {
        const p = POOLS[vj.pool ?? "auto"];
        const pool = fm.calm ? p.calm : p.hot;
        fm.preset = pool[Math.floor(Math.random() * pool.length)];
        if (bar % 32 === 0 && !fm.calm) featureBus.triggerFx({ fx: "shock", hue: fm.hue });
      }
      fm.lastBar = bar;
    }
  } else if (!fm.preset) fm.preset = vj.preset;
  // Drop: energy slams back after a breakdown.
  if (breakdown && !quiet && now - fm.lastDrop > 8000) {
    fm.lastDrop = now;
    fm.quietSince = 0;
    fm.calm = false;
    const hot = POOLS[vj.pool ?? "auto"].hot;
    fm.preset = hot[Math.floor(Math.random() * hot.length)];
    featureBus.triggerFx({ fx: "drop", hue: fm.hue, text: "DROP!" });
    if (showParams(vj.show, fm.setEnergy, vj.showCustom).dropFx) {
      setTimeout(() => featureBus.triggerFx({ fx: "lasers", hue: fm.hue }), 120);
      setTimeout(() => featureBus.triggerFx({ fx: "confetti", hue: fm.hue }), 260);
    }
  }
  return { ...vj, hue: fm.hue, intensity: fm.intensity, trails: fm.trails, preset: fm.preset ?? vj.preset };
}

/** Drives feature extraction (every frame) and deck-state sync (~12Hz). */
export default function AudioTicker() {
  const ready = useDJ((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const engine = getEngine();
    let raf = 0;
    let lastSync = 0;
    // Breakdown -> drop detector: loud, then quiet for 0.7s+, then a sudden loud hit.
    let heard = false;
    let quietSince = 0;
    let lastQuiet = 0;
    let lastDrop = 0;
    let beatCount = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const { vj, syncDecks, decks, autoDJ, autoFollow, autoStyle, plannedStyle, autoMix, mixOut, mixBeats, preloadNext, planStyle, djSegment, mode, plan, mixing } = useDJ.getState();
      // Set plan: when the time is up, fade the set out and stop (no new transition is started).
      if (plan && autoDJ) {
        const remain = plan.minutes * 60 - (Date.now() - plan.startedAt) / 1000;
        if (remain <= 0 && !mixing) {
          const st = useDJ.getState();
          st.fadeOut();
          st.setAutoDJ(false);
          st.stopPlan(`セット終了: ${plan.songs} 曲 / ${plan.minutes} 分のプランが完了しました`);
        } else if (remain < 45 && remain > 0 && !mixing && (decks.A.playing || decks.B.playing)) {
          // Last stretch: never start a new song that cannot finish - stretch the current segment to the end.
          for (const id of ["A", "B"] as const) if (decks[id].playing) segCaps[id] = Math.max(segCaps[id], decks[id].position - segStarts[id] + remain + 1);
        }
      }
      if (autoDJ || autoFollow) {
        for (const id of ["A", "B"] as const) {
          const d = decks[id];
          const oid = id === "A" ? "B" : "A";
          const other = decks[oid];
          if (!d.playing || other.playing || !d.duration) continue;
          const nextReady = !!other.track && other.track.id !== spentTracks[oid];
          // Auto DJ: keep the idle deck loaded with the next pick (visible, cue-able) right away, not just near the end.
          if (autoDJ && !nextReady) void preloadNext(id);
          if (autoStyle === "auto" && !plannedStyle && nextReady) planStyle(id);
          let rawTarget = autoDJ ? autoTarget(id, mixOut[id], d.duration, djSegment, d.track?.soundEnd, d.track?.chorusEnd) : Math.min(mixOut[id] ?? d.duration, d.track?.soundEnd ?? d.duration);
          const beats = autoDJ ? beatsFor(djSegment, mixBeats) : mixBeats;
          const bpm = (d.track?.bpm ?? 120) * d.rate;
          let style = effectiveStyle(autoStyle, plannedStyle);
          const bar = (4 * 60) / bpm;
          // Double drop: the event is the outgoing track's next drop, not the end of its segment.
          if (style === "doubledrop") {
            const drop = nextDropAfter(d.track, d.position + bar);
            if (drop != null && drop <= rawTarget + bar) rawTarget = drop;
            else style = "blend";
          }
          // EDM break cut: the outgoing track has been in a breakdown for a while and the next pick is ready ->
          // drop the incoming on the next bar line instead of waiting for the segment to end.
          if (autoDJ && mode === "edm" && nextReady && style !== "doubledrop" && quietSince && now - quietSince > 4000 && (rawTarget - d.position) / d.rate < 90) {
            void autoMix({ style: "breakcut", align: "bar", auto: true, beats });
            continue;
          }
          const lead = leadMs(style, beats, bpm) / 1000;
          // Finish the mix on a phrase line of the outgoing track (unless an explicit OUT mark was set).
          const target = mixOut[id] != null || style === "doubledrop" ? rawTarget : snapToPhrase(rawTarget, d.track, d.position, d.rate, lead + bar, djSegment);
          const remain = (target - d.position) / d.rate;
          // Start one bar early: the mix then lands on a bar line of the outgoing track.
          if (remain > lead + bar + 0.3) continue;
          if (!nextReady) {
            if (autoDJ) void autoMix({ loadNext: true, style: autoStyle === "auto" ? "blend" : autoStyle, align: "bar", auto: true, beats });
            continue;
          }
          void autoMix({ style, align: "bar", auto: autoDJ, beats });
        }
      }
      const features = engine.features.extract(now);
      // Prefer the analyzed BPM of the loudest playing deck over the live estimate.
      const playing = (["A", "B"] as const).filter((id) => decks[id].playing && decks[id].track?.bpm);
      if (playing.length) {
        const id = playing.length === 1 ? playing[0] : engine.crossfader < 0.5 ? "A" : "B";
        features.bpm = Math.round(decks[id].track!.bpm! * decks[id].rate);
      }
      const hypeEvery = vj.hypeLevel === "high" ? 8 : vj.hypeLevel === "low" ? 32 : 16;
      if (features.beat) beatCount++;
      if (features.beat && beatCount % hypeEvery === 0 && vj.autoHype) {
        const pool = ["confetti", "lasers", "fireworks", "emoji", "flash"] as const;
        const text = beatCount % (hypeEvery * 4) === 0 ? "HANDS UP!" : undefined;
        featureBus.triggerFx({ fx: text ? "text" : pool[Math.floor(Math.random() * pool.length)], hue: Math.random() * 360, text });
      }
      const level = features.level;
      if (level < 0.14) {
        quietSince ||= now;
        lastQuiet = now;
      } else {
        if (!quietSince && level > 0.3) heard = true;
        if (quietSince && now - lastQuiet > 500) quietSince = 0;
        if (vj.autoDrop && heard && quietSince && level > 0.3 && lastQuiet - quietSince > 700 && now - lastDrop > 6000) {
          lastDrop = now;
          quietSince = 0;
          featureBus.triggerFx({ fx: "drop", hue: vj.hue, text: "DROP!" });
        }
      }
      const live = vj.follow ? followMusic(vj, features, decks, engine.crossfader, now) : vj;
      featureBus.publish({ features, settings: live }, now);
      if (useDJ.getState().vjLive !== live.preset) useDJ.setState({ vjLive: live.preset });
      if (now - lastSync > 80 && (decks.A.playing || decks.B.playing)) {
        lastSync = now;
        syncDecks();
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready]);
  return null;
}
