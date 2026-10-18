"use client";

import { useEffect, useRef, useState } from "react";
import { useDJ } from "@/lib/store";
import { presets } from "@/lib/vj/presets";
import { VJ_BLENDS, VJ_PALETTES, VJ_SHOWS, VJ_THEMES, showParams, type VJShowParams } from "@/lib/types";
import type { VJFxId } from "@/lib/types";
import { featureBus } from "@/lib/vj/featureBus";
import VJCanvas from "./VJCanvas";
import HelpButton from "./HelpButton";

const QUICK_FX: { fx: VJFxId; label: string; text?: string; key?: string }[] = [
  { fx: "drop", label: "DROP", text: "DROP!", key: "Enter" },
  { fx: "confetti", label: "Confetti", key: "," },
  { fx: "lasers", label: "Lasers", key: "." },
  { fx: "fireworks", label: "Fireworks", key: "/" },
  { fx: "build", label: "Build" },
  { fx: "flash", label: "Flash" },
  { fx: "emoji", label: "Emoji" },
  { fx: "siren", label: "Siren" },
  { fx: "glitch", label: "Glitch" },
  { fx: "text", label: "HANDS UP", text: "HANDS UP!" },
  { fx: "text", label: "MAKE NOISE", text: "MAKE SOME NOISE!" },
  { fx: "clear", label: "Clear" },
];

const GROUPS: { title: string; match: (id: string) => boolean }[] = [
  { title: "Classic", match: (id) => ["bars", "rings", "particles", "tunnel", "grid", "strobe", "lasers", "disco", "rays"].includes(id) },
  { title: "New", match: (id) => ["scope", "kaleido", "starfield", "plasma", "typo"].includes(id) },
  { title: "DevDay 2026", match: (id) => id.startsWith("dd_") },
];

