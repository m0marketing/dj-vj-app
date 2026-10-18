/**
 * Web MIDI controller support with "MIDI learn": any CC / note on any input can be bound to a target.
 * Bindings are stored in localStorage (`midiMap`) as { "cc:ch:num" | "note:ch:num": targetId }.
 * Ranges (faders / knobs) receive 0..1; buttons get press / release so pads and CUE can be held.
 */
import { useDJ } from "./store";
import { PADS_PER_BANK, type DeckId } from "./types";

export interface MidiTarget {
  id: string;
  label: string;
  group: string;
  kind: "range" | "button";
  /** range: value 0..1 */
  set?: (v: number) => void;
  press?: () => void;
  release?: () => void;
}

const deckTargets = (id: DeckId): MidiTarget[] => {
  const act = (fn: Parameters<ReturnType<typeof useDJ.getState>["deckAction"]>[1]) => useDJ.getState().deckAction(id, fn);
  const eq = (band: "low" | "mid" | "high", label: string): MidiTarget => ({ id: `eq${band}${id}`, label: `EQ ${label} ${id}`, group: `Deck ${id}`, kind: "range", set: (v) => act((d) => d.setEQ(band, -24 + v * 36)) });
  return [
    { id: `play${id}`, label: `▶ / ❚❚ ${id}`, group: `Deck ${id}`, kind: "button", press: () => act((d) => d.togglePlay()) },
    { id: `cue${id}`, label: `CUE ${id}`, group: `Deck ${id}`, kind: "button", press: () => act((d) => d.cuePress()), release: () => act((d) => d.cueRelease()) },
    { id: `sync${id}`, label: `SYNC ${id}`, group: `Deck ${id}`, kind: "button", press: () => useDJ.getState().syncToOther(id) },
    { id: `vol${id}`, label: `Volume ${id}`, group: `Deck ${id}`, kind: "range", set: (v) => act((d) => d.setVolume(v)) },
    eq("low", "Low"),
    eq("mid", "Mid"),
    eq("high", "High"),
    { id: `filter${id}`, label: `Filter ${id}`, group: `Deck ${id}`, kind: "range", set: (v) => act((d) => d.setFilter(v * 2 - 1)) },
    { id: `pitch${id}`, label: `Pitch ${id} (±8%)`, group: `Deck ${id}`, kind: "range", set: (v) => act((d) => d.setRate(1 + (v * 2 - 1) * 0.08)) },
    ...[0, 1, 2, 3].map((i): MidiTarget => ({ id: `hot${id}${i}`, label: `HOT ${i + 1} ${id}`, group: `Deck ${id}`, kind: "button", press: () => act((d) => d.jumpCue(i)) })),
    { id: `loop4${id}`, label: `Loop 4 拍 ${id}`, group: `Deck ${id}`, kind: "button", press: () => act((d) => d.setBeatLoop(4, d.track?.bpm ?? null)) },
    { id: `scratch${id}`, label: `Baby Scratch ${id}`, group: `Deck ${id}`, kind: "button", press: () => useDJ.getState().scratch(id, "baby") },
  ];
};

export const midiTargets = (): MidiTarget[] => {
  const s = () => useDJ.getState();
  return [
    { id: "xf", label: "クロスフェーダー", group: "Mixer", kind: "range", set: (v) => s().setCrossfader(v) },
    { id: "master", label: "Master", group: "Mixer", kind: "range", set: (v) => s().setMasterVolume(v) },
    { id: "sampler", label: "Sampler Vol", group: "Mixer", kind: "range", set: (v) => s().setSamplerVolume(v) },
    { id: "mic", label: "Mic Gain", group: "Mixer", kind: "range", set: (v) => s().setMic({ gain: v * 2 }) },
    { id: "mix", label: "今すぐ繋ぐ (Auto Mix)", group: "Mixer", kind: "button", press: () => void s().autoMix() },
    { id: "cancel", label: "ミックス中止", group: "Mixer", kind: "button", press: () => s().cancelMix() },
    { id: "fadeout", label: "Fade Out", group: "Mixer", kind: "button", press: () => s().fadeOut() },
    { id: "build", label: "Build & Drop", group: "Hype", kind: "button", press: () => s().buildDrop(8) },
    { id: "crowd", label: "Crowd!", group: "Hype", kind: "button", press: () => s().crowd() },
    { id: "throw", label: "Echo Throw", group: "Hype", kind: "button", press: () => s().echoThrow() },
    { id: "rise", label: "Filter Rise", group: "Hype", kind: "button", press: () => s().filterRise(4) },
    { id: "gate", label: "Gate ⅛ (押している間)", group: "Hype", kind: "button", press: () => s().gateHold(0.5), release: () => s().gateHold(null) },
    { id: "echo", label: "Echo (押している間)", group: "Hype", kind: "button", press: () => s().setFx("echo", true), release: () => s().setFx("echo", false) },
    { id: "hpf", label: "HPF ↑ (押している間)", group: "Hype", kind: "button", press: () => s().setFilterFx("hpf"), release: () => s().setFilterFx(null) },
    { id: "lpf", label: "LPF ↓ (押している間)", group: "Hype", kind: "button", press: () => s().setFilterFx("lpf"), release: () => s().setFilterFx(null) },
    ...Array.from({ length: PADS_PER_BANK }, (_, i): MidiTarget => ({
      id: `pad${i}`,
      label: `Pad ${i + 1} (現在のバンク)`,
      group: "Sampler",
      kind: "button",
      press: () => s().pressPad(s().bank * PADS_PER_BANK + i),
      release: () => s().releasePad(s().bank * PADS_PER_BANK + i),
    })),
    ...deckTargets("A"),
    ...deckTargets("B"),
    ...Array.from({ length: 10 }, (_, i): MidiTarget => ({ id: `look${i}`, label: `Look ${i + 1}`, group: "VJ", kind: "button", press: () => { const l = s().looks[i]; if (l) s().applyLook(l.id); } })),
    { id: "live", label: "本番モード ON/OFF", group: "VJ", kind: "button", press: () => useDJ.setState({ liveView: !s().liveView }) },
  ];
};

