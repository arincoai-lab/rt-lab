# RT-Lab プロジェクト

放射線技師（RT）が業務で役立つWebツールを無料・ブラウザ完結で提供するサイト。

**オーナー:** Hiroki
**Notionページ:** https://www.notion.so/32b108a56b1a8115bcadf380aef7bf6e
**本番URL:** https://rt-ai-lab.com/ （GitHub Pages / `main` へのpushで自動デプロイ）
**リポジトリ:** https://github.com/arincoai-lab/rt-lab
**ローカルパス:** `/Users/Ahiroki/rt-lab/`
**ローカル確認:** `python3 -m http.server 8080` → http://localhost:8080

---

## 構成方針（重要）

- **純粋な静的HTMLサイト**。ビルド不要で、各ツールは自己完結型の `index.html`。
- リポジトリのルートがそのまま本番（`.github/workflows/deploy.yml` が公開対象を絞り込んでアップロード）。
- 共有アセットは `assets/site.{css,js}`（応援フッター帯・Cookieレス解析の注入）。
- 外部CDN（Chart.js / PapaParse）は SRI（`integrity` + `crossorigin`）付きで読み込む。
- ~~Next.js版~~ は未デプロイの死蔵コードだったため 2026-07-03 に撤去済み（履歴参照）。

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
| 心臓CT 最適位相決定ツール | ✅ 公開中 | `cardiac-phase-optimizer/index.html` |
| 造影剤クイック計算ツール | ✅ 公開中 | `contrast-quick/index.html` |
| 一般撮影条件参照ツール | ✅ 公開中 | `exposure-reference/index.html` |
| Task-based IQ評価ツール | 🔬 研究公開 | `task-based-iq/index.html` |
| Subtractionツール（脳CT/MRI差分）デモ | 🔬 研究公開 | `subtraction-demo/index.html`（サンプルは `samples/`） |
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
├── cardiac-phase-optimizer/
│   └── index.html          ← 心臓CT 最適位相決定ツール（公開中）
├── contrast-quick/
│   └── index.html          ← 造影剤クイック計算ツール（公開中）
├── exposure-reference/
│   └── index.html          ← 一般撮影条件参照ツール（公開中）
├── task-based-iq/
│   └── index.html          ← Task-based IQ評価ツール（研究公開）
├── subtraction-demo/
│   └── index.html          ← Subtractionツール デモ（研究公開）
├── samples/                ← Subtraction等のサンプル出力（合成データ）
├── assets/
│   ├── site.css            ← 共有スタイル（応援フッター帯）
│   └── site.js             ← 共有スクリプト（解析注入・フッター帯）
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
| 2026-04-07 | 心臓CT 最適位相決定ツール 実装・公開。心拍数・CT装置・再構成モードから最適位相を算出。Diastasis時間窓・時間分解能の比較、ECG心周期ビジュアライゼーション、DSCT対応 |
| 2026-06-08 | SEO最適化（SSDE/NPS/MTF/DRL）：title・h1・解説・FAQPage構造化データ追加。Search Console分析に基づく検索意図対応 |
| 2026-06-09 | 造影剤クイック計算ツール 実装・公開。体重・ヨード濃度から造影剤量・総ヨード量・注入速度・注入時間を即計算。生食後押し・希釈対応。体重比例法ベース、ブラウザ完結・外部送信なし。サイト改善計画（毎日使う必須サイト化＋収益化）始動 |
| 2026-06-09 | 収益化土台整備：Cloudflare Web Analytics（Cookieレス）導入、応援ページ`/support/`新設（OFUSE投げ銭・note導線・アフィリ枠）、共有アセット`assets/site.{js,css}`を全ページ展開、sitemap整備（cardiac/task-based追加）。About強化（運営者＝16年目RT・開発ストーリーnote導線でE-E-A-T） |
| 2026-06-09 | 造影剤クイック計算ツールに体表面積法（BSA, Mostellerの式）を追加。体重比例法と体表面積法を切替可能にし、両法の相当値（gI/kg⇔gI/m²）を自動換算表示。解説・FAQ・SEO（title/h1）も両法対応に更新 |
| 2026-06-10 | 一般撮影条件参照ツール 実装・公開（`exposure-reference/`）。全身約50項目の部位別撮影条件（kVp・mAs・SID・グリッド・焦点）を編集可能な早見表で提供。代表値プリセットを自施設値に編集しlocalStorage保存、行追加/削除・JSON書出/読込対応。kVp15%ルール・グリッド変換係数（Bucky factor）の補正計算搭載。FAQPage構造化データ・SEO対応。ブラウザ完結・外部送信なし |
| 2026-06-12 | 造影剤クイック計算ツール 大幅改善。①結果表示をインジェクタ設定風のフェーズ表示に刷新（相ごとに注入速度mL/s・量mL・時間を大きく表示、そのままインジェクタに入力可能）②ヨード量をgI→mgI表記に統一（mgI/kg・mgI/m²）③ヨード量を総量（mgI/kg）と注入速度（mgI/kg/s）の2モード切替に変更、IDR(gI/s)直接入力を廃止 ④注入プロトコルをフェーズビルダー方式に刷新：相（造影剤原液／希釈造影剤／生食／待機）を1つずつ追加・編集・削除可能。**造影剤相ごとに「必要ヨード量（mgI/kg or mgI/kg/s）＋注入時間」を直接入力**（配分%方式から変更）→二段階・分割で相ごとに異なる速度を設定できる。単相＋後押し／二段階／分割／クロスのプリセット搭載。生食相は速度空欄で直前相と同速度を自動採用。方法・モード切替時は各相の値を総ヨード量保存で自動換算 ⑤設定内容を条件チップとフェーズ表示で結果に明示。入力欄の整列修正（ヨード量をモード直下に、体重・身長の高さ揃え）。FAQ構造化データ・解説も更新 |
| 2026-07-03 | サイト構成を静的HTMLに一本化。未デプロイのNext.js版（`app/`・`lib/`・`components/`・`next.config.ts`等）を撤去。Subtractionのサンプル資産を`public/samples/`→`samples/`へ退避し、静的ショーケース`subtraction-demo/`を新設（トップのツール一覧に研究公開カードとして掲載）。CDNスクリプト（Chart.js/PapaParse）にSRI（integrity+crossorigin+referrerpolicy）を付与。deployワークフローを公開対象ファイル限定に変更（CLAUDE.md/AGENTS.md/test-data/.claude等を非公開化）。CLAUDE.md/AGENTS.md/sitemapを実態に更新 |
