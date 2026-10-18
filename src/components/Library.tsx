"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { expectedPlaySeconds, isDefaultSample, isDefaultTrack, useDJ } from "@/lib/store";
import { camelotNumber as camelot, keysCompatible } from "@/lib/audio/key";
import { BANK_NAMES, PADS_PER_BANK, type DeckId, type TrackMeta } from "@/lib/types";
import HelpButton from "./HelpButton";

type Tab = "tracks" | "samples";
type Sort = "added" | "name" | "bpm" | "key";

const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)}MB`;

export default function Library() {
  const tracks = useDJ((s) => s.tracks);
  const samples = useDJ((s) => s.samples);
  const loading = useDJ((s) => s.loading);
  const seeding = useDJ((s) => s.seeding);
  const decks = useDJ((s) => s.decks);
  const previewing = useDJ((s) => s.previewing);
  const storage = useDJ((s) => s.storage);
  const saveMode = useDJ((s) => s.saveMode);
  const djPool = useDJ((s) => s.djPool);
  const djScope = useDJ((s) => s.djScope);
  const playlists = useDJ((s) => s.playlists);
  const nextOverride = useDJ((s) => s.nextOverride);
  const djQueue = useDJ((s) => s.djQueue);
  const djOrder = useDJ((s) => s.djOrder);
  const djSegment = useDJ((s) => s.djSegment);
  const planMinutes = useDJ((s) => s.planMinutes);
  const planSongs = useDJ((s) => s.planSongs);
  const [showQueue, setShowQueue] = useState(false);
  const fmtMin = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
  const queueSeconds = djQueue.reduce((acc, id) => {
    const t = tracks.find((x) => x.id === id);
    return t ? acc + expectedPlaySeconds(t, djSegment, djSegment === "plan" ? (planMinutes * 60) / planSongs : undefined) : acc;
  }, 0);
  const playLog = useDJ((s) => s.playLog);
  const autoDJ = useDJ((s) => s.autoDJ);
  const [showLog, setShowLog] = useState(false);
  const tempCount = tracks.filter((t) => t.temporary).length + samples.filter((x) => x.temporary).length;
  const { importTracks, importSamples, deleteTrack, deleteSample, loadToDeck, seedDefaults, confirm, previewTrack, previewSample, renameTrack } = useDJ.getState();
  const [tab, setTab] = useState<Tab>("tracks");
  const pads = useDJ((s) => s.pads);
  const [selSamples, setSelSamples] = useState<Set<string>>(new Set());
  const padLabel = (sampleId: string) => {
    const idx = pads.filter((p) => p.sampleId === sampleId).map((p) => p.index);
    return idx.map((i) => `${BANK_NAMES[Math.floor(i / PADS_PER_BANK)]}${(i % PADS_PER_BANK) + 1}`);
  };
  // Ticks while something was added recently so the "✓ 追加しました" badges fade out on their own.
  // (0 until the first tick: Date.now() must not run during render in this Next.js version.)
  const [now, setNow] = useState(0);
  const newest = Math.max(0, ...tracks.map((t) => t.createdAt));
  useEffect(() => {
    if (Date.now() - newest > 20000) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [newest]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("added");
  const [drag, setDrag] = useState(false);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  const onFiles = (files: FileList | File[]) => (tab === "tracks" ? importTracks(files) : importSamples(files));
  const filter = (name: string) => name.toLowerCase().includes(q.toLowerCase());
  const busy = Object.keys(loading).length;
  // Reference for key compatibility: the playing deck (or whichever has a track).
  const refTrack = useMemo(() => {
    const playing = (["A", "B"] as DeckId[]).find((id) => decks[id].playing && decks[id].track);
    const id = playing ?? (["A", "B"] as DeckId[]).find((id) => decks[id].track);
    const tid = id ? decks[id].track?.id : null;
    return tracks.find((t) => t.id === tid) ?? null;
  }, [decks, tracks]);

  const sorted = useMemo(() => {
    const list = tracks.filter((t) => filter(t.name));
    const cmp: Record<Sort, (a: TrackMeta, b: TrackMeta) => number> = {
      added: (a, b) => b.createdAt - a.createdAt,
      name: (a, b) => a.name.localeCompare(b.name, "ja"),
      bpm: (a, b) => (a.bpm ?? 999) - (b.bpm ?? 999),
      key: (a, b) => (a.keyRoot == null ? 99 : camelot(a.keyRoot, !!a.keyMinor)) - (b.keyRoot == null ? 99 : camelot(b.keyRoot, !!b.keyMinor)),
    };
    return list.sort(cmp[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, q, sort]);

  const load = (t: TrackMeta, id: DeckId) => {
    if (decks[id].playing) {
      confirm({
        title: `Deck ${id} は再生中です`,
        message: `「${decks[id].track?.name}」を止めて「${t.name}」に差し替えますか？`,
        confirmLabel: "差し替える",
        danger: true,
        onConfirm: () => void loadToDeck(t.id, id, true),
      });
    } else void loadToDeck(t.id, id);
  };

  return (
    <div
      className={`panel flex max-h-[calc(100dvh-9rem)] min-h-64 flex-col gap-2 p-3 md:max-h-none ${drag ? "ring-2 ring-accent" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-border" role="tablist">
          {(["tracks", "samples"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`px-3 py-1 text-xs ${tab === t ? "bg-accent/20 text-accent" : "text-zinc-400"}`} onClick={() => setTab(t)}>
              {t === "tracks" ? "曲" : "サンプル"} ({t === "tracks" ? tracks.length : samples.length})
            </button>
          ))}
        </div>
        <HelpButton section="library" />
        <input className="min-w-28 flex-1 rounded border border-border bg-panel-2 px-2 py-1 text-xs" placeholder="検索…" value={q} aria-label="ライブラリ検索" onChange={(e) => setQ(e.target.value)} />
        {tab === "tracks" && (
          <select className="rounded-md border border-border bg-panel-2 px-1.5 py-1 text-xs" value={sort} aria-label="並び順" onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="added">追加順</option>
            <option value="name">名前</option>
            <option value="bpm">BPM</option>
            <option value="key">キー (Camelot)</option>
          </select>
        )}
        <button className="btn btn-primary" onClick={() => fileRef.current?.click()} title={tab === "tracks" ? "音楽 / 動画ファイルを選んでライブラリに追加 (ドラッグ & ドロップでも可)" : "サンプル用の音声ファイルを追加"}>
          + {tab === "tracks" ? "曲を追加" : "サンプルを追加"}
        </button>
        <div className="relative">
          <button className="btn" onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-label="その他" title="デモ音源 / バックアップ / ストレージ">
            ⋯
          </button>
          {menu && (
            <div className="absolute right-0 top-full z-20 mt-1 flex w-64 flex-col gap-1 rounded-lg border border-border bg-panel p-2 text-xs shadow-xl" onMouseLeave={() => setMenu(false)}>
              <button className="btn justify-start text-left" disabled={seeding} onClick={() => void seedDefaults(true)} title="内蔵キットとデモ曲を生成して追加 (既にあるものはスキップ。削除したものも復活します)">
                {seeding ? "生成中…" : "内蔵キット / デモ曲を追加"}
              </button>
              <button className="btn justify-start text-left" onClick={() => void useDJ.getState().exportBackup()} title="曲・サンプル・パッド設定を 1 つの zip に書き出す">
                バックアップを書き出す (.zip)
              </button>
              <button className="btn justify-start text-left" onClick={() => backupRef.current?.click()} title="このアプリで書き出した zip を読み込む (既存データは残ります)">
                バックアップを読み込む
              </button>
              <input
                ref={backupRef}
                type="file"
                accept=".zip,application/zip"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void useDJ.getState().importBackup(f);
                  e.target.value = "";
                }}
              />
              <div className="mt-1 border-t border-border pt-2 text-[11px] text-zinc-400">
                {storage ? (
                  <>
                    <div className="flex justify-between">
                      <span>使用容量</span>
                      <span className="font-mono">
                        {(storage.usage / 1024 / 1024).toFixed(0)} / {(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-zinc-800">
                      <div className="h-full bg-accent" style={{ width: `${Math.min(100, (storage.usage / Math.max(1, storage.quota)) * 100)}%` }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span>{storage.persisted ? "✓ データ保護済み" : "ブラウザが容量不足時に削除する可能性あり"}</span>
                      {!storage.persisted && (
                        <button className="btn py-0.5" onClick={() => void useDJ.getState().requestPersist()}>
                          保護を要求
                        </button>
                      )}
                    </div>
                  </>
                ) : (
                  <span>容量情報を取得できません</span>
                )}
              </div>
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="audio/*,video/*" multiple className="sr-only" tabIndex={-1} aria-label="音楽ファイルを追加" onChange={(e) => {
            if (e.target.files?.length) onFiles(Array.from(e.target.files));
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
        <span className="label">追加した曲・サンプルの保存</span>
        <div className="flex rounded-md border border-border" role="radiogroup" aria-label="追加した曲・サンプルの保存先">
          {([
            ["persist", "ブラウザに保存", "次回起動後も残ります (既定)"],
            ["temp", "今回だけ", "このタブを閉じる / リロードすると消えます"],
          ] as const).map(([m, label, hint]) => (
            <button key={m} role="radio" aria-checked={saveMode === m} title={hint} className={`px-3 py-1 text-xs ${saveMode === m ? (m === "temp" ? "bg-amber-500/20 text-amber-300" : "bg-accent/20 text-accent") : "text-zinc-400"}`} onClick={() => useDJ.getState().setSaveMode(m)}>
              {label}
            </button>
          ))}
        </div>
        {saveMode === "temp" && <span className="text-amber-300">追加したものはリロードで消えます</span>}
        {tempCount > 0 && (
          <button className="btn py-0.5" onClick={() => void useDJ.getState().keepAllTemporary()} title="一時データをすべてブラウザに保存する">
            一時 {tempCount} 件をすべて保存
          </button>
        )}
        {busy > 0 && <span className="text-accent">解析中… ({busy})</span>}
      </div>
      {seeding && <div className="text-[11px] text-accent">内蔵音源を生成しています… 操作はそのまま続けられます</div>}
      {tab === "tracks" && tracks.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2 text-[11px] text-zinc-500">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label">Auto DJ の選曲</span>
            <span>☑ {djPool.length}/{tracks.length} 曲{djScope === "all" ? " (今は全曲が対象)" : ""}</span>
            <button className="btn py-0.5" onClick={() => useDJ.getState().setDjPool(sorted.map((t) => t.id))}>
              表示中を全選択
            </button>
            <button className="btn py-0.5" onClick={() => useDJ.getState().setDjPool([])}>
              解除
            </button>
            <button
              className={`btn py-0.5 ${djScope === "selected" ? "btn-accent" : ""}`}
              aria-pressed={djScope === "selected"}
              onClick={() => useDJ.getState().setDjScope(djScope === "selected" ? "all" : "selected")}
              title="Auto DJ の選曲対象を、チェックした曲だけにする / 全曲に戻す"
            >
              対象: {djScope === "selected" ? "選んだ曲のみ" : "全曲"}
            </button>
            <button className="btn btn-primary py-0.5" onClick={() => void useDJ.getState().startAutoDJ({ scope: "selected" })} title="チェックした曲だけで Auto DJ を開始 (両デッキに曲をセットして再生)">
              ▶ 選んだ曲で Auto DJ 開始
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label">プレイリスト</span>
            <button
              className="btn py-0.5"
              disabled={djPool.length === 0}
              onClick={() =>
                useDJ.getState().confirm({
                  title: `チェック中の ${djPool.length} 曲をプレイリストとして保存`,
                  message: "名前は保存後にダブルクリックで変更できます。",
                  confirmLabel: "保存",
                  onConfirm: () => void useDJ.getState().savePlaylist(`セット ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString().slice(0, 5)}`, djPool),
                })
              }
              title="今チェックしている曲をプレイリストとして保存"
            >
              + 保存
            </button>
            {playlists.map((pl) => (
              <span key={pl.id} className="flex items-center overflow-hidden rounded-md border border-border">
                {renaming === pl.id ? (
                  <input
                    autoFocus
                    className="w-32 bg-panel px-1 text-xs"
                    defaultValue={pl.name}
                    aria-label="プレイリスト名"
                    onBlur={(e) => {
                      void useDJ.getState().renamePlaylist(pl.id, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                  />
                ) : (
                  <>
                    <button className="px-1 py-0.5 text-[10px] text-zinc-400 hover:bg-white/10 hover:text-accent" onClick={() => useDJ.getState().queueAdd(pl.trackIds)} title="このプレイリストの順番でキューに追加" aria-label={`プレイリスト ${pl.name} をキューへ`}>
                      ⇢
                    </button>
                    <button className="px-2 py-0.5 text-xs text-zinc-200 hover:bg-white/10" onClick={() => useDJ.getState().applyPlaylist(pl.id)} onDoubleClick={() => setRenaming(pl.id)} title={`${pl.trackIds.length} 曲 · クリックで選曲対象に / ダブルクリックで名前変更`}>
                      {pl.name} <span className="font-mono text-zinc-500">{pl.trackIds.length}</span>
                    </button>
                  </>
                )}
                <button className="px-1.5 py-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-200" aria-label={`プレイリスト ${pl.name} を削除`} onClick={() => useDJ.getState().confirm({ title: `「${pl.name}」を削除しますか？`, message: "曲自体は消えません。", confirmLabel: "削除", danger: true, onConfirm: () => void useDJ.getState().deletePlaylist(pl.id) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      {tab === "tracks" && tracks.some((t) => isDefaultTrack(t.name)) && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-black/20 p-2 text-[11px] text-zinc-500">
          <span>デモ曲 {tracks.filter((t) => isDefaultTrack(t.name)).length} 曲が入っています</span>
          <button
            className="btn btn-danger py-0.5"
            onClick={() => confirm({ title: "デモ曲をすべて削除しますか？", message: "標準で入っているデモ曲だけが対象です (あなたの曲は消えません)。削除後 6 秒間は「元に戻す」で取り消せます。後から ⋯ メニューで再生成できます。", confirmLabel: "削除", danger: true, onConfirm: () => useDJ.getState().deleteDefaults("tracks") })}
          >
            デモ曲をすべて削除
          </button>
        </div>
      )}
      {tab === "tracks" && tracks.length > 0 && (
        <div className="rounded-lg border border-border/60 bg-black/20 p-2 text-[11px] text-zinc-500">
          <div className="flex flex-wrap items-center gap-1.5">
            <button className="label rounded px-1 hover:bg-white/10" onClick={() => setShowQueue((v) => !v)} aria-expanded={showQueue}>
              {showQueue ? "▾" : "▸"} セットリスト (曲順) {djQueue.length ? `${djQueue.length} 曲` : ""}
            </button>
            {djOrder === "queue" && <span className="rounded bg-accent/15 px-1.5 text-accent">Auto DJ はこの順で再生</span>}
            {djQueue.length > 0 && (
              <span className="font-mono" title="今の切替設定で再生した場合の合計時間の目安 (曲の無音部分は除く)">
                合計 ≈ {fmtMin(queueSeconds)}
                {(() => {
                  const diff = queueSeconds - planMinutes * 60;
                  return <span className={Math.abs(diff) < 120 ? "text-emerald-300" : "text-amber-300"}> (プラン {planMinutes} 分に対して {diff >= 0 ? "+" : "−"}{fmtMin(Math.abs(diff))})</span>;
                })()}
              </span>
            )}
            <button className="btn py-0.5" disabled={!djPool.length} onClick={() => useDJ.getState().queueAdd(sorted.filter((t) => djPool.includes(t.id)).map((t) => t.id))} title="チェックした曲を表示順でキューに追加">
              ☑ をキューへ
            </button>
            {djQueue.length > 0 && (
              <>
                <button className="btn btn-primary py-0.5" onClick={() => { useDJ.getState().setDjOrder("queue"); void useDJ.getState().startAutoDJ(); }} title="この順番で Auto DJ を開始">
                  ▶ この順で Auto DJ
                </button>
                <button className="btn py-0.5" disabled={djQueue.length < 3} onClick={() => useDJ.getState().queueSmartSort()} title="1 曲目はそのまま、以降を BPM とキー (Camelot) が滑らかに繋がる順に並べ替え">
                  ♫ 相性順に並べ替え
                </button>
                <button className="btn py-0.5" onClick={() => useDJ.getState().queueClear()}>
                  クリア
                </button>
              </>
            )}
          </div>
          {showQueue && (
            <ol className="mt-1 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
              {djQueue.length === 0 && <li className="p-1 text-zinc-600">空です。各行の「＋」で追加、またはチェックした曲を「☑ をキューへ」</li>}
              {djQueue.map((id, i) => {
                const t = tracks.find((x) => x.id === id);
                return (
                  <li key={`${id}-${i}`} className="flex items-center gap-1 rounded bg-panel-2 px-1.5 py-0.5">
                    <span className="w-5 font-mono text-zinc-500">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-zinc-200">{t?.name ?? "(削除された曲)"}</span>
                    {t && (
                      <span className="font-mono text-zinc-500">
                        {t.bpm ? Math.round(t.bpm) : "--"}
                        {t.key ? ` ${t.key}` : ""} · {fmtMin(expectedPlaySeconds(t, djSegment, djSegment === "plan" ? (planMinutes * 60) / planSongs : undefined))}
                      </span>
                    )}
                    <button className="btn px-1.5 py-0" disabled={i === 0} onClick={() => useDJ.getState().queueMove(i, -1)} aria-label="上へ">
                      ↑
                    </button>
                    <button className="btn px-1.5 py-0" disabled={i === djQueue.length - 1} onClick={() => useDJ.getState().queueMove(i, 1)} aria-label="下へ">
                      ↓
                    </button>
                    <button className="btn px-1.5 py-0" onClick={() => useDJ.getState().queueRemove(i)} aria-label="キューから外す">
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
      {tab === "tracks" && playLog.length > 0 && (
        <div className="text-[11px] text-zinc-500">
          <button className="label rounded px-1 hover:bg-white/10" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}>
            {showLog ? "▾" : "▸"} 流した曲 ({playLog.length})
          </button>
          {showLog && (
            <div className="mt-1 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-lg border border-border/60 bg-black/20 p-2 font-mono">
              {[...playLog].reverse().map((e, i) => (
                <div key={`${e.id}-${e.at}`} className="flex justify-between gap-2">
                  <span className="truncate text-zinc-300">{i === 0 ? "▶ " : ""}{e.name}</span>
                  <span className="shrink-0">{new Date(e.at).toLocaleTimeString().slice(0, 5)}</span>
                </div>
              ))}
              <button className="btn mt-1 self-start py-0.5" onClick={() => useDJ.getState().clearPlayLog()}>
                履歴を消す
              </button>
            </div>
          )}
        </div>
      )}
      {tab === "samples" && samples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/60 bg-black/20 p-2 text-[11px] text-zinc-500">
          <span className="label">選択</span>
          <span>☑ {selSamples.size}/{samples.length}</span>
          <button className="btn py-0.5" onClick={() => setSelSamples(new Set(samples.filter((x) => filter(x.name)).map((x) => x.id)))}>
            表示中を全選択
          </button>
          <button className="btn py-0.5" onClick={() => setSelSamples(new Set(samples.filter((x) => !pads.some((p) => p.sampleId === x.id)).map((x) => x.id)))} title="どのパッドにも割り当てられていないサンプルを選ぶ">
            未使用を選択
          </button>
          <button className="btn py-0.5" disabled={!samples.some((x) => isDefaultSample(x.name))} onClick={() => setSelSamples(new Set(samples.filter((x) => isDefaultSample(x.name)).map((x) => x.id)))} title="内蔵キット (標準で入っているサンプル) を選ぶ">
            内蔵を選択
          </button>
          <button className="btn py-0.5" onClick={() => setSelSamples(new Set(samples.filter((x) => x.temporary).map((x) => x.id)))} disabled={!samples.some((x) => x.temporary)} title="「今回だけ」で追加した一時サンプルを選ぶ">
            一時を選択
          </button>
          <button className="btn py-0.5" onClick={() => setSelSamples(new Set())} disabled={!selSamples.size}>
            解除
          </button>
          <button
            className="btn btn-danger py-0.5"
            disabled={!selSamples.size}
            onClick={() => {
              const ids = [...selSamples].filter((id) => samples.some((x) => x.id === id));
              const padCount = pads.filter((p) => p.sampleId && ids.includes(p.sampleId)).length;
              confirm({
                title: `選択した ${ids.length} 件のサンプルを削除しますか？`,
                message: `${padCount ? `割り当て済みのパッド ${padCount} 個からも外れます。` : ""}削除後 6 秒間は「元に戻す」で取り消せます。`,
                confirmLabel: "削除",
                danger: true,
                onConfirm: () => {
                  void useDJ.getState().deleteSamples(ids);
                  setSelSamples(new Set());
                },
              });
            }}
          >
            選択した {selSamples.size} 件を削除
          </button>
        </div>
      )}
      {tab === "tracks" && refTrack?.key && <div className="text-[11px] text-zinc-500">◆ = {refTrack.name} ({refTrack.key}) と相性の良いキー</div>}

      <div className="min-h-0 flex-1 overflow-y-auto md:max-h-[70vh]">
        {tab === "tracks" ? (
          tracks.length === 0 ? (
            <Empty text="音楽ファイル (mp3 / wav / m4a / ogg …) や動画 (mp4 / mov / webm …・音声のみ取り込み) をドロップして登録。「⋯」からデモ曲も追加できます" />
          ) : (
            <ul className="flex flex-col gap-1">
              {sorted.map((t) => {
                const loadedIn = (["A", "B"] as DeckId[]).filter((id) => decks[id].track?.id === t.id);
                const harmonic = refTrack && refTrack.id !== t.id && keysCompatible(t, refTrack);
                return (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("track-id", t.id)}
                    className={`flex items-center gap-2 rounded-md border bg-panel-2 px-2 py-1.5 hover:border-border ${loadedIn.length ? "border-border/80" : "border-transparent"}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-cyan-400"
                      checked={djPool.includes(t.id)}
                      onChange={() => useDJ.getState().toggleDjPool(t.id)}
                      aria-label={`${t.name} を Auto DJ の選曲に含める`}
                      title="Auto DJ の「選んだ曲のみ」に含める"
                    />
                    <button
                      className={`btn no-led px-2 ${previewing === t.id ? "btn-accent" : ""}`}
                      onClick={() => void previewTrack(t.id)}
                      title="試聴: 曲の 1/3 あたりから 20 秒。マスター出力なので会場にも鳴ります (デッキに載せると止まります)"
                      aria-label={previewing === t.id ? "試聴を停止" : "試聴"}
                      aria-pressed={previewing === t.id}
                    >
                      {previewing === t.id ? "■" : "▶"}
                    </button>
                    <div className="min-w-0 flex-1">
                      {renaming === t.id ? (
                        <input
                          autoFocus
                          className="w-full rounded border border-border bg-panel px-1 text-xs"
                          defaultValue={t.name}
                          aria-label="曲名"
                          onBlur={(e) => {
                            void renameTrack(t.id, e.target.value);
                            setRenaming(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                            if (e.key === "Escape") setRenaming(null);
                          }}
                        />
                      ) : (
                        <div className="truncate text-xs font-medium" onDoubleClick={() => setRenaming(t.id)} title="ダブルクリックで名前を変更">
                          {harmonic && <span className="mr-1 text-emerald-400" title="キー相性◎">◆</span>}
                          {t.name}
                          {t.temporary && <span className="ml-1 rounded bg-amber-500/20 px-1 font-mono text-[9px] text-amber-300">一時</span>}
                          {now - t.createdAt < 20000 && now > 0 && (
                            <span className={`ml-1 rounded px-1 font-mono text-[9px] ${t.temporary ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>{t.temporary ? "✓ 追加 (今回だけ)" : "✓ 保存済み"}</span>
                          )}
                          {loadedIn.map((id) => (
                            <span key={id} className={`ml-1 rounded px-1 font-mono text-[9px] ${id === "A" ? "bg-accent/20 text-accent" : "bg-accent-2/20 text-accent-2"}`}>
                              {id}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="font-mono text-[10px] text-zinc-500">
                        {fmt(t.duration)} · {t.bpm ? `${t.bpm} BPM` : "BPM解析中"}
                        {t.key ? ` · ${t.key} (${camelot(t.keyRoot!, !!t.keyMinor)}${t.keyMinor ? "A" : "B"})` : ""} · {mb(t.size)}
                        {t.cues?.some((c) => c != null) ? " · cue" : ""}
                        {t.chorusStart != null ? ` · サビ ${t.choruses && t.choruses.length > 1 ? `×${t.choruses.length}` : fmt(t.chorusStart)}${t.chorusManual ? " ✎" : ""}` : ""}
                      </div>
                    </div>
                    {t.temporary && (
                      <button className="btn text-amber-300" onClick={() => void useDJ.getState().keepTrack(t.id)} title="継続保存に切り替える" aria-label={`${t.name} を保存`}>
                        保存
                      </button>
                    )}
                    <button className={`btn ${djQueue.includes(t.id) ? "btn-accent" : ""}`} onClick={() => useDJ.getState().queueAdd([t.id])} title="セットリスト (曲順) の最後に追加" aria-label={`${t.name} をキューに追加`}>
                      ＋
                    </button>
                    {autoDJ && (
                      <button
                        className={`btn ${nextOverride === t.id ? "btn-accent" : ""}`}
                        aria-pressed={nextOverride === t.id}
                        onClick={() => useDJ.getState().setNextOverride(nextOverride === t.id ? null : t.id)}
                        title="Auto DJ の次の曲をこれにする (1 回だけ)"
                        aria-label={`${t.name} を次に流す`}
                      >
                        次▶
                      </button>
                    )}
                    <button className="btn text-accent" onClick={() => load(t, "A")} aria-label={`${t.name} を Deck A に`}>
                      → A
                    </button>
                    <button className="btn text-accent-2" onClick={() => load(t, "B")} aria-label={`${t.name} を Deck B に`}>
                      → B
                    </button>
                    <button
                      className="btn btn-danger"
                      aria-label={`${t.name} を削除`}
                      onClick={() => confirm({ title: `「${t.name}」を削除しますか？`, message: "ブラウザ内の音源データも削除されます。元に戻せません。", confirmLabel: "削除", danger: true, onConfirm: () => void deleteTrack(t.id) })}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : samples.length === 0 ? (
          <Empty text="短い音源 (ワンショット / ループ / ボイス) や動画 (音声のみ取り込み) をドロップ。自動で空きパッドに割り当てられます" />
        ) : (
          <ul className="flex flex-col gap-1">
            {samples.filter((s) => filter(s.name)).map((s) => (
              <li
                key={s.id}
                draggable
                onDragStart={(e) => e.dataTransfer.setData("sample-id", s.id)}
                className={`flex items-center gap-2 rounded-md border bg-panel-2 px-2 py-1.5 hover:border-border ${selSamples.has(s.id) ? "border-rose-500/50" : "border-transparent"}`}
                title="パッドにドラッグして割り当て"
              >
                <input
                  type="checkbox"
                  className="accent-rose-500"
                  checked={selSamples.has(s.id)}
                  aria-label={`${s.name} を選択`}
                  onChange={(e) =>
                    setSelSamples((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(s.id);
                      else next.delete(s.id);
                      return next;
                    })
                  }
                />
                <button className={`btn no-led px-2 ${previewing === s.id ? "btn-accent" : ""}`} onClick={() => void previewSample(s.id)} aria-label={previewing === s.id ? "試聴を停止" : "試聴"} aria-pressed={previewing === s.id}>
                  {previewing === s.id ? "■" : "▶"}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">
                    {s.name}
                    {s.temporary && <span className="ml-1 rounded bg-amber-500/20 px-1 font-mono text-[9px] text-amber-300">一時</span>}
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500">
                    {s.duration.toFixed(2)}s · {mb(s.size)}
                    {padLabel(s.id).length ? <span className="ml-1 text-accent">· パッド {padLabel(s.id).join(" ")}</span> : <span className="ml-1 text-zinc-600">· 未使用</span>}
                  </div>
                </div>
                {s.temporary && (
                  <button className="btn text-amber-300" onClick={() => void useDJ.getState().keepSample(s.id)} title="継続保存に切り替える" aria-label={`${s.name} を保存`}>
                    保存
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  aria-label={`${s.name} を削除`}
                  onClick={() => confirm({ title: `「${s.name}」を削除しますか？`, message: "割り当て済みのパッドからも外れます。", confirmLabel: "削除", danger: true, onConfirm: () => void deleteSample(s.id) })}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const Empty = ({ text }: { text: string }) => (
  <div className="grid h-full min-h-24 place-items-center rounded-md border border-dashed border-border p-4 text-center text-xs text-zinc-500">{text}</div>
);
