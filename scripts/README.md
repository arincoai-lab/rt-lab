# scripts/

開発用スクリプト。`deploy.yml` の `--exclude 'scripts'` により**本番には公開されない**。

## generate-og.py

OGP画像（1200×630 PNG）を `assets/og/` に生成する。記事は `blog/index.html` の
`.blog-card` から自動抽出するため、記事を追加したら再実行するだけでよい。

```bash
python3 scripts/generate-og.py              # 全部
python3 scripts/generate-og.py --only <slug> # 1枚だけ
```

Chrome headless を使う（`CHROME_BIN` で実行ファイルを上書き可）。

## test-drl-mapping.js

DRL値とプロトコール名マッピングの回帰テスト。**DRL値やkeywordMapを触ったら必ず実行する。**

```bash
node scripts/test-drl-mapping.js
```

検査内容:
1. `drl-comparison` の全DRL値と `ct-dose-estimator` の `DRL_VALUES` が照合表と一致すること
2. keywordMap が「より緩い判定（＝高いDRL）」側に誤マッピングしないこと
3. 配布サンプル `templateRows` が実マッチャで正しいカテゴリに解決すること
4. `drl` と `keywordMap` のキー整合

## jev-drl-oracle.js ＋ fixtures/protocol-names.json

`suggestDrlCategory`（キーワード判定）に対する**第二意見**を、判定専用モデル Jev から取って
食い違いを一覧にする。人がその食い違いを裁き、キーワード側の誤りと確定したものを
`test-drl-mapping.js` の回帰ケースへ移す、という使い方をする。

```bash
node scripts/jev-drl-oracle.js --dry-run --show      # キー不要。件数・選択肢数・トークン見積り
TYPESAFE_API_KEY=... node scripts/jev-drl-oracle.js  # 実行（249件で約10秒・約$0.013）
```

Node.js 18 以上が要る（グローバル `fetch` と `AbortSignal.timeout`）。`--dry-run` だけは古い Node でも動く。

- 区分一覧も `suggestDrlCategory` 本体も `drl-comparison/index.html` から**抽出してそのまま実行**する。
  ロジックを書き写さないので、写し間違いでオラクルだけ古くなることがない
- **年齢帯・管電圧帯・FOV の数値判定はコード側で先に確定**させ、矛盾する選択肢を落としてから
  Jev に渡す。Jev は数値の比較が苦手（公式 model-jaggedness に明記）で、そこを任せると
  2026-09-09 に直したのと同じ「年齢帯の取り違え」を再生産する
- Jev の提案が**より緩い（DRL値の高い）区分**のときは別表に出す。過去の誤マッピングは全部この向き
- コーパスは**合成**。実施設のプロトコル名・線量データ・患者情報は入れないこと。
  `expect` は参考ラベルで、人の確認を経ていない（確定したものだけ回帰ケースへ移す）

### 2026-09-23 の実行結果

249件で キーワード判定の正答率 **83.8% → 93.6%**、Jev 95〜96%（実行ごとに微動）。
回帰テストは 428 → **488チェック**。

見つかった誤りのうち**危険な向き（より緩い＝高いDRLに倒れる）**:

| 名前の例 | 落ちていた区分 | 本来 |
|---|---|---|
| 尿路結石 単純 | 頭部単純ルーチン（67 / 1260） | `'単純'` 単独のワイルドカード。（対象外） |
| 膝関節正面 | 胸部正面（0.3） | `'正面'` 単独のワイルドカード。（対象外） |
| 胸部正面 120kV・150kV | 胸部正面（100kV未満・0.3） | 数値表記のkVを読めていなかった。100kV以上（0.2） |
| 頚椎側面 | 頚椎正面（0.5） | 側面の区分は無い。（対象外） |
| 腹部大動脈瘤 ステントグラフト | 非CTO PCI（1300） | `'ステント'` で吸われていた。EVAR（910） |
| 肺動静脈奇形 塞栓 | 脳血管内治療：脳動静脈奇形（3700） | PAVM simple type（870） |
| MIBG・BMIPP など123I製剤 | 脳血流：123I-IMP（200 MBq） | 収載外。（対象外） |
| 低線量肺がん検診CT | 胸部1相（11 / 430） | 収載区分が無い。（対象外） |
| 大動脈CTA・腎動脈CTA | 冠動脈（57 / 940） | `'CTA'` 単独で吸われていた。（対象外） |
| 骨盤 骨条件 | 上腹部～骨盤1相（14 / 720） | `'骨盤'` 単独。（対象外） |

