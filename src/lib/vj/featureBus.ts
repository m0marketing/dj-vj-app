"use client";

import type { AudioFeatures, VJFxEvent, VJSettings } from "../types";

export interface VJFrame {
  features: AudioFeatures;
  settings: VJSettings;
}

type Listener = (frame: VJFrame) => void;
type FxListener = (e: VJFxEvent) => void;

const CHANNEL = "dj-vj-features";
const listeners = new Set<Listener>();
const fxListeners = new Set<FxListener>();
let channel: BroadcastChannel | null = null;
let lastBroadcast = 0;

function getChannel() {
  if (!channel && typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(CHANNEL);
  return channel;
}

export const featureBus = {
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Publish from the main (audio-owning) tab. */
  publish(frame: VJFrame, now: number) {
    for (const l of listeners) l(frame);
    const ch = getChannel();
    if (ch && now - lastBroadcast > 33) {
      lastBroadcast = now;
      // Downsample spectrum for cheap cross-tab transfer.
      const spec = new Uint8Array(64);
      const step = Math.max(1, Math.floor(frame.features.spectrum.length / 64));
      for (let i = 0; i < 64; i++) spec[i] = frame.features.spectrum[i * step];
      const wave = new Uint8Array(128);
      const wstep = Math.max(1, Math.floor(frame.features.waveform.length / 128));
      for (let i = 0; i < 128; i++) wave[i] = frame.features.waveform[i * wstep];
      ch.postMessage({ ...frame, features: { ...frame.features, spectrum: spec, waveform: wave } });
    }
  },

  /** Listen from a secondary (projector) tab. */
  listenRemote(fn: Listener) {
    const ch = getChannel();
    if (!ch) return () => {};
    const handler = (e: MessageEvent) => e.data?.type !== "fx" && fn(e.data as VJFrame);
    ch.addEventListener("message", handler);
    return () => ch.removeEventListener("message", handler);
  },

  subscribeFx(fn: FxListener) {
    fxListeners.add(fn);
    return () => {
      fxListeners.delete(fn);
    };
  },

  /** Fire a one-off visual effect (pad hit, button, auto-drop) locally and on the projector tab. */
  triggerFx(event: VJFxEvent) {
    for (const l of fxListeners) l(event);
    getChannel()?.postMessage({ type: "fx", event });
  },

  listenRemoteFx(fn: FxListener) {
    const ch = getChannel();
    if (!ch) return () => {};
    const handler = (e: MessageEvent) => e.data?.type === "fx" && fn(e.data.event as VJFxEvent);
    ch.addEventListener("message", handler);
    return () => ch.removeEventListener("message", handler);
  },
};