export default function VJPanel() {
  const vj = useDJ((s) => s.vj);
  const live = useDJ((s) => s.vjLive);
  const setVJ = useDJ((s) => s.setVJ);
  const [bpm, setBpm] = useState<number | null>(null);
  const [beat, setBeat] = useState(false);
  const [msg, setMsg] = useState("");
  const [more, setMore] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const looks = useDJ((s) => s.looks);
  const activeLook = useDJ((s) => s.activeLook);
  const [lookName, setLookName] = useState("");
  const autoParts = [vj.follow, vj.follow && !vj.presetLock, vj.director, vj.autoDrop, vj.autoHype];
  const autoOn = autoParts.filter(Boolean).length;
  const auto = autoOn === autoParts.length;
  const autoState: "on" | "partial" | "off" = auto ? "on" : autoOn ? "partial" : "off";
  const stageRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const fire = (fx: VJFxId, text?: string) => featureBus.triggerFx({ fx, hue: useDJ.getState().vj.hue, text });

  useEffect(() => {
    let last = 0;
    return featureBus.subscribe(({ features }) => {
      if (features.beat) {
        setBeat(true);
        setTimeout(() => setBeat(false), 80);
      }
      const now = performance.now();
      if (now - last > 500) {
        last = now;
        setBpm(features.bpm);
      }
    });
  }, []);

  return (
    <div className="panel flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">VJ</span>
          <HelpButton section="vj" />
          <span className={`h-2.5 w-2.5 rounded-full transition ${beat ? "bg-accent shadow-[0_0_10px_#22d3ee]" : "bg-zinc-700"}`} aria-hidden />
          <span className="font-mono text-[10px] text-zinc-400">{bpm ? `${bpm} BPM` : "listening…"}</span>
          {!vj.strobe && <span className="rounded bg-zinc-800 px-1 text-[10px] text-zinc-400">strobe off</span>}
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            Theme
            <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.theme} aria-label="VJ テーマ" onChange={(e) => useDJ.getState().applyTheme(e.target.value as "free")} title={VJ_THEMES.find((t) => t.id === vj.theme)?.desc}>
              {VJ_THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">
            演出
            <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.show} aria-label="VJ の演出スタイル" onChange={(e) => useDJ.getState().applyShow(e.target.value as "club")} title={VJ_SHOWS.find((t) => t.id === vj.show)?.desc}>
              {VJ_SHOWS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-1.5">
          <button className="btn" onClick={() => stageRef.current?.requestFullscreen?.()} title="このプレビューを全画面に">
            ⛶ 全画面
          </button>
          <button
            className="btn btn-primary max-md:hidden"
            onClick={() => {
              window.open("/vj", "vj-projector", "popup,width=1280,height=720");
              useDJ.getState().setToast("プロジェクター窓を開きました: 外部ディスプレイへ移して F キーで全画面。このタブを閉じると映像が止まります", "info");
            }}
            title="プロジェクター用の別ウィンドウを開く (音声解析はこのタブから同期)"
          >
            ⤢ プロジェクター
          </button>
        </div>
      </div>

      <div ref={stageRef} className="aspect-video lg:sticky lg:top-0 lg:z-10 overflow-hidden rounded-md bg-black ring-4 ring-panel">
        <VJCanvas source="local" />
      </div>

      {/* Looks: saved theme x show x preset combinations, recalled on the next bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2">
        <span className="label" title="Look = Theme × 演出 × 絵 (固定 or 自動) × 色の組み合わせ。クリックで次の小節頭に切替">
          Look
        </span>
        {looks.map((l) => (
          <span key={l.id} className="flex items-center overflow-hidden rounded-md border border-border">
            <button
              className={`px-2 py-0.5 text-xs ${activeLook === l.id ? "bg-accent/20 text-accent" : "text-zinc-200 hover:bg-white/10"}`}
              aria-pressed={activeLook === l.id}
              onClick={() => useDJ.getState().applyLook(l.id)}
              title={`${VJ_THEMES.find((t) => t.id === l.theme)?.label ?? l.theme} × ${VJ_SHOWS.find((s) => s.id === l.show)?.label ?? l.show}${l.preset ? ` × ${l.preset}` : " × 自動切替"}`}
            >
              {l.name}
            </button>
            {!l.builtin && (
              <button className="px-1.5 text-[10px] text-zinc-500 hover:text-rose-300" onClick={() => void useDJ.getState().deleteLook(l.id)} aria-label={`Look ${l.name} を削除`} title="削除">
                ✕
              </button>
            )}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <input
            className="w-28 rounded border border-border bg-panel px-2 py-0.5 text-xs"
            placeholder="名前"
            value={lookName}
            aria-label="保存する Look の名前"
            onChange={(e) => setLookName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void useDJ.getState().saveLook(lookName);
                setLookName("");
              }
            }}
          />
          <button
            className="btn py-0.5"
            onClick={() => {
              void useDJ.getState().saveLook(lookName);
              setLookName("");
            }}
            title="今の Theme × 演出 × 絵 × 色を Look として保存"
          >
            + 今の状態を保存
          </button>
        </span>
      </div>

      {/* One button: everything automatic */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`btn py-2 text-sm font-bold ${autoState === "on" ? "btn-accent" : autoState === "partial" ? "border-amber-400/60 text-amber-200" : "btn-primary"}`}
          aria-pressed={autoState === "on" ? true : autoState === "partial" ? "mixed" : false}
          onClick={() => useDJ.getState().setAutoVJ(autoState !== "on")}
          title="全部おまかせ: Theme の絵を、選んだ演出スタイルの動き (カメラ・カット・派手さ・切替の間隔) で音に合わせて自動で見せます"
        >
          ⚡ AUTO 演出 {autoState === "on" ? "ON" : autoState === "partial" ? `一部 ON (${autoOn}/${autoParts.length})` : "OFF"}
        </button>
        <span className="text-[11px] text-zinc-400">
          {autoState === "on" ? "音に合わせて絵・色・カメラ・カットを自動で演出中。プリセットを押すとその絵に固定" : autoState === "partial" ? "一部の自動演出だけ ON (内訳は「細かい設定」)。クリックで全部 ON" : "OFF: 選んだプリセットをそのまま表示"}
        </span>
        {vj.presetLock && auto && (
          <button className="btn py-0.5 text-amber-300" onClick={() => setVJ({ presetLock: false })} title="固定を解除して自動切替に戻す">
            固定中 → 自動切替に戻す
          </button>
        )}
      </div>

      {GROUPS.map((g) => (
        <div key={g.title} className="flex flex-wrap items-center gap-1">
          <span className="label mr-1 w-14 shrink-0">{g.title}</span>
          {presets
            .filter((p) => g.match(p.id))
            .map((p) => (
              <button
                key={p.id}
                className={`btn no-led ${(live ?? vj.preset) === p.id && !vj.autoCycle ? "btn-accent" : ""} ${vj.layer2?.preset === p.id ? "ring-1 ring-fuchsia-400/70" : ""}`}
                aria-pressed={(live ?? vj.preset) === p.id && !vj.autoCycle}
                onClick={(e) => {
                  if (e.shiftKey) return setVJ({ layer2: { ...vj.layer2, preset: vj.layer2?.preset === p.id ? null : p.id } });
                  setVJ({ preset: p.id, autoCycle: false, presetLock: true });
                }}
                title={`${auto ? "このプリセットに固定 (色・カメラ演出は動き続けます)。" : ""}Shift + クリックでレイヤー 2 に重ねる`}
              >
                {p.name.replace(/^DD /, "")}
                {vj.layer2?.preset === p.id && <span className="ml-1 text-[9px] text-fuchsia-300">L2</span>}
              </button>
            ))}
          {g.title === "DevDay 2026" && (
            <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.ddTheme} aria-label="DevDay プリセットの配色" onChange={(e) => setVJ({ ddTheme: e.target.value as "devday" })} title="DevDay プリセットの配色">
              <option value="devday">公式配色</option>
              <option value="neon">neon</option>
              <option value="sunset">sunset</option>
            </select>
          )}
        </div>
      ))}

      {/* Combination: colour source + second layer */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label w-14 shrink-0" title="絵の色をどこから決めるか">色</span>
          <div className="flex rounded-md border border-border" role="radiogroup" aria-label="色の決め方">
            {(
              [
                ["follow", "曲のキー", "再生中の曲のキーから色相 (Camelot で隣のキーは隣の色)"],
                ["fixed", "固定", "下の「色」スライダーの色のまま"],
                ["palette", "パレット", "決めた配色を 8 小節ごとに順番に"],
              ] as const
            ).map(([m, label, hint]) => (
              <button key={m} role="radio" aria-checked={vj.colorMode === m} title={hint} className={`px-2 py-1 text-xs ${vj.colorMode === m ? "bg-accent/20 text-accent" : "text-zinc-400"}`} onClick={() => setVJ({ colorMode: m, follow: true })}>
                {label}
              </button>
            ))}
          </div>
          {vj.colorMode === "palette" && (
            <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.palette} aria-label="パレット" onChange={(e) => setVJ({ palette: e.target.value })}>
              {VJ_PALETTES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
          {vj.colorMode === "fixed" && (
            <label className="flex items-center gap-1 text-xs text-zinc-400">
              <input type="range" min={0} max={360} value={vj.hue} aria-label="色相" className="w-24" onChange={(e) => setVJ({ hue: parseInt(e.target.value) })} />
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: `hsl(${vj.hue} 90% 60%)` }} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="label w-14 shrink-0" title="2 つ目の絵を重ねる (プリセットを Shift + クリックでも)">レイヤー 2</span>
          <select className="max-w-40 rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.layer2?.preset ?? ""} aria-label="レイヤー 2 のプリセット" onChange={(e) => setVJ({ layer2: { ...vj.layer2, preset: (e.target.value || null) as typeof vj.layer2.preset } })}>
            <option value="">なし</option>
            {GROUPS.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {presets
                  .filter((p) => g.match(p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name.replace(/^DD /, "")}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.layer2?.blend ?? "screen"} aria-label="レイヤー 2 の合成" disabled={!vj.layer2?.preset} onChange={(e) => setVJ({ layer2: { ...vj.layer2, blend: e.target.value as typeof vj.layer2.blend } })} title={VJ_BLENDS.find((b) => b.id === vj.layer2?.blend)?.desc}>
            {VJ_BLENDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-zinc-400" title="レイヤー 2 の不透明度">
            量
            <input type="range" min={0} max={1} step={0.01} value={vj.layer2?.opacity ?? 0.6} aria-label="レイヤー 2 の不透明度" className="w-20" disabled={!vj.layer2?.preset} onChange={(e) => setVJ({ layer2: { ...vj.layer2, opacity: parseFloat(e.target.value) } })} />
          </label>
          <button className={`btn py-1 ${vj.layer2?.mirror ? "btn-accent" : ""}`} aria-pressed={!!vj.layer2?.mirror} disabled={!vj.layer2?.preset} onClick={() => setVJ({ layer2: { ...vj.layer2, mirror: !vj.layer2?.mirror } })} title="レイヤー 2 を左右対称に">
            鏡
          </button>
          <button className="btn py-1" onClick={() => { const pool = presets.filter((p) => p.id !== (live ?? vj.preset)); const pick = pool[Math.floor(Math.random() * pool.length)]; const blends = ["screen", "lighter", "overlay", "difference"] as const; setVJ({ layer2: { preset: pick.id, blend: blends[Math.floor(Math.random() * blends.length)], opacity: 0.45 + Math.random() * 0.4, mirror: Math.random() < 0.3 } }); }} title="レイヤー 2 と合成をランダムに決める">
            🎲 おまかせ
          </button>
          {vj.layer2?.preset && (
            <button className="btn py-1" onClick={() => setVJ({ layer2: { ...vj.layer2, preset: null } })} aria-label="レイヤー 2 を外す">
              ✕
            </button>
          )}
        </div>
      </div>

      <MediaRow />
      <div className="flex flex-wrap items-center gap-1">
        <span className="label mr-1 w-14 shrink-0" title="ボタンを押した瞬間だけ出る演出">一発演出</span>
        {QUICK_FX.map((q) => (
          <button key={q.label} className="btn" onClick={() => fire(q.fx, q.text)} title={q.key ? `キー: ${q.key}` : undefined}>
            {q.label}
          </button>
        ))}
      </div>

      <button className="label self-start rounded px-1 hover:bg-white/10" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
        {advanced ? "▾" : "▸"} 細かい設定 (自動演出の中身 / 色 / 強さ)
      </button>
      {advanced && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-black/20 p-2">
          {vj.show === "custom" ? (
            <CustomShowEditor value={showParams("custom", 0.5, vj.showCustom)} onChange={(p) => setVJ({ showCustom: p })} />
          ) : (
            <div className="text-[11px] text-zinc-500">
              演出を「カスタム」にすると、ここでカメラ・揺れ・グリッチ・粒子・カットの種類・切替間隔を自分で決められます。
              <button className="btn ml-1 py-0.5" onClick={() => { useDJ.getState().applyShow("custom"); setVJ({ showCustom: { ...showParams(vj.show, 0.5, vj.showCustom) } }); }} title="今の演出の値をコピーしてカスタムにする">
                今の演出をベースにカスタム
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <Toggle on={vj.follow} onClick={() => setVJ({ follow: !vj.follow })} label="♪ 音に合わせて色・明るさ" hint="色は曲のキー、明るさは音量に連動。ブレイク / ドロップも検出" />
            <Toggle on={vj.follow && !vj.presetLock} onClick={() => setVJ({ presetLock: !vj.presetLock, follow: true, autoCycle: false })} label="絵を自動で切替" hint="Theme の範囲で 8 小節ごと / ブレイク / ドロップにプリセットを切り替え" />
            <Toggle on={vj.director} onClick={() => setVJ({ director: !vj.director })} label="🎬 カメラ・カット演出" hint="キックでズーム、強い音で揺れ、絵の切替時にカット (ズーム / ワイプ / スライド / ディゾルブ / フラッシュ)、RGB ずれ、グリッチ、ライトリーク、フィルムグレイン、ブレイクで黒帯" />
            <Toggle on={vj.autoDrop} onClick={() => setVJ({ autoDrop: !vj.autoDrop })} label="ドロップで爆発" hint="ブレイク明けのドロップを検出して DROP! 演出" />
            <Toggle on={vj.autoHype} onClick={() => setVJ({ autoHype: !vj.autoHype })} label="定期的に紙吹雪など" hint="一定の拍ごとに紙吹雪・レーザー・花火を自動で発射" />
            {vj.autoHype && (
              <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={vj.hypeLevel} aria-label="定期演出の頻度" onChange={(e) => setVJ({ hypeLevel: e.target.value as "mid" })}>
                <option value="low">控えめ (32 拍ごと)</option>
                <option value="mid">ふつう (16 拍ごと)</option>
                <option value="high">派手 (8 拍ごと)</option>
              </select>
            )}
            <Toggle on={vj.autoCycle} onClick={() => setVJ({ autoCycle: !vj.autoCycle, presetLock: false })} label="時間で切替" hint="音に関係なく 8〜16 秒ごとにプリセットをランダム切替" />
            <Toggle on={vj.mirror} onClick={() => setVJ({ mirror: !vj.mirror })} label="左右対称" hint="画面を左右ミラーに" />
            <Toggle on={vj.strobe} onClick={() => setVJ({ strobe: !vj.strobe })} label="ストロボ許可" hint="OFF でフラッシュ / ストロボを弱めます (光過敏対策)" />
          </div>
          <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2">
            <Slider label="色 (Hue)" min={0} max={360} step={1} value={vj.hue} onChange={(hue) => setVJ({ hue })} />
            <Slider label="強さ" min={0.2} max={2.5} step={0.05} value={vj.intensity} onChange={(intensity) => setVJ({ intensity })} />
            <Slider label="ビート感度" min={0.5} max={2} step={0.05} value={vj.sensitivity} onChange={(sensitivity) => setVJ({ sensitivity })} />
            <Slider label="残像" min={0} max={1} step={0.01} value={vj.trails} onChange={(trails) => setVJ({ trails })} />
          </div>
        </div>
      )}

      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (msg.trim()) fire("text", msg.trim());
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 text-xs"
          placeholder="画面にメッセージを一度だけ表示 (例: HAPPY BIRTHDAY!)"
          aria-label="画面に表示するメッセージ"
          value={msg}
          maxLength={40}
          onChange={(e) => setMsg(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">
          Send
        </button>
      </form>

      <button className="label self-start rounded px-1 hover:bg-white/10" onClick={() => setMore((v) => !v)} aria-expanded={more}>
        {more ? "▾" : "▸"} 常時表示 (イベント名 / ロゴ)
      </button>
      {more && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-black/20 p-2">
          <label className="flex items-center gap-2 text-xs" title="曲が始まるたびに左下に「NOW PLAYING 曲名」を 7 秒表示">
            <input type="checkbox" checked={vj.nowPlaying} onChange={(e) => setVJ({ nowPlaying: e.target.checked })} />
            曲が変わったら Now Playing (曲名) を表示
          </label>
          <label className="flex items-center gap-2 text-xs">
            <span className="label w-14 shrink-0">Caption</span>
            <input
              className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-1 text-xs"
              placeholder="例: DJ NIGHT 2026 · #djvj"
              value={vj.overlayText}
              maxLength={60}
              onChange={(e) => setVJ({ overlayText: e.target.value })}
            />
          </label>
          <div className="flex items-center gap-2 text-xs">
            <span className="label w-14 shrink-0">Logo</span>
            <button className="btn" onClick={() => logoRef.current?.click()}>
              画像を選ぶ (PNG / SVG)
            </button>
            {vj.logoVersion > 0 && (
              <button className="btn" onClick={() => void useDJ.getState().setLogo(null)}>
                削除
              </button>
            )}
            <input
              ref={logoRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void useDJ.getState().setLogo(f);
                e.target.value = "";
              }}
            />
            <span className="text-[10px] text-zinc-500">右上に表示 · プロジェクターにも反映</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick, label, hint }: { on: boolean; onClick: () => void; label: string; hint: string }) {
  return (
    <button className={`btn ${on ? "btn-accent" : ""}`} aria-pressed={on} onClick={onClick} title={hint}>
      {label}
    </button>
  );
}

function Slider({ label, value, onChange, ...rest }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="label w-16 shrink-0">{label}</span>
      <input type="range" className="min-w-0 flex-1" value={value} aria-label={label} onChange={(e) => onChange(parseFloat(e.target.value))} {...rest} />
    </label>
  );
}


const CUSTOM_SLIDERS: { key: keyof VJShowParams; label: string; max: number }[] = [
  { key: "punch", label: "カメラ (キックでズーム)", max: 2 },
  { key: "shake", label: "揺れ", max: 2 },
  { key: "aberr", label: "RGB ずれ", max: 2 },
  { key: "glitch", label: "グリッチ", max: 2 },
  { key: "flash", label: "フラッシュ", max: 2 },
  { key: "grain", label: "グレイン", max: 2 },
  { key: "leak", label: "ライトリーク", max: 2 },
  { key: "vignette", label: "ビネット", max: 1.5 },
  { key: "cutDur", label: "カットの長さ", max: 2.5 },
];
const CUT_KINDS = ["zoom", "wipe", "slide", "dissolve", "flash", "spin"] as const;

function CustomShowEditor({ value, onChange }: { value: VJShowParams; onChange: (p: VJShowParams) => void }) {
  const set = (patch: Partial<VJShowParams>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">カスタム演出</span>
      <div className="grid gap-x-3 gap-y-1 sm:grid-cols-2">
        {CUSTOM_SLIDERS.map((s) => (
          <label key={s.key} className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span className="w-32 shrink-0">{s.label}</span>
            <input type="range" min={0} max={s.max} step={0.05} value={value[s.key] as number} aria-label={s.label} className="min-w-0 flex-1" onChange={(e) => set({ [s.key]: parseFloat(e.target.value) } as Partial<VJShowParams>)} />
            <span className="w-8 font-mono">{(value[s.key] as number).toFixed(2)}</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
        <span className="w-32 shrink-0">絵の切替</span>
        <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={value.phraseBars} aria-label="絵の切替間隔" onChange={(e) => set({ phraseBars: parseInt(e.target.value) })}>
          {[2, 4, 8, 16, 32].map((n) => (
            <option key={n} value={n}>
              {n} 小節ごと
            </option>
          ))}
        </select>
        <span className="ml-2">カットの種類</span>
        {CUT_KINDS.map((k) => {
          const on = value.cuts.includes(k);
          return (
            <button key={k} className={`btn py-0.5 ${on ? "btn-accent" : ""}`} aria-pressed={on} onClick={() => set({ cuts: on ? value.cuts.filter((c) => c !== k) : [...value.cuts, k] })}>
              {k}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
        <button className={`btn py-0.5 ${value.letterbox ? "btn-accent" : ""}`} aria-pressed={value.letterbox} onClick={() => set({ letterbox: !value.letterbox })} title="ブレイクで黒帯 (レターボックス)">
          黒帯
        </button>
        <button className={`btn py-0.5 ${value.dropFx ? "btn-accent" : ""}`} aria-pressed={value.dropFx} onClick={() => set({ dropFx: !value.dropFx })} title="ドロップでレーザー + 紙吹雪">
          ドロップで派手に
        </button>
        <button className={`btn py-0.5 ${value.strobe ? "btn-accent" : ""}`} aria-pressed={value.strobe} onClick={() => set({ strobe: !value.strobe })} title="ストロボ系プリセットを許可 (光過敏に注意)">
          ストロボ可
        </button>
        <label className="flex items-center gap-1">
          残像
          <input type="range" min={0} max={0.9} step={0.01} value={value.trails} aria-label="残像" className="w-20" onChange={(e) => set({ trails: parseFloat(e.target.value) })} />
        </label>
      </div>
    </div>
  );
}

function MediaRow() {
  const vj = useDJ((s) => s.vj);
  const setVJ = useDJ((s) => s.setVJ);
  const ref = useRef<HTMLInputElement>(null);
  const m = vj.media;
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2 text-xs">
      <span className="label w-14 shrink-0" title="画像 / 動画を 3 つ目のレイヤーとして重ねる (ロゴ動画・会場素材など)。ブラウザ内に保存">レイヤー 3</span>
      <button className="btn py-1" onClick={() => ref.current?.click()}>
        {m.kind ? (m.kind === "video" ? "🎞 動画" : "🖼 画像") + " を変更" : "画像 / 動画を選ぶ"}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void useDJ.getState().setMedia(f);
          e.target.value = "";
        }}
      />
      {m.kind && (
        <>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1" value={m.blend} aria-label="レイヤー 3 の合成" onChange={(e) => setVJ({ media: { ...m, blend: e.target.value as typeof m.blend } })}>
            {VJ_BLENDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-zinc-400">
            量
            <input type="range" min={0} max={1} step={0.01} value={m.opacity} aria-label="レイヤー 3 の不透明度" className="w-20" onChange={(e) => setVJ({ media: { ...m, opacity: parseFloat(e.target.value) } })} />
          </label>
          <button className={`btn py-1 ${m.fit === "contain" ? "btn-accent" : ""}`} aria-pressed={m.fit === "contain"} onClick={() => setVJ({ media: { ...m, fit: m.fit === "cover" ? "contain" : "cover" } })} title="全体を見せる (contain) / 画面いっぱい (cover)">
            {m.fit === "cover" ? "全面" : "全体表示"}
          </button>
          <button className={`btn py-1 ${m.pulse ? "btn-accent" : ""}`} aria-pressed={m.pulse} onClick={() => setVJ({ media: { ...m, pulse: !m.pulse } })} title="キック / 拍に合わせて明るさを脈動">
            拍で脈動
          </button>
          <button className="btn py-1" onClick={() => void useDJ.getState().setMedia(null)} aria-label="レイヤー 3 を外す">
            ✕
          </button>
        </>
      )}
    </div>
  );
}