**独立レビューで見つかった「一次修正が作った穴」**（同日中に修正済み）:

- kVの正規表現が `1[0-4][0-9]` で **150kV を取りこぼし**、部位の文脈も要求していなかったため
  「膝関節正面 80kV」まで胸部に吸い、逆に「腰椎正面 120kV」を（対象外）に後退させていた
  → kV は **胸部・検診という文脈を伴うときだけ**読むパターンに変更
- `'腹部大動脈'` を手技語なしでEVARのキーワードにしたため「腹部大動脈造影」までEVAR（910）に落ちた
  → `腹部大動脈.*(ステントグラフト|内挿|EVAR)` の複合に変更
- exclude は**正規表現ではなく素の部分一致**なので、`'DAT'` が `sedation` に誤爆して
  より高い「安静+負荷（270 MBq）」へ落としていた → `'123I'` キーワード自体を外して解決
- keywords は `new RegExp()` を通るため **`'安静+負荷'` はリテラルに一致していなかった**
  （`+` が量指定子になる）→ `安静\+負荷` にエスケープし、全角「安静＋負荷」も追加

**まだ残っている（人の判断が要る／方式の限界）**:

- 一般撮影の小児は年齢を数値で解釈できないため、「小児胸部 12歳」が小児胸部（5歳）に落ちる。
  安全側（低いDRL＝厳しい判定）だが誤り。キーワード方式のままでは直せない
- 小児CTの英語名・月齢表記（`Head 8y` / `腹部 生後3か月`）と歯科CBCTのFOV数値（`FOV 60cm2`）は
  （対象外）に落ちる。安全側の取りこぼしで、利用者が手で選べば済む
- **管電圧が名前に無い「胸部正面」は 100kV未満（0.3 mGy）と黙って仮定している**（従来どおりの挙動）。
  実際に120kVで撮っている施設は 0.2 ではなく 0.3 と比べることになり、**緩い向き**に倒れる。
  `MODALITIES.general.optionalCols` には `'管電圧'` 列があるので、名前ではなく列から読むのが本筋。
  挙動が変わるので方針判断として保留
- `腹部単純CT` `ポータブル胸部 AP` `PCI`（CTO情報なし）`頭部4方向` などは「DRLs2025にその区分があるか」
  の解釈自体が分かれる。fixtures では `expect: null`（未確定）にしてあり、レポートの
  「未確定のまま」表に毎回出る。決まったら `expect` を埋めて回帰ケースへ移す
- `exclude` は素の部分一致なので、`'LAT'` `'CT'` `'PCI'` `'EVT'` のような短いASCII語は
  他の語の一部に誤爆しうる。exclude に語を足すときは長めの語を選ぶこと
- 全角表記（`１２０ｋＶ`）はページ側のマッチャでは読めない（オラクル側だけ正規化している）

## generate-related.js

各ツールページの `</main>` 直前に「関連ツール」ブロック（`.rt-related`）を生成して差し込む。
リンクの関係は `TOOLS`（名前・一言説明）と `RELATED`（ページ → 関連ツール）の2か所だけに書く。

```bash
node scripts/generate-related.js          # 生成して書き戻す（冪等）
node scripts/generate-related.js --check  # 差分があれば exit 1
```

- 1ページの関連は2〜3本。クラスタ（画質評価／差分／MRI／造影剤／線量／心臓）で結ぶ。無理に穴埋めしない
- 一言説明は各ページの meta description に書かれた機能だけを言う
- **ツールを足したら** `TOOLS` と `RELATED` に追記して再生成する（既存ページからの被リンクも忘れずに足す）。
  忘れると `test-onpage.js` が「sitemap にあるが未登録」で落ちる
- マーカー（`RELATED:START/END`）の間は手で編集しない。`.rt-related` のスタイルは `assets/site.css`

## test-onpage.js

公開ページの「オンページ構造」の回帰テスト。**ページを足す・リンクを変える・`RELATED` を触ったら必ず実行する。**

