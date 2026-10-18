"use client";

import { useEffect, useState } from "react";
import { curveTarget, useDJ } from "@/lib/store";
import HoldButton from "./HoldButton";
import PhraseMeter from "./PhraseMeter";
import HelpButton from "./HelpButton";
import VUMeter from "./VUMeter";

const fmtClock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
};

/** Small titled group so transition / automation / FX controls read as three distinct clusters. */
function Group({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-lg border border-border/60 bg-black/20 p-2 ${className}`}>
      <span className="label">{title}</span>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

export default function Mixer() {
  const crossfader = useDJ((s) => s.crossfader);
  const masterVolume = useDJ((s) => s.masterVolume);
  const samplerVolume = useDJ((s) => s.samplerVolume);
  const recording = useDJ((s) => s.recording);
  const recordingSince = useDJ((s) => s.recordingSince);
  const autoDJ = useDJ((s) => s.autoDJ);
  const mixBeats = useDJ((s) => s.mixBeats);
  const autoFollow = useDJ((s) => s.autoFollow);
  const autoStyle = useDJ((s) => s.autoStyle);
  const autoFx = useDJ((s) => s.autoFx);
  const fxDepth = useDJ((s) => s.fxDepth);
  const djScope = useDJ((s) => s.djScope);
  const djOrder = useDJ((s) => s.djOrder);
  const djMatch = useDJ((s) => s.djMatch);
  const djSegment = useDJ((s) => s.djSegment);
  const djEntry = useDJ((s) => s.djEntry);
  const poolCount = useDJ((s) => s.djPool.length);
  const chorusMode = djSegment === "chorus";
  const djEnergy = useDJ((s) => s.djEnergy);
  const softStart = useDJ((s) => s.softStart);
  const harmonicShift = useDJ((s) => s.harmonicShift);
  const cue = useDJ((s) => s.cue);
  const [cueOpen, setCueOpen] = useState(false);
  const mic = useDJ((s) => s.mic);
  const plan = useDJ((s) => s.plan);
  const gateDivision = useDJ((s) => s.gateDivision);
  const planMinutes = useDJ((s) => s.planMinutes);
  const planSongs = useDJ((s) => s.planSongs);
  const planCurve = useDJ((s) => s.planCurve);
  const queueLen = useDJ((s) => s.djQueue.length);
  const tracksAll = useDJ((s) => s.tracks);
  const djPoolIds = useDJ((s) => s.djPool);
  const djScopeNow = useDJ((s) => s.djScope);
  const [planNow, setPlanNow] = useState(0);
  useEffect(() => {
    if (!plan) return;
    const t = setInterval(() => setPlanNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [plan]);
  // planNow is 0 until the first tick (Date.now() must not run during render); show 0:00 until then.
  const { setCrossfader, setMasterVolume, setSamplerVolume, toggleRecording } = useDJ.getState();
  const [now, setNow] = useState(0);
  const [autoMore, setAutoMore] = useState(false);
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const filterFx = useDJ((s) => s.filterFx);
  const mixing = useDJ((s) => s.mixing);
  const fx = useDJ((s) => s.fx);
  const beatRepeat = useDJ((s) => s.beatRepeat);

  return (
    <div className="panel flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="label">Mixer</span>
        <HelpButton section="mixer" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <VUMeter />
          <PhraseMeter />
        </div>
        <button className={`btn ${recording ? "btn-danger" : ""}`} onClick={toggleRecording} title="マスター出力を録音してダウンロード" aria-pressed={recording}>
          {recording ? `● REC ${fmtClock(Math.max(0, now - recordingSince))}` : "○ REC"}
        </button>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <span className="w-4 text-center text-xs font-bold text-accent">A</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={crossfader}
            className="flex-1"
            aria-label="クロスフェーダー"
            onChange={(e) => setCrossfader(parseFloat(e.target.value))}
            onDoubleClick={() => setCrossfader(0.5)}
          />
          <span className="w-4 text-center text-xs font-bold text-accent-2">B</span>
        </div>
        <button type="button" className="label mx-auto block rounded px-1 hover:bg-white/10" onClick={() => setCrossfader(0.5)} title="中央に戻す">
          Crossfader
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Group title="Transition · 今すぐ繋ぐ" className="sm:col-span-2">
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={mixBeats} aria-label="ミックスの長さ" onChange={(e) => useDJ.getState().setMixBeats(parseInt(e.target.value))} title="ミックス / フェードアウトの長さ">
            {[8, 16, 32, 64, 128].map((b) => (
              <option key={b} value={b}>
                {b} 拍 ({b / 4} 小節)
              </option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => useDJ.getState().autoMix()} title="BPM を合わせ、低音を入れ替えながらクロスフェード (M)">
            Blend
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "filter" })} title="旧曲をこもらせ、新曲をハイパスから開いて入れ替え">
            Filter
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "drop" })} title="旧曲をビルドアップして、新曲をドロップで切り替え">
            Drop Swap
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "spin" })} title="旧曲をスピンバックして新曲に切り替え">
            Spinback
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "echo" })} title="旧曲をエコーに投げ、次の小節の頭で新曲に切り替え (余韻が残る)">
            Echo Out
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "reverb" })} title="旧曲をリバーブに溶かし、次の小節の頭で新曲に切り替え">
            Reverb Out
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "roll" })} title="旧曲をループロール (1 → 1/2 → 1/4 → 1/8 拍) して小節の頭で新曲に切り替え">
            Loop Roll
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "cut" })} title="次の小節の頭で一気に新曲へカット (クラッシュ付き)">
            Cut
          </button>
          <button className="btn" onClick={() => useDJ.getState().fadeOut()} title="再生中の曲をフィルターをかけながらフェードアウトして停止">
            Fade Out
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "ramp" })} title="テンポが離れた曲へ: 再生中の曲のテンポを 8 小節かけて次の曲に寄せ (キーロックで音程は保つ)、そのままビートマッチしてブレンド">
            Tempo Ramp
          </button>
          <button className="btn" onClick={() => useDJ.getState().fadeIn()} title="止まっているデッキの曲を、フィルターを開きながらフェードインで始める (セットの始まりに)。再生中の曲があればフェードで繋ぐ">
            Fade In
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "doubledrop" })} title="EDM: 次の曲のドロップ (サビ) を次の小節頭に落とし、8 小節は両方のドロップを重ねてから出る曲を抜く">
            Double Drop
          </button>
          <button className="btn" onClick={() => useDJ.getState().autoMix({ style: "breakcut" })} title="EDM: ブレイク (静かな所) から次の曲のドロップへ 1 小節でカット。ライザー付き">
            Break → Drop
          </button>
          {mixing && (
            <button className="btn btn-danger animate-pulse" onClick={() => useDJ.getState().cancelMix()} title="実行中のミックス / フェードアウトを中止して元の状態に戻す">
              ■ 中止
            </button>
          )}
        </Group>
        <Group title="MIC · ラップ / MC" className="sm:col-span-2">
          <button className={`btn ${mic.on ? "btn-danger" : "btn-primary"}`} aria-pressed={mic.on} disabled={mic.busy} onClick={() => void useDJ.getState().setMicOn(!mic.on)} title="マイクを ON/OFF (初回はブラウザの許可)。ON の間、話すと音楽が自動で下がります">
            {mic.busy ? "…" : mic.on ? "● MIC ON" : "🎤 MIC"}
          </button>
          <label className="flex items-center gap-1 text-xs text-zinc-400" title="マイクの音量">
            Gain
            <input type="range" min={0} max={2} step={0.01} value={mic.gain} aria-label="マイクの音量" className="w-20" onChange={(e) => useDJ.getState().setMic({ gain: parseFloat(e.target.value) })} />
          </label>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={mic.voice} aria-label="ボイスエフェクト" onChange={(e) => useDJ.getState().setMic({ voice: e.target.value as "clean" })} title="声の加工">
            <option value="clean">声: そのまま</option>
            <option value="megaphone">声: メガホン</option>
            <option value="radio">声: ラジオ</option>
            <option value="robot">声: ロボット</option>
            <option value="deep">声: 低く (−5)</option>
            <option value="chipmunk">声: 高く (+6)</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-zinc-400" title="声のピッチ (半音)。キーロックと同じシフターなので速さは変わりません">
            Pitch
            <input type="range" min={-12} max={12} step={1} value={mic.semitones} aria-label="声のピッチ (半音)" className="w-20" onChange={(e) => useDJ.getState().setMic({ semitones: parseInt(e.target.value) })} />
            <span className="w-6 font-mono">{mic.semitones > 0 ? `+${mic.semitones}` : mic.semitones}</span>
          </label>
          <HoldButton on={mic.echo} onChange={(on) => useDJ.getState().setMic({ echo: on })} label="Echo" title="声にテンポ同期のエコー (押している間 / タップで固定)。ラップの語尾を飛ばす定番" />
          <HoldButton on={mic.reverb} onChange={(on) => useDJ.getState().setMic({ reverb: on })} label="Reverb" title="声にリバーブ (押している間 / タップで固定)" />
          <button className={`btn ${mic.duck ? "btn-accent" : ""}`} aria-pressed={mic.duck} onClick={() => useDJ.getState().setMic({ duck: !mic.duck })} title="トークオーバー: 話している間だけ音楽を −8 dB 下げる (DJ ミキサーの TALKOVER)">
            Duck
          </button>
        </Group>
        <Group title="Hype · 盛り上げ">
          <button className="btn btn-primary" onClick={() => useDJ.getState().buildDrop(8)} title="マスターをハイパスで絞りながら 8 小節ビルドアップ → 小節の頭でドロップ (ライザー / スネアロール / インパクト / VJ 連動)。キー: Y">
            Build & Drop
          </button>
          <button className="btn" onClick={() => useDJ.getState().buildDrop(4)} title="短い 4 小節版">
            4 小節
          </button>
          <button className="btn" onClick={() => useDJ.getState().crowd()} title="エアホーン + 歓声 + ホイッスル + MAKE SOME NOISE! (キー: U)">
            Crowd!
          </button>
          <button className="btn" onClick={() => useDJ.getState().echoThrow()} title="エコースロー: 今鳴っている一発 (ボーカルの語尾・スネア) を 1 拍だけエコーに投げて余韻を残す">
            Echo Throw
          </button>
          <button className="btn" onClick={() => useDJ.getState().filterRise(4)} title="フィルターライズ: 次の小節頭から 4 小節、ハイパスで音を細くして小節頭で一気に開く (ドロップ用サンプルなしのビルド)">
            Filter Rise
          </button>
          <HoldButton on={gateDivision === 0.5} onChange={(on) => useDJ.getState().gateHold(on ? 0.5 : null)} label="Gate ⅛" title="ゲーター: 全体を 1/8 拍で ON/OFF (押している間 / タップで固定)" />
          <HoldButton on={gateDivision === 0.25} onChange={(on) => useDJ.getState().gateHold(on ? 0.25 : null)} label="Gate 1/16" title="ゲーター: 全体を 1/16 拍で ON/OFF (押している間 / タップで固定)" />
          <span className="label ml-1">Repeat</span>
          {([
            [1, "1"],
            [0.5, "1/2"],
            [0.25, "1/4"],
            [0.125, "1/8"],
          ] as const).map(([b, label]) => (
            <HoldButton
              key={b}
              on={beatRepeat === b}
              onChange={(on) => useDJ.getState().setBeatRepeat(on ? b : null)}
              label={label}
              ariaLabel={`ビートリピート ${label} 拍`}
              title={`ビートリピート ${label} 拍: マスター全体を ${label} 拍で刻む (次の拍の頭から)`}
            />
          ))}
        </Group>
        <Group title="FX · 押している間">
          <HoldButton on={filterFx === "hpf"} onChange={(on) => useDJ.getState().setFilterFx(on ? "hpf" : null)} label="HPF ↑" title="ハイパス (低音カット) スイープ (H)" />
          <HoldButton on={filterFx === "lpf"} onChange={(on) => useDJ.getState().setFilterFx(on ? "lpf" : null)} label="LPF ↓" title="ローパス (こもらせる) スイープ (L)" />
          <button className="btn" onClick={() => useDJ.getState().doBreak(4)} title="4 拍だけ止めてビルドアップ → DROP (B)">
            Break
          </button>
        </Group>
      </div>

      <Group title="Effects · マスターエフェクト">
        <HoldButton on={fx.echo} onChange={(on) => useDJ.getState().setFx("echo", on)} label="Echo" title="Echo (G)" />
        <HoldButton on={fx.reverb} onChange={(on) => useDJ.getState().setFx("reverb", on)} label="Reverb" title="Reverb (J)" />
        <HoldButton on={fx.flanger} onChange={(on) => useDJ.getState().setFx("flanger", on)} label="Flanger" title="Flanger (K)" />
        <label className="flex min-w-24 flex-1 items-center gap-1 text-xs text-zinc-400">
          Depth
          <input type="range" min={0.1} max={1} step={0.01} value={fxDepth} className="min-w-0 flex-1" aria-label="エフェクトの深さ" onChange={(e) => useDJ.getState().setFxDepth(parseFloat(e.target.value))} />
        </label>
      </Group>

      <Group title="Auto · 自動ミックス">
        <button className={`btn ${autoFollow ? "btn-accent" : ""}`} aria-pressed={autoFollow} onClick={() => useDJ.getState().setAutoFollow(!autoFollow)} title="止まっているデッキに次の曲をセットすると、再生中の曲の OUT 位置 (未設定なら曲の終わり) で自動ミックス。デッキの表示にカウントダウンが出ます">
          Auto Follow
        </button>
        <button className={`btn ${autoDJ ? "btn-accent" : ""}`} aria-pressed={autoDJ} onClick={() => useDJ.getState().setAutoDJ(!autoDJ)} title="ON にすると、両デッキに曲をセットして再生を始め、以降は自動で曲を選んでミックスし続けます">
          Auto DJ
        </button>
        {/* Set plan: time + songs */}
        <div className="flex basis-full flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2 text-xs text-zinc-400">
          <span className="label" title="時間と曲数を決めて Auto DJ。1 曲あたりの長さを自動で配分し、長いファイルは中のサビを別の曲として数えます">セットプラン</span>
          {plan ? (
            (() => {
              const elapsed = planNow ? Math.max(0, planNow - plan.startedAt) / 1000 : 0;
              const total = plan.minutes * 60;
              const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
              const seg = Math.max(30, Math.max(0, total - elapsed) / Math.max(1, plan.songs - plan.played));
              return (
                <>
                  <span className="font-mono text-zinc-200">
                    {fmt(Math.min(elapsed, total))} / {fmt(total)}
                  </span>
                  <div className="h-1.5 w-28 overflow-hidden rounded bg-zinc-800">
                    <div className="h-full bg-accent" style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }} />
                  </div>
                  <span>
                    {plan.played}/{plan.songs} 曲 · 次の 1 曲 ≈ {fmt(seg)}
                    {plan.curve !== "flat" && <span className="ml-1 text-zinc-500">· 山 {Math.round(curveTarget(plan.curve, Math.min(1, elapsed / total)) * 100)}%</span>}
                  </span>
                  <button className="btn py-0.5" onClick={() => useDJ.getState().stopPlan()} title="プランをやめて通常の Auto DJ に戻す (再生は続く)">
                    プラン終了
                  </button>
                </>
              );
            })()
          ) : (
            <>
              <label className="flex items-center gap-1">
                <input type="number" min={1} max={600} className="w-14 rounded border border-border bg-panel px-1 py-0.5 text-xs" value={planMinutes} aria-label="セットの時間 (分)" onChange={(e) => useDJ.getState().setPlanInputs(parseInt(e.target.value) || 1, planSongs)} />
                分
              </label>
              <label className="flex items-center gap-1">
                <input type="number" min={1} max={500} className="w-14 rounded border border-border bg-panel px-1 py-0.5 text-xs" value={planSongs} aria-label="セットの曲数" onChange={(e) => useDJ.getState().setPlanInputs(planMinutes, parseInt(e.target.value) || 1)} />
                曲
              </label>
              <span className="text-zinc-500">
                → 1 曲 約 {Math.floor((planMinutes * 60) / planSongs / 60)}:{String(Math.round(((planMinutes * 60) / planSongs) % 60)).padStart(2, "0")}
                {(() => {
                  const pool = djScopeNow === "selected" ? tracksAll.filter((t) => djPoolIds.includes(t.id)) : tracksAll;
                  const units = pool.reduce((n, t) => n + (t.duration > 360 ? Math.max(1, t.choruses?.length ?? Math.round(t.duration / 240)) : 1), 0);
                  return ` · 対象 ${pool.length} ファイル = ${units} 曲分`;
                })()}
              </span>
              <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={planCurve} aria-label="エネルギーカーブ" onChange={(e) => useDJ.getState().setPlanCurve(e.target.value as "peak")} title="セットの山の作り方: 選曲の BPM・音量を時間の位置に合わせて選びます">
                <option value="peak">山: 中盤ピーク (序盤低め → 70% で頂点 → 終盤落とす)</option>
                <option value="up">山: 上げ続ける</option>
                <option value="wave">山: 波 (上げ下げ 1.5 往復)</option>
                <option value="flat">山: 気にしない</option>
              </select>
              <button className="btn btn-primary py-0.5" onClick={() => void useDJ.getState().startPlan()} title="この時間と曲数で Auto DJ を開始。時間が来たらフェードアウトして止まります">
                ▶ プランで開始
              </button>
              {queueLen > 0 && (
                <button className="btn py-0.5" onClick={() => { useDJ.getState().setDjOrder("queue"); void useDJ.getState().startPlan(); }} title="Library で決めたキューの順番で、この時間に収めて再生">
                  ▶ キュー順で開始 ({queueLen})
                </button>
              )}
            </>
          )}
        </div>
        <label className="flex items-center gap-1 text-xs text-zinc-400">
          繋ぎ方
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={autoStyle} onChange={(e) => useDJ.getState().setAutoStyle(e.target.value as "blend")} title="auto = 曲ごとにテンポ / キーの近さから最適な繋ぎを自動選択">
            <option value="auto">auto (おまかせ)</option>
            <option value="blend">blend</option>
            <option value="filter">filter</option>
            <option value="echo">echo out</option>
            <option value="reverb">reverb out</option>
            <option value="roll">loop roll</option>
            <option value="cut">cut</option>
            <option value="drop">drop</option>
            <option value="spin">spin</option>
            <option value="fade">fade (音量のみ)</option>
            <option value="ramp">tempo ramp (8 小節でテンポを寄せてから blend)</option>
            <option value="doubledrop">double drop (EDM)</option>
            <option value="breakcut">break → drop (EDM)</option>
          </select>
        </label>
        <button
          className={`btn ${chorusMode ? "btn-accent" : ""}`}
          aria-pressed={chorusMode}
          onClick={() => useDJ.getState().setChorusMode(!chorusMode)}
          title="サビだけ繋ぐ: 各曲の検出したサビ (16 小節) だけを流し、次の曲のサビ頭が前の曲のサビ終わりの小節にぴったり来るように 2 小節で繋ぎます。サビはデッキの「ここをサビに」で修正できます"
        >
          🎤 サビだけ繋ぐ
        </button>
        <span className="label ml-1" title="セット全体のテンポ。再生中のデッキ (と待機中の次の曲) の速さをまとめて変えます。Auto DJ の次の曲もこのテンポに合わせて入ります">テンポ</span>
        <button className="btn py-1" onClick={() => useDJ.getState().nudgeSetTempo(-1)} title="セット全体を 1% 遅く" aria-label="セットのテンポを 1% 下げる">
          −1%
        </button>
        <button className="btn py-1" onClick={() => useDJ.getState().nudgeSetTempo(1)} title="セット全体を 1% 速く" aria-label="セットのテンポを 1% 上げる">
          +1%
        </button>
        <button className="btn py-1" onClick={() => useDJ.getState().nudgeSetTempo("reset")} title="曲本来の速さに戻す" aria-label="セットのテンポをリセット">
          0
        </button>
        <button className={`btn ${autoFx ? "btn-accent" : ""}`} aria-pressed={autoFx} onClick={() => useDJ.getState().setAutoFx(!autoFx)} title="繋ぎの瞬間にライザー / インパクト / リバースクラッシュなどの内蔵サンプルと VJ 演出を自動で重ねる">
          Auto FX
        </button>
        {cue.supported && (
          <>
            <button
              className="label basis-full self-start rounded px-1 text-left hover:bg-white/10"
              onClick={() => {
                setCueOpen((v) => !v);
                if (!cueOpen && !cue.devices.length) void useDJ.getState().listCueDevices();
              }}
              aria-expanded={cueOpen}
            >
              {cueOpen ? "▾" : "▸"} 🎧 ヘッドホン (次の曲を会場に出さずに確認){cue.deviceId ? <span className="ml-1 text-accent">● 接続中</span> : ""}
            </button>
            <div className={`${cueOpen ? "flex" : "hidden"} basis-full flex-wrap items-center gap-2 border-t border-border/50 pt-1.5 text-xs text-zinc-400`}>
              <select className="max-w-64 rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={cue.deviceId} aria-label="ヘッドホンの出力先" onChange={(e) => void useDJ.getState().setCueDevice(e.target.value)}>
                <option value="">出力先を選ぶ (なし)</option>
                {cue.devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button className="btn py-1" onClick={() => void useDJ.getState().listCueDevices()} title="接続したデバイスを再検索 (名前を出すためにマイク許可を 1 回求めることがあります)">
                ⟳ 再検索
              </button>
              <label className="flex items-center gap-1" title="ヘッドホンの中の CUE (選んだデッキ) とマスター (会場の音) の混ぜ具合">
                CUE
                <input type="range" min={0} max={1} step={0.01} value={cue.mix} aria-label="ヘッドホンの CUE / マスター比" className="w-24" onChange={(e) => useDJ.getState().setCueMix(parseFloat(e.target.value))} />
                MASTER
              </label>
              <span className="text-zinc-500">デッキの 🎧 で聴くデッキを選択 (フェーダー前・EQ 後)。本体の音は今までどおりメイン出力に出ます</span>
            </div>
          </>
        )}
        <button className="label basis-full self-start rounded px-1 text-left hover:bg-white/10" onClick={() => setAutoMore((v) => !v)} aria-expanded={autoMore}>
          {autoMore ? "▾" : "▸"} 細かい設定 (選曲の対象・順番・相性 / 切替スパン / 入り位置) {!autoMore && <span className="normal-case text-zinc-500">— Mode ボタンでまとめて設定できます</span>}
        </button>
        <div className={`${autoMore ? "flex" : "hidden"} basis-full flex-wrap items-center gap-1.5 border-t border-border/50 pt-1.5 text-xs text-zinc-400`}>
          <span className="label">Auto DJ の選曲</span>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={djScope} aria-label="選曲の対象" onChange={(e) => useDJ.getState().setDjScope(e.target.value as "all")}>
            <option value="all">ライブラリ全曲</option>
            <option value="selected">選んだ曲のみ ({poolCount})</option>
          </select>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={djOrder} aria-label="選曲の順番" onChange={(e) => useDJ.getState().setDjOrder(e.target.value as "shuffle")}>
            <option value="shuffle">ランダム</option>
            <option value="sequential">並び順</option>
            <option value="queue">キューの順 ({queueLen} 曲)</option>
          </select>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={djMatch} aria-label="選曲の相性" disabled={djOrder === "sequential"} onChange={(e) => useDJ.getState().setDjMatch(e.target.value as "both")} title="ランダムの中で、次の曲をどの基準で選びやすくするか">
            <option value="both">相性: BPM + キー</option>
            <option value="key">相性: キー優先 (Camelot)</option>
            <option value="bpm">相性: BPM 優先</option>
            <option value="random">相性: 気にしない</option>
          </select>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={String(djSegment)} aria-label="A/B を切り替えるスパン" onChange={(e) => useDJ.getState().setDjSegment((/^\d+$/.test(e.target.value) ? Number(e.target.value) : e.target.value) as "end")} title="1 曲をどれだけ流してから A↔B を切り替えるか (長い DJ ミックスやアルバムを細かく回す時に)">
            <option value="chorus">切替: サビの終わりで</option>
            <option value="long">切替: 長尺 (5 分超) のみ 2 分で</option>
            <option value="end">切替: 曲の最後まで流す</option>
            <option value="random">切替: ランダム (1〜3 分)</option>
            <option value="30">切替: 30 秒ごと</option>
            <option value="60">切替: 1 分ごと</option>
            <option value="90">切替: 1 分半ごと</option>
            <option value="120">切替: 2 分ごと</option>
            <option value="180">切替: 3 分ごと</option>
            <option value="240">切替: 4 分ごと</option>
            <option value="300">切替: 5 分ごと</option>
          </select>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={djEnergy} aria-label="エネルギーの流れ" onChange={(e) => useDJ.getState().setDjEnergy(e.target.value as "flat")} title="セットのエネルギー設計: 上げ続ける (BPM・音量が少し上の曲を優先) / 波 (上げ下げを交互に) / 気にしない">
            <option value="flat">エネルギー: 気にしない</option>
            <option value="up">エネルギー: 上げ続ける</option>
            <option value="wave">エネルギー: 波 (上げ下げ)</option>
          </select>
          <button className={`btn py-1 ${harmonicShift ? "btn-accent" : ""}`} aria-pressed={harmonicShift} onClick={() => useDJ.getState().setHarmonicShift(!harmonicShift)} title="キーが合わない次の曲を、キーロック経由で ±1〜2 半音動かして相性の良いキーにする (ハーモニックミキシング)">
            キーを合わせる
          </button>
          <button className={`btn py-1 ${softStart ? "btn-accent" : ""}`} aria-pressed={softStart} onClick={() => useDJ.getState().setSoftStart(!softStart)} title="Auto DJ 開始や最初の再生で、いきなり鳴らさず 4 小節かけてフェードイン">
            始まりはフェードイン
          </button>
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={djEntry} aria-label="曲の入り位置" onChange={(e) => useDJ.getState().setDjEntry(e.target.value as "long")} title="次の曲をどこから流し始めるか (見せ場 = 音量が大きい小節の頭)">
            <option value="chorus">入り位置: サビ (繋ぎ分だけ手前) から</option>
            <option value="always">入り位置: 見せ場から (無音を飛ばす)</option>
            <option value="long">入り位置: 長尺のみ見せ場から</option>
            <option value="start">入り位置: 音が始まる所から</option>
          </select>
          {djScope === "selected" && poolCount === 0 && <span className="text-amber-400">Library で曲にチェックを入れてください</span>}
        </div>
      </Group>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <span className="label">Master</span>
          <input type="range" min={0} max={1} step={0.01} value={masterVolume} aria-label="マスターボリューム" onChange={(e) => setMasterVolume(parseFloat(e.target.value))} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="label">Sampler</span>
          <input type="range" min={0} max={1.5} step={0.01} value={samplerVolume} aria-label="サンプラーボリューム" onChange={(e) => setSamplerVolume(parseFloat(e.target.value))} />
        </div>
      </div>
    </div>
  );
}
