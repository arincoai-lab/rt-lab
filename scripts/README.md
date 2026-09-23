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
TYPESAFE_API_KEY=... node scripts/jev-drl-oracle.js  # 実行（224件で約12秒・約$0.012）
```

- 区分一覧も `suggestDrlCategory` 本体も `drl-comparison/index.html` から**抽出してそのまま実行**する。
  ロジックを書き写さないので、写し間違いでオラクルだけ古くなることがない
- **年齢帯・管電圧帯・FOV の数値判定はコード側で先に確定**させ、矛盾する選択肢を落としてから
  Jev に渡す。Jev は数値の比較が苦手（公式 model-jaggedness に明記）で、そこを任せると
  2026-09-09 に直したのと同じ「年齢帯の取り違え」を再生産する
- Jev の提案が**より緩い（DRL値の高い）区分**のときは別表に出す。過去の誤マッピングは全部この向き
- コーパスは**合成**。実施設のプロトコル名・線量データ・患者情報は入れないこと。
  `expect` は参考ラベルで、人の確認を経ていない（確定したものだけ回帰ケースへ移す）

### 2026-09-23 の実行結果

224件で キーワード判定の正答率 83.8% → **91.9%**（修正後）、Jev 94.8〜95.2%（実行ごとに微動）。
見つかった誤りのうち危険な向きのもの: `'単純'` 単独でCT頭部（CTDIvol 67）に落ちる／`'正面'` 単独で
胸部正面に落ちる／数値表記のkV（120kV）を読めず100kV未満（0.3 mGy）と判定する／頚椎側面が正面に吸われる／
腹部大動脈瘤ステントグラフトが非CTO PCI（1300）に吸われる／肺動静脈奇形が脳動静脈奇形（3700）に吸われる／
収載外のMIBGが123I-IMPに吸われる。いずれも回帰ケース化して修正済み。

**まだ残っている（人の判断が要る）**:

- 一般撮影の小児は年齢を数値で解釈できないため、「小児胸部 12歳」が小児胸部（5歳）に落ちる。
  安全側（低いDRL＝厳しい判定）だが誤り。キーワード方式のままでは直せない
- 小児CTの英語名・月齢表記（`Head 8y` / `腹部 生後3か月`）と歯科CBCTのFOV数値（`FOV 60cm2`）は
  （対象外）に落ちる。安全側の取りこぼしで、利用者が手で選べば済む
- `低線量肺がん検診CT` `腹部単純CT` `ポータブル胸部 AP` `PCI`（CTO情報なし）`骨盤 骨条件` などは
  「DRLs2025にその区分があるか」の解釈自体が分かれる。Hiroki の判断待ち
- **管電圧が名前に無い「胸部正面」は 100kV未満（0.3 mGy）と黙って仮定している**（従来どおりの挙動）。
  実際に120kVで撮っている施設は 0.2 ではなく 0.3 と比べることになり、**緩い向き**に倒れる。
  未設定にして人に選ばせるか、このままにするかは方針の問題なので変えていない

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
