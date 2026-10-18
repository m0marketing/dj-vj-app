"use client";

import { useEffect } from "react";
import { useDJ } from "@/lib/store";
import { featureBus } from "@/lib/vj/featureBus";
import { PAD_BANKS, PAD_KEYS, PADS_PER_BANK, type DeckId, type VJFxId } from "@/lib/types";

/**
 * Keyboard map (see ShortcutsOverlay for the user-facing list)
 *  Pads:        1 2 3 4 / Q W E R / A S D F / Z X C V
 *  Deck A:      Shift+Space play, Shift+1..4 cue, [ / ] pitch
 *  Deck B:      Space play, ; / ' pitch
 *  Crossfader:  ← →
 *  Banks:       F1-F8 or - / =   (Tab is left alone so keyboard focus navigation keeps working)
 *  Mix:         M = auto mix, B = break, Y = build & drop, U = crowd, H / L (hold) = HPF / LPF sweep
 *  Echo throw:  ` (hold, sampler bus)   Master FX: G = echo, J = reverb, K = flanger (hold)
 *  VJ FX:       Enter = DROP, , = confetti, . = lasers, / = fireworks
 *  Esc = stop all samples, ? = shortcut overlay
 */
export default function KeyboardShortcuts() {
  const ready = useDJ((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const held = new Set<string>();
    const isTyping = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName) || el.isContentEditable);
    };
    // Enter / Space on a focused button must only activate that button, never a global shortcut.
    const onButton = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.tagName === "BUTTON" && (e.code === "Enter" || e.code === "Space" || e.code === "NumpadEnter");
    // Drop focus after mouse / touch clicks so Space / Enter go back to the decks right away.
    const blurButtons = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || e.pointerType === "touch" || e.pointerType === "pen") (e.target as HTMLElement | null)?.closest?.("button")?.blur();
    };

    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (useDJ.getState().confirmRequest) return;
      if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) {
        e.preventDefault();
        return useDJ.getState().setShowShortcuts(!useDJ.getState().showShortcuts);
      }
      if (useDJ.getState().showShortcuts) return;
      if (onButton(e)) return;
      const key = e.key.toLowerCase();
      const s = useDJ.getState();
      const pad = PAD_KEYS.indexOf(key);
      if (pad >= 0 && !e.shiftKey) {
        if (held.has(key)) return;
        held.add(key);
        e.preventDefault();
        return s.pressPad(s.bank * PADS_PER_BANK + pad);
      }
      if (/^F[1-8]$/.test(e.code)) {
        e.preventDefault();
        return s.setBank(parseInt(e.code.slice(1)) - 1);
      }
      if (e.code === "Minus" || e.code === "Equal") {
        e.preventDefault();
        return s.setBank((s.bank + (e.code === "Minus" ? PAD_BANKS - 1 : 1)) % PAD_BANKS);
      }
      if (e.code === "Tab") {
        e.preventDefault();
        return useDJ.setState({ liveView: !s.liveView });
      }
      if (e.code === "Backspace") {
        e.preventDefault();
        return s.mixing ? s.cancelMix() : undefined;
      }
      // Looks: 5-9 = Look 1-5, Shift+5-9 = Look 6-10
      if (/^Digit[5-9]$/.test(e.code)) {
        e.preventDefault();
        const i = parseInt(e.code.slice(5)) - 5 + (e.shiftKey ? 5 : 0);
        const look = s.looks[i];
        if (look) s.applyLook(look.id);
        return;
      }
      if ((e.code === "Enter" || e.code === "NumpadEnter") && e.shiftKey) {
        e.preventDefault();
        if (!e.repeat) void s.autoMix({ style: "doubledrop" });
        return;
      }
      switch (e.code) {
        case "Space":
          e.preventDefault();
          return s.deckAction(e.shiftKey ? "A" : "B", (d) => d.togglePlay());
        case "ArrowLeft":
          e.preventDefault();
          return s.setCrossfader(Math.max(0, s.crossfader - 0.05));
        case "ArrowRight":
          e.preventDefault();
          return s.setCrossfader(Math.min(1, s.crossfader + 0.05));
        case "BracketLeft":
          return s.deckAction("A", (d) => d.setRate(d.rate - 0.005));
        case "BracketRight":
          return s.deckAction("A", (d) => d.setRate(d.rate + 0.005));
        case "Semicolon":
          return s.deckAction("B", (d) => d.setRate(d.rate - 0.005));
        case "Quote":
          return s.deckAction("B", (d) => d.setRate(d.rate + 0.005));
        case "Escape":
          return s.stopAll();
      }
      const fxKey: Record<string, [string, string?]> = { Enter: ["drop", "DROP!"], NumpadEnter: ["drop", "DROP!"], Comma: ["confetti"], Period: ["lasers"], Slash: ["fireworks"] };
      if (fxKey[e.code]) {
        e.preventDefault();
        const [fx, text] = fxKey[e.code];
        if (!e.repeat) featureBus.triggerFx({ fx: fx as VJFxId, hue: s.vj.hue, text });
        return;
      }
      const mixKeys: Record<string, () => void> = {
        KeyM: () => void s.autoMix(),
        KeyB: () => s.doBreak(4),
        KeyY: () => s.buildDrop(8),
        KeyP: () => s.seqToggle(),
        KeyU: () => s.crowd(),
        KeyH: () => s.setFilterFx("hpf"),
        KeyL: () => s.setFilterFx("lpf"),
        KeyT: () => s.echoThrow(),
        KeyI: () => s.filterRise(4),
        KeyN: () => {
          const main: DeckId = s.decks.A.playing && s.decks.B.playing ? (s.crossfader < 0.5 ? "A" : "B") : s.decks.A.playing ? "A" : "B";
          s.scratch(main, "baby");
        },
        KeyO: () => s.gateHold(0.5),
      };
      if (mixKeys[e.code]) {
        e.preventDefault();
        if (!e.repeat) mixKeys[e.code]();
        return;
      }
      if (e.code === "Backquote") {
        e.preventDefault();
        if (!e.repeat) s.setEcho(true);
        return;
      }
      const fxKeys: Record<string, "echo" | "reverb" | "flanger"> = { KeyG: "echo", KeyJ: "reverb", KeyK: "flanger" };
      if (fxKeys[e.code]) {
        e.preventDefault();
        if (!e.repeat) s.setFx(fxKeys[e.code], true);
        return;
      }
      if (e.shiftKey && /^Digit[1-4]$/.test(e.code)) {
        const i = parseInt(e.code.slice(5)) - 1;
        return s.deckAction("A", (d) => d.jumpCue(i));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Backquote") useDJ.getState().setEcho(false);
      if (e.code === "KeyH" || e.code === "KeyL") useDJ.getState().setFilterFx(null);
      if (e.code === "KeyO") useDJ.getState().gateHold(null);
      if (e.code === "KeyG") useDJ.getState().setFx("echo", false);
      if (e.code === "KeyJ") useDJ.getState().setFx("reverb", false);
      if (e.code === "KeyK") useDJ.getState().setFx("flanger", false);
      const key = e.key.toLowerCase();
      const pad = PAD_KEYS.indexOf(key);
      const s = useDJ.getState();
      if (held.delete(key) && pad >= 0) for (let b = 0; b < PAD_BANKS; b++) s.releasePad(b * PADS_PER_BANK + pad);
    };
    const blur = () => {
      for (const k of held) {
        const pad = PAD_KEYS.indexOf(k);
        if (pad >= 0) for (let b = 0; b < PAD_BANKS; b++) useDJ.getState().releasePad(b * PADS_PER_BANK + pad);
      }
      held.clear();
      useDJ.getState().setEcho(false);
      useDJ.getState().setFilterFx(null);
      for (const n of ["echo", "reverb", "flanger"] as const) useDJ.getState().setFx(n, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("pointerup", blurButtons, true);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("pointerup", blurButtons, true);
    };
  }, [ready]);
  return null;
}
