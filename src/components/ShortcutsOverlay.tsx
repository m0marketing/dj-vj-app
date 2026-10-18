"use client";

import { useEffect } from "react";
import { useDJ, type HelpSection } from "@/lib/store";

export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "サンプラー",
    keys: [
      ["1 2 3 4 / Q W E R / A S D F / Z X C V", "パッド 1–16"],
      ["F1 – F8", "バンク A–H"],
      ["- / =", "前 / 次のバンク"],
      ["` (押しっぱなし)", "エコースロー"],
      ["P", "ドラムマシン 再生 / 停止"],
      ["Esc", "鳴っているサンプルを全停止 + VJ 演出クリア"],
    ],
  },
  {
    group: "デッキ",
    keys: [
      ["Space", "Deck B 再生 / 一時停止"],
      ["Shift + Space", "Deck A 再生 / 一時停止"],
      ["Shift + 1..4", "Deck A ホットキュー"],
      ["[ / ]  (JIS 配列では @ / [ の位置)", "Deck A ピッチ − / +"],
      ["; / '  (JIS 配列では ; / : の位置)", "Deck B ピッチ − / +"],
      ["← / →", "クロスフェーダー"],
    ],
  },
  {
    group: "ミックス / FX",
    keys: [
      ["M", "Blend (自動ミックス)"],
      ["B", "Break (4 拍止めてドロップ)"],
      ["Y / U", "Build & Drop (8 小節) / Crowd!"],
      ["T / I", "Echo Throw / Filter Rise (4 小節)"],
      ["O (押している間)", "Gate ⅛ (ゲーター)"],
      ["N", "Baby Scratch (再生中のメインデッキ)"],
      ["Shift + Enter", "Double Drop"],
      ["Backspace", "実行中のミックスを中止"],
      ["5 〜 9 / Shift + 5 〜 9", "Look 1〜5 / 6〜10 (次の小節頭で切替)"],
      ["Tab", "本番モード (大きな表示) の ON / OFF"],
      ["🎹 MIDI", "ヘッダーの 🎹 MIDI → 接続 → 機能ごとの「ラーン」を押してコントローラーを動かすと割り当て (Chrome / Edge)"],
      ["Mixer › Repeat 1 … 1/8", "ビートリピート (押している間 / タップでラッチ)"],
      ["H / L (押しっぱなし)", "HPF / LPF スイープ"],
      ["G / J / K (押しっぱなし)", "マスター Echo / Reverb / Flanger"],
      ["Enter", "VJ: DROP!"],
      [", . /", "VJ: 紙吹雪 / レーザー / 花火"],
    ],
  },
  {
    group: "その他",
    keys: [
      ["?", "このショートカット一覧"],
      ["ダブルクリック / ラベルをタップ", "スライダーをリセット"],
      ["長押し / 右クリック", "ホットキューの削除 (パッドは右クリックで編集)"],
    ],
  },
];

