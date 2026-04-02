# RT-Lab プロジェクト

放射線技師（RT）が業務で役立つWebツールを無料・ブラウザ完結で提供するサイト。

**オーナー:** Hiroki
**Notionページ:** https://www.notion.so/32b108a56b1a8115bcadf380aef7bf6e
**ローカルパス:** `/Users/Ahiroki/rt-lab/`
**ローカル確認:** `python3 -m http.server 8080` → http://localhost:8080

---

## サイトコンセプト

- インストール不要（ブラウザで完結）
- データ外部送信なし（プライバシー重視）
- 無料・広告なし

---

## ツール進捗

| ツール | ステータス | パス |
|---|---|---|
| DRL比較ツール | ✅ 公開中 | `drl-comparison/index.html` |
| MTF計算ツール | ✅ 公開中 | `mtf-calculator/index.html` |
| NPS計算ツール | ✅ 公開中 | `nps-calculator/index.html` |
| CT Contrast Simulator（造影CT薬物動態シミュレータ） | ✅ 公開中 | `contrast-simulator/index.html` |
| CT Dose Estimator（CT線量推定ツール） | ✅ 公開中 | `ct-dose-estimator/index.html` |
| 脳画像差分ツール（CT/MRI） | ✅ 公開中 | `brain-diff/index.html` |
| CNR計測ツール | ✅ 公開中 | `cnr-calculator/index.html` |
| 一般撮影条件参照 | 🚧 開発中 | 未作成 |
| MRI QA/QC自動計測ツール | 📋 計画中 | 未作成 |
| 各モダリティ 計測・QAQCツール | 📋 計画中 | 未作成 |
| CT臓器線量推定ツール | 📋 計画中 | 未作成 |

---

## ディレクトリ構造

```
rt-lab/
├── CLAUDE.md               ← このファイル
├── index.html              ← トップページ
├── drl-comparison/
│   └── index.html          ← DRL比較ツール（公開中）
├── mtf-calculator/
│   └── index.html          ← MTF計算ツール（公開中）
├── nps-calculator/
│   └── index.html          ← NPS計算ツール（公開中）
├── contrast-simulator/
│   └── index.html          ← CT Contrast Simulator（公開中）
├── ct-dose-estimator/
│   └── index.html          ← CT Dose Estimator（公開中）
├── brain-diff/
│   └── index.html          ← 脳画像差分ツール（公開中）
├── cnr-calculator/
│   └── index.html          ← CNR計測ツール（公開中）
└── .claude/
    └── launch.json         ← ローカルサーバー設定
```

---

## 既知の課題

（現時点で既知の課題なし）

---

## 作業ログ

| 日付 | 内容 |
|---|---|
| 2026-03-23 | 現状確認・整理。Notion登録。CLAUDE.md作成 |
| 2026-03-24 | MTF計算ツール（Circular Edge法）実装・公開 |
| 2026-03-25 | NPS計算ツール（2D-NPS）実装・公開。トップページ更新情報の日付修正 |
| 2026-03-26 | CT Contrast Simulator 実装・公開。Baeの薬物動態コンパートメントモデルに基づくTDCシミュレーション。kVp別CT値変換・A/Bプロトコル比較機能搭載 |
| 2026-03-27 | CT Dose Estimator 実装・公開。AAPM Report 204ベースのSSDE計算、DLP→実効線量換算、Japan DRL 2025比較機能搭載。GitHub Pages初期セットアップ |
| 2026-03-29 | 脳画像差分ツール 実装・公開。2シリーズDICOM入力、剛体→affine→弱いB-spline非剛体位置合わせ、差分オーバーレイ可視化。Web Worker非同期処理 |
| 2026-03-29 | CNR計測ツール 実装・公開。ROI設定（円形/矩形）、CNR・CNRlow（NPSベース）・Detectability Index (d' NPWE)・Visibility（Rose基準）計測機能搭載 |
