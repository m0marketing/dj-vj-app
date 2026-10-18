"use client";

import { useRef, useState } from "react";
import { presets, presetById } from "@/lib/vj/presets";
import { BUILTIN_LOOKS, showParams, type AudioFeatures, type VJSettings } from "@/lib/types";
import { parseAssistantRequest, parseAssistantResult, trackForAssistant } from "@/lib/ai/assistant";

interface Check { name: string; passed: boolean; detail: string }
const settings: VJSettings = { preset: "dd_title", hue: 210, intensity: 1, sensitivity: 1, autoCycle: false, mirror: false, trails: 0.2, strobe: false, autoDrop: false, autoHype: false, ddTheme: "devday", follow: false, hypeLevel: "low", pool: "devday", theme: "devday", show: "keynote", nowPlaying: false, layer2: { preset: null, blend: "screen", opacity: 0 }, media: { version: 0, kind: null, blend: "screen", opacity: 0, fit: "contain", pulse: false }, colorMode: "fixed", palette: "devday", presetLock: true, director: false, overlayText: "Rehearsal", logoVersion: 0 };
function features(frame: number): AudioFeatures {
  return { level: 0.6, bass: 0.5, mid: 0.4, high: 0.3, beat: frame % 2 === 0, beatPhase: 0.2, bpm: 120, spectrum: new Uint8Array(256).fill(160), waveform: Uint8Array.from({ length: 256 }, (_, i) => 128 + Math.round(Math.sin(i / 8) * 90)) };
}
function draw(canvas: HTMLCanvasElement, id: VJSettings["preset"]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D が利用できません。");
  const state = {};
  for (let frame = 0; frame < 8; frame++) {
    ctx.save();
    try { presetById(id).draw({ ctx, w: canvas.width, h: canvas.height, f: features(frame), s: { ...settings, preset: id }, state, t: 2 + frame * 0.25 }); }
    finally { ctx.restore(); }
  }
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  if (!pixels.some((value, i) => i % 4 !== 3 && value > 15)) throw new Error("描画された色を確認できません。");
}
export default function RehearsalLab() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const [finishedAt, setFinishedAt] = useState("");
  const [look, setLook] = useState("未選択");
  const [runtimeError, setRuntimeError] = useState("");
  async function run() {
    if (busy) return;
    setBusy(true); setChecks([]); setFinishedAt(""); setRuntimeError("");
    const results: Check[] = [];
    const check = (name: string, fn: () => void) => {
      try { fn(); results.push({ name, passed: true, detail: "確認済み" }); }
      catch (error) { results.push({ name, passed: false, detail: error instanceof Error ? error.message : "失敗" }); }
    };
    check("音源を送信データに含めない", () => {
      const track = { id: "fixture", name: "Fixture", duration: 120, bpm: 120, key: "8A", blob: "PRIVATE" };
      if (JSON.stringify(trackForAssistant(track)).includes("PRIVATE")) throw new Error("音源が含まれています。");
    });
    check("対象外の曲順を拒否", () => {
      const input = parseAssistantRequest({ kind: "set", prompt: "test", count: 2, tracks: [{ id: "a", name: "A", duration: 120, bpm: 120, key: null }, { id: "b", name: "B", duration: 120, bpm: 122, key: null }] });
      let rejected = false;
      try { parseAssistantResult(input, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ title: "Invalid", summary: "Fixture", tracks: [{ trackId: "a", reason: "A" }, { trackId: "missing", reason: "B" }] }) }] }] }); } catch { rejected = true; }
      if (!rejected) throw new Error("対象外の曲を受理しました。");
    });
    check("低確信度の映像提案を拒否", () => {
      let rejected = false;
      try { parseAssistantResult({ kind: "scene", prompt: "test" }, { answers: [{ name: "look", type: "choice", choice: "deep", confidence: 0.1 }] }); } catch { rejected = true; }
      if (!rejected) throw new Error("低確信度の提案を受理しました。");
    });
    check("自動演出のストロボOFF", () => { if (showParams("auto", 1).strobe) throw new Error("ストロボが有効です。"); });
    for (const preset of presets) {
      check(`描画: ${preset.name}`, () => {
        // A fresh canvas/state prevents an earlier preset from hiding a blank render.
        const target = document.createElement("canvas"); target.width = 320; target.height = 180;
        draw(target, preset.id);
      });
      setChecks([...results]);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    try { draw(canvas.current!, "dd_title"); setLook("DevDay キーノート"); } catch (e) { setRuntimeError(String(e)); }
    setChecks(results); setFinishedAt(new Date().toISOString()); setBusy(false);
  }
  function choose(id: string) {
    const selected = BUILTIN_LOOKS.find((l) => l.id === id)!;
    try { draw(canvas.current!, selected.preset ?? "starfield"); setLook(selected.name); setRuntimeError(""); }
    catch (error) { setRuntimeError(error instanceof Error ? error.message : "描画に失敗しました。"); }
  }
  function download() {
    const blob = new Blob([JSON.stringify({ version: 1, finishedAt, scope: "fixture validation and actual Canvas presets; audio, devices and production data excluded", checks, runtimeError }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = "djvj-rehearsal.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
    <h1 className="text-xl font-semibold">DJ/VJ 隔離リハーサル</h1>
    <p className="text-sm leading-relaxed text-zinc-400">内蔵の検証データで入力検証と実際のVJ描画コードを確認します。本番の音源・IndexedDB・再生キューは読み書きしません。音声・MIDI・実機出力は別途確認してください。</p>
    <div className="flex flex-wrap gap-2"><button className="btn btn-primary" onClick={() => void run()} disabled={busy}>{busy ? "検証中…" : "自動リハーサル開始"}</button><button className="btn" onClick={download} disabled={!finishedAt}>結果JSONを保存</button></div>
    <div className="panel flex flex-col gap-3 p-3"><p className="text-sm">場面: <span data-testid="rehearsal-look">{look}</span></p><canvas ref={canvas} width={640} height={360} className="aspect-video w-full rounded bg-black" aria-label="リハーサル映像" /><div className="flex flex-wrap gap-2"><button className="btn" disabled={busy} onClick={() => choose("keynote")}>DevDay キーノート</button><button className="btn" disabled={busy} onClick={() => choose("deep")}>ディープ</button></div></div>
    <p role="status" data-testid="rehearsal-status" data-complete={!!finishedAt} data-failed={checks.filter((c) => !c.passed).length + (runtimeError ? 1 : 0)} className="font-mono text-sm">{finishedAt ? "完了" : busy ? "実行中" : "未実行"} · 成功 {checks.filter((c) => c.passed).length} / 失敗 {checks.filter((c) => !c.passed).length + (runtimeError ? 1 : 0)}</p>
    {runtimeError && <p role="alert" className="text-rose-300">{runtimeError}</p>}
    <ul className="grid gap-1 text-xs sm:grid-cols-2">{checks.map((c) => <li key={c.name} className={c.passed ? "text-emerald-300" : "text-rose-300"}>{c.passed ? "✓" : "✕"} {c.name}{!c.passed && `: ${c.detail}`}</li>)}</ul>
  </main>;
}