const GUIDE: { id: Exclude<HelpSection, "keys">; title: string; items: [string, string][] }[] = [
  {
    id: "start",
    title: "はじめに (3 分で分かる使い方)",
    items: [
      ["1. 曲を入れる", "左下の Library で「+ 曲を追加」か、ファイルをドラッグ & ドロップ。BPM・キー・サビは自動で解析されます。保存先は「ブラウザに保存」(次回も残る) か「今回だけ」"],
      ["2. 自動で回す", "ヘッダーの Mode を選んで Mixer の「Auto DJ」を押すだけ。両デッキに曲が入り、以降は自動で選曲・ミックスします。Library で曲にチェック → 「選んだ曲で Auto DJ 開始」なら好きな曲だけで回せます"],
      ["3. 映像", "右の VJ パネルで Theme (見た目) を選び「⚡ AUTO 演出」を ON。音に合わせて絵・色・カメラ・カットが自動で動きます。「⤢ プロジェクター」で外部ディスプレイ用の窓を開けます"],
      ["4. 盛り上げる", "Mixer の Hype (Build & Drop / Crowd! / Repeat)、サンプラーのパッド、VJ の一発演出。キーボードでも鳴らせます (右上の ? → ショートカット)"],
      ["Mode / Theme / 演出", "Mode = 曲の流し方 (EDM / サビ連発 / パーティー / チル / クラシック DJ / ドラムマシン)。Theme = VJ で何を映すか。演出 = VJ をどう動かすか。3 つは独立していて自由に組み合わせられます"],
    ],
  },
  {
    id: "deck",
    title: "デッキ (A / B)",
    items: [
      ["波形", "上: 再生位置まわりの拡大波形 (ドラッグでスクラブ)。下: 曲全体 (クリックで移動)。黄色の帯 = サビ、緑 = ループ、オレンジ = CUE"],
      ["CUE / ▶", "CDJ 式。停止中に CUE でその位置をキュー点に。再生中に CUE でキュー点へ戻って停止。長押しで試聴"],
      ["SYNC / Key / ♭ ♯ / 🎧", "SYNC = 相手デッキに BPM と拍を合わせる。Key (キーロック) = テンポを変えても音程を保つ (既定 ON)。♭ ♯ = キーシフト (半音)。🎧 = ヘッドホンで聴く (Mixer › 🎧 ヘッドホン で出力先を選んだ後)"],
      ["HOT 1-4", "タップで設定 / ジャンプ、✕ か長押しで削除。曲ごとに保存されます"],
      ["VINYL / Scratch", "VINYL ON で再生中にジョグを回すとスクラッチ (逆回転も鳴る)。離した位置から再生。Scratch の Baby / Chirp / Transf / Scribble / Stab / Rewind は自動パターン: 次の拍から始まり、終わると拍に合わせて元の流れに戻ります (Rewind は戻した位置から)"],
      ["サビ", "▶ サビへ = 検出したサビの頭へ (複数あれば次々に)。✎ で「ここをサビに」(8 / 16 / 32 小節) や再検出"],
      ["ループ", "Loop In / Out で手動、1 2 4 8 で拍ループ (もう一度押すと解除)、½ ×2 で長さ変更、OUT = 自動ミックスで曲を終える位置"],
      ["EQ / FILTER / VOL", "ラベルをタップ (ダブルクリック) でリセット。ジョグは停止中スクラブ、再生中はテンポのナッジ"],
      ["波形の直接編集", "Shift + ドラッグ = その範囲をサビに (小節に吸着)。右クリック = OUT (自動ミックスで曲を終える位置) を置く、OUT の上でもう一度右クリックで消す"],
    ],
  },
  {
    id: "mixer",
    title: "ミキサー",
    items: [
      ["Transition", "今すぐ繋ぐ。Blend (小節頭でベース入替) / Filter / Drop Swap (ビルド → ドロップ) / Double Drop (ドロップ同士を 8 小節重ねる) / Break → Drop / Spinback / Echo Out / Reverb Out / Loop Roll / Cut / Fade In / Fade Out。実行中は「■ 中止」で元に戻せます"],
      ["Hype", "Build & Drop = 8 小節 (または 4) のビルドアップ → 小節頭でドロップ。Crowd! = エアホーン + 歓声。Echo Throw = 今の一発を 1 拍だけエコーに投げる。Filter Rise = 次の小節頭から 4 小節ハイパスで細くして一気に開く。Gate ⅛ / 1/16 = 全体をテンポ同期で ON/OFF (押している間)。Repeat = マスターを 1 / ½ / ¼ / ⅛ 拍で刻む"],
      ["セットプラン", "Mixer › Auto の「セットプラン」に時間と曲数を入れて「▶ プランで開始」。1 曲の長さを残り時間 ÷ 残り曲数で配分し続け、長いファイルは中のサビを別の曲として数えて別の箇所から入ります。時間が来るとフェードアウトして止まります"],
      ["セットリスト (曲順)", "Library の各行「＋」で曲順に追加 (チェックした曲をまとめて / プレイリストの ⇢ でも)。↑↓ で並べ替え、「♫ 相性順に並べ替え」で BPM とキーが滑らかに繋がる順に。合計時間とプランとの差を表示。「▶ この順で Auto DJ」でその順番に再生 (終わるとシャッフルに戻る)"],
      ["山 (エネルギーカーブ)", "セットプランの「山」: 中盤ピーク / 上げ続ける / 波 / 気にしない。時間の位置に応じた目標エネルギーに合う曲 (BPM・音量の順位) を選びやすくします"],
      ["Tempo Ramp", "テンポが 16〜30% 離れた曲へ: 再生中の曲を 8 小節かけて次の曲のテンポへ寄せ (キーロックで音程は保つ)、そのままビートマッチしてブレンド。auto では自動で選ばれます"],
      ["MIC · ラップ / MC", "🎤 MIC でマイクを ON (初回は許可)。声: そのまま / メガホン / ラジオ / ロボット / 低く / 高く、Pitch (半音)、Echo (テンポ同期・押している間 / タップで固定)、Reverb。Duck = 話している間だけ音楽を −8 dB 下げるトークオーバー。マイクの音は録音にも入ります"],
      ["FX / Effects", "HPF ↑ LPF ↓ Break は押している間。Echo / Reverb / Flanger はマスターにかかる、Depth で深さ"],
      ["Auto", "Auto Follow = 止まっているデッキに次の曲を置くと、再生中の曲の終わり (OUT) で自動ミックス。Auto DJ = 選曲も自動。繋ぎ方 auto = 曲ごとに最適を選択。サビだけ繋ぐ = 各曲のサビ 16 小節だけを 2 小節で繋ぐ"],
      ["細かい設定", "選曲の対象 (全曲 / チェックした曲)、順番、相性 (BPM / キー)、A↔B の切替スパン (30 秒〜最後まで / サビの終わり)、入り位置 (見せ場 / 頭 / サビ)"],
      ["メーター", "上段: 音量。下段: エネルギー + 8 小節フレーズ内の位置と「次のフレーズまで N 小節」。Build & Drop をここに合わせると気持ちよく落ちます"],
      ["🎧 ヘッドホン", "出力先 (USB ヘッドホンなど) を選ぶと、デッキの 🎧 でその曲をフェーダー前・会場に出さずに確認できます。CUE / MASTER スライダーで混ぜ具合。Chrome / Edge / Safari 17+ (Firefox 非対応)"],
    ],
  },
  {
    id: "sampler",
    title: "サンプラー / ドラムマシン",
    items: [
      ["パッド", "8 バンク × 16。クリック / キー (1-4 Q-R A-F Z-V) で鳴らす。長押し (タッチ) で編集。Library の「サンプル」からドラッグで割り当て"],
      ["モード", "One-shot (最後まで) / Gate (押している間) / Loop / Toggle。ループ系は再生中の曲の BPM・キーに自動で合います (♪ Sync)"],
      ["🥁 Drum", "16 ステップのドラムマシン。クリックでオン → アクセント → オフ。デッキが鳴っていれば次の小節頭からそのテンポで同期。house / techno / trap / breaks のプリセット。バンク G = 909、H = 808"],
      ["録音 / Echo", "🎙 録音 = マイクから新しいサンプルを作る (開始 / 停止)。Echo = サンプラーにエコー"],
    ],
  },
  {
    id: "library",
    title: "ライブラリ",
    items: [
      ["追加 / 保存", "「+ 曲を追加」かドラッグ & ドロップ。「ブラウザに保存」なら次回も残り、「今回だけ」ならリロードで消えます (一時の曲は後から「保存」も可)"],
      ["行のボタン", "☑ = Auto DJ の選曲対象。▶ = 試聴 (会場にも鳴ります)。→ A / → B = デッキに載せる (再生中なら確認が出ます)。✕ = 削除 (6 秒以内なら「元に戻す」)"],
      ["表示", "BPM・キー (Camelot)・サビの位置・◆ = 再生中の曲とキー相性が良い。ダブルクリックで名前変更"],
      ["プレイリスト", "チェックした曲を名前付きで保存。クリックで選曲対象に、ダブルクリックで名前変更"],
      ["⋯ メニュー", "内蔵キット / デモ曲の追加、バックアップ (.zip) の書き出し / 読み込み、使用容量"],
    ],
  },
  {
    id: "vj",
    title: "VJ",
    items: [
      ["Theme × 演出", "Theme = 何を映すか (DevDay 2026 / Neon / Classic / Minimal / Free)。演出 = どう動かすか (フェス / クラブ / シネマ / キーノート / ミニマル)。自由に組み合わせ。例: DevDay 2026 × キーノート = 会場向けの落ち着いた見せ方、DevDay 2026 × フェス = パーティー"],
      ["Look", "Theme × 演出 × 絵 (固定 or 自動切替) × 色 をひとまとめにした「場面」。ウォームアップ / ピーク / ブレイクダウン / DevDay キーノート / DevDay パーティー / DevDay おまかせ が最初から入っていて、「+ 今の状態を保存」で自分の Look も作れます。クリックすると次の小節頭で切り替わります (曲が止まっていれば即時)"],
      ["レイヤー 2", "2 つ目の絵を重ねる: プリセットを Shift + クリック (または「レイヤー 2」の選択)。合成 (スクリーン / 加算 / オーバーレイ / 乗算 / 差の絶対値 / 通常)、量、鏡。🎲 おまかせでランダムな組み合わせ。Look に保存されます"],
      ["色", "曲のキー (既定) / 固定 (スライダー) / パレット (DevDay・ネオン・サンセット・オーシャン・ウォーム・モノ を 8 小節ごとに順番に)"],
      ["演出「カスタム」", "細かい設定 › 「今の演出をベースにカスタム」で、カメラ・揺れ・RGB ずれ・グリッチ・フラッシュ・グレイン・ライトリーク・ビネット・カットの長さ・種類・切替間隔・黒帯・ストロボ可 を自分で決められます"],
      ["演出「おまかせ」", "曲のエネルギーで演出が自動で変わります: ブレイク = シネマ (黒帯・ディゾルブ・ゆっくり)、通常 = クラブ、盛り上がり / ドロップ = フェス。数値はなめらかに補間されるので切り替わりは気づかれません"],
      ["⚡ AUTO 演出", "音に合わせて色・明るさ、Theme の範囲でフレーズごと / ブレイク / ドロップに絵を切替、カメラのズーム・揺れ・カット・RGB ずれ・グリッチ・グレインを自動で。プリセットを押すとその絵に固定 (演出は続く)。全画面フラッシュは最大 3 回/秒に制限"],
      ["Now Playing", "曲が始まると左下に「NOW PLAYING 曲名」のローワーサードを 7 秒表示 (常時表示 › チェックで ON / OFF)。パッドの演出にも「Now Playing (曲名)」を割り当てられます"],
      ["一発演出", "押した瞬間だけの演出 (DROP / 紙吹雪 / レーザー / 花火 / テキスト…)。パッドにも紐付けられます"],
      ["細かい設定", "自動演出の中身を個別に ON / OFF、色 / 強さ / ビート感度 / 残像"],
      ["常時表示", "イベント名などのキャプションとロゴ画像。プロジェクターにも出ます"],
      ["⤢ プロジェクター", "別ウィンドウに映像だけを出す。外部ディスプレイへ移して F で全画面。このタブを閉じると止まります"],
    ],
  },
];