type Listener = (state: MidiState) => void;
export interface MidiState {
  supported: boolean;
  enabled: boolean;
  inputs: string[];
  map: Record<string, string>;
  learning: string | null;
  last: string | null; // last key seen (for the UI)
}

class MidiController {
  state: MidiState = { supported: typeof navigator !== "undefined" && "requestMIDIAccess" in navigator, enabled: false, inputs: [], map: {}, learning: null, last: null };
  private access: MIDIAccess | null = null;
  private listeners = new Set<Listener>();
  private targets = new Map<string, MidiTarget>();
  private held = new Set<string>();

  constructor() {
    try {
      this.state.map = JSON.parse(localStorage.getItem("midiMap") ?? "{}");
    } catch {}
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    fn(this.state);
    return () => void this.listeners.delete(fn);
  }
  private emit(patch: Partial<MidiState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async enable() {
    if (!this.state.supported) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    const attach = () => {
      const names: string[] = [];
      this.access!.inputs.forEach((inp) => {
        names.push(inp.name ?? inp.id);
        inp.onmidimessage = (ev) => this.onMessage(ev);
      });
      this.emit({ inputs: names, enabled: true });
    };
    this.access.onstatechange = attach;
    attach();
    return true;
  }

  learn(targetId: string | null) {
    this.emit({ learning: targetId });
  }
  unbind(targetId: string) {
    const map = Object.fromEntries(Object.entries(this.state.map).filter(([, t]) => t !== targetId));
    this.save(map);
  }
  clear() {
    this.save({});
  }
  private save(map: Record<string, string>) {
    localStorage.setItem("midiMap", JSON.stringify(map));
    this.emit({ map });
  }
  bindingFor(targetId: string) {
    return Object.entries(this.state.map).find(([, t]) => t === targetId)?.[0] ?? null;
  }

  private target(id: string) {
    if (!this.targets.size) for (const t of midiTargets()) this.targets.set(t.id, t);
    return this.targets.get(id);
  }

  private onMessage(ev: MIDIMessageEvent) {
    const d = ev.data;
    if (!d || d.length < 2) return;
    const status = d[0] & 0xf0;
    const ch = d[0] & 0x0f;
    const num = d[1];
    const val = d[2] ?? 0;
    let key: string;
    let value: number;
    let on: boolean;
    if (status === 0xb0) {
      key = `cc:${ch}:${num}`;
      value = val / 127;
      on = val >= 64;
    } else if (status === 0x90 || status === 0x80) {
      key = `note:${ch}:${num}`;
      on = status === 0x90 && val > 0;
      value = on ? 1 : 0;
    } else return;
    this.emit({ last: key });
    if (this.state.learning) {
      // Learn: a note binds on press only; a CC binds on first movement.
      if (status !== 0xb0 && !on) return;
      const map = { ...this.state.map, [key]: this.state.learning };
      this.save(map);
      this.emit({ learning: null });
      useDJ.getState().setToast(`MIDI: ${key} → ${this.target(this.state.map[key])?.label ?? ""}`, "success");
      return;
    }
    const tid = this.state.map[key];
    if (!tid) return;
    const t = this.target(tid);
    if (!t) return;
    if (t.kind === "range") t.set?.(value);
    else if (on && !this.held.has(key)) {
      this.held.add(key);
      t.press?.();
    } else if (!on && this.held.has(key)) {
      this.held.delete(key);
      t.release?.();
    }
  }
}

let ctrl: MidiController | null = null;
export const getMidi = () => (ctrl ??= new MidiController());
