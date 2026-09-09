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

## drl2025-provenance.json

`drl-comparison/index.html` の `MODALITIES` に入っている全DRL値と、
その出典（J-RIME「日本の診断参考レベル（2025年版）」報告書の行番号と原文）の照合表。

- 原典: https://j-rime.qst.go.jp/report/JapanDRLs2025_ja.pdf
- 生成日: 2026-09-09（95件すべて原典と一致を確認）

**DRL値を変更するときは、必ず原典PDFの該当節と突き合わせ、この照合表も更新すること。**
2026-09-09 以前は、CT成人以外の37値がDRLs2025より前の世代の値のまま残っており、
小児CT・一般撮影では実際のDRLより高い値だったため「DRL以下」と誤判定される状態だった。