export default function ShortcutsOverlay() {
  const open = useDJ((s) => s.showShortcuts);
  const section = useDJ((s) => s.helpSection) ?? "start";
  const setOpen = useDJ((s) => s.setShowShortcuts);
  const openHelp = useDJ((s) => s.openHelp);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
  if (!open) return null;
  const tabs: { id: HelpSection; label: string }[] = [...GUIDE.map((g) => ({ id: g.id as HelpSection, label: g.title.split(" (")[0] })), { id: "keys", label: "キーボード" }];
  const guide = GUIDE.find((g) => g.id === section);
  return (
    <div className="fixed inset-0 z-[55] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="ヘルプ" className="panel flex max-h-[90dvh] w-full max-w-3xl flex-col gap-3 overflow-hidden p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">ヘルプ</h2>
          <button className="btn" onClick={() => setOpen(false)}>
            閉じる (Esc)
          </button>
        </div>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="ヘルプの項目">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={section === t.id} className={`btn no-led py-1 ${section === t.id ? "btn-accent" : ""}`} onClick={() => openHelp(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 overflow-y-auto pr-1">
          {section === "keys" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {SHORTCUTS.map((g) => (
                  <section key={g.group}>
                    <h3 className="label mb-1">{g.group}</h3>
                    <dl className="flex flex-col gap-1 text-xs">
                      {g.keys.map(([k, v]) => (
                        <div key={k} className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1">
                          <dt className="font-mono text-zinc-200">{k}</dt>
                          <dd className="text-right text-zinc-400">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
              <p className="mt-4 text-[11px] text-zinc-500">キーは US 配列の物理位置です (JIS キーボードでも同じ位置のキーが効きます)。文字入力中はショートカットは無効です。ボタンをクリックした後も Space / Enter はデッキに届きます (フォーカスは自動で外れます)。</p>
            </>
          ) : (
            guide && (
              <section>
                <h3 className="mb-2 text-sm font-semibold text-zinc-100">{guide.title}</h3>
                <dl className="flex flex-col gap-2 text-xs">
                  {guide.items.map(([k, v]) => (
                    <div key={k} className="grid gap-1 border-b border-border/50 pb-2 sm:grid-cols-[10rem_1fr] sm:gap-3">
                      <dt className="font-semibold text-zinc-200">{k}</dt>
                      <dd className="leading-relaxed text-zinc-400">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )
          )}
        </div>
      </div>
    </div>
  );
}