```bash
node scripts/test-onpage.js
```

検査内容:

- sitemap の全URLが実ファイルに解決し、全 `index.html` が sitemap に載っている
- 全ページに title / description / canonical（自分のURL）/ og:image / h1（1つ）がある
- sitemap にあるツールがすべて `TOOLS` / `RELATED` に登録されている（登録漏れの検出）
- 孤立ページが無く、ツールページの被リンク（静的HTMLの `<a>`。`site.js` が注入する応援帯は数えない）が3本以上
  （研究公開の `subtraction-demo` のみ2本）
- 関連ツールブロックが `generate-related.js` の出力と一致し、ページに1つだけ・`<main>` の中にある
- FAQPage の質問と回答が可視テキストにある。**回答は可視の1段落と完全一致**、質問はいずれかの段落に含まれ、回答は質問の後・次の別の質問の前にある（末尾を削った回答・別の質問の回答への入れ替え・`<title>` や `hidden`・`display:none`・`<template>`・`<noscript>` の中は不可）。FAQPage は1ページ1個で、JSON-LD は JSON として読める。生成ページは `generate-faq.js` の出力と一致し、1個・正しい位置にある

2026-10-03の監査で、8ツールの被リンクがトップ1本だけだった（Search Console で好調だった `mtf-calculator` も）。
文章で注意しても再発するので、テストで検知する。

**CI**: PR と main への push で `.github/workflows/test.yml`（Tests）が実行する。`deploy.yml` とは独立で、失敗してもデプロイは止まらない（検知のみ）。コミット前にも手で実行すること。
検査対象のツール一覧は `TOOLS` ではなく sitemap から独立に導いている（`TOOLS` から作ると登録漏れを検出できない）。
一時コピー上の変異テストで、未登録ツールの追加・ブロックの重複・`</main>` の外への移動・`RELATED` からの削除・リンク1本の欠落・FAQ の質問と回答の入れ替え・回答の末尾の欠落・FAQ の非表示化・未登録ページへの FAQPage の追加などがすべて落ちることを確認済み。
**検査しない限界**: 空白だけの差（`0.693` と `0. 693`）、クラスや CSS による非表示（`.rt-faq{display:none}` など）。表示の可否は hidden 属性とインラインの `display:none` までしか追わない。

## generate-faq.js

ページの FAQPage 構造化データ（JSON-LD）から、可視の「よくある質問」ブロック（`.rt-faq`）を生成して差し込む。
JSON-LD を唯一の正とし、可視側は機械的に導く（文面は変えない）。

```bash
node scripts/generate-faq.js          # 生成して書き戻す（冪等）
node scripts/generate-faq.js --check  # 差分があれば exit 1
```

- 対象: トップ（フッター直前）と6ツールページ（関連ツールの直前）。`PAGES` に列挙
- 対象外: `drl-comparison`・`mri-simulator`・ブログ記事は手書きの可視FAQ。`test-onpage.js` が「JSON-LD の質問と回答が可視テキストにある」ことだけ検査する
- **新規ツールページ**は FAQPage の JSON-LD を書いて `PAGES` に足し、再生成する
- FAQPage の構造化データは、同じ質問と回答がページ上に見えていることが前提。JSON-LD だけを先に直さない

## drl2025-provenance.json

`drl-comparison/index.html` の `MODALITIES` に入っている全DRL値と、
その出典（J-RIME「日本の診断参考レベル（2025年版）」報告書の行番号と原文）の照合表。

`drl-comparison` と `ct-dose-estimator` の両方をカバーする（`tool` フィールドで区別）。

- 原典: https://j-rime.qst.go.jp/report/JapanDRLs2025_ja.pdf
- 生成日: 2026-09-09（99件すべて原典と一致を確認。独立レビューでも全件再照合済み）
- `外傷全身CT` の `values` は `[5290]`（CTDIvol は原典が n/a のためコード側は `null`）

**DRL値を変更するときは、必ず原典PDFの該当節と突き合わせ、この照合表も更新すること。**
2026-09-09 以前は、CT成人以外の37値がDRLs2025より前の世代の値のまま残っており、
小児CT・一般撮影では実際のDRLより高い値だったため「DRL以下」と誤判定される状態だった。
