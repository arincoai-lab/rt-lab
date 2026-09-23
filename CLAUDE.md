# RT-Lab プロジェクト

放射線技師（RT）が業務で役立つWebツールを無料・ブラウザ完結で提供するサイト。

**オーナー:** Hiroki
**Notionページ:** https://www.notion.so/32b108a56b1a8115bcadf380aef7bf6e
**本番URL:** https://rt-ai-lab.com/ （GitHub Pages / `main` へのpushで自動デプロイ）
**リポジトリ:** https://github.com/arincoai-lab/rt-lab
**ローカルパス:** `/Users/Ahiroki/Documents/Claude/Projects/rt-lab/`
**ローカル確認:** `python3 -m http.server 8080` → http://localhost:8080
**ブログ企画・公開台帳:** `../content-hub/rt-lab-blog.md`（リポジトリ外。デプロイ対象に含めないため。3ライン横断の状況は `../content-hub/DASHBOARD.md`）

---

## 構成方針（重要）

- **純粋な静的HTMLサイト**。ビルド不要で、各ツールは自己完結型の `index.html`。
- リポジトリのルートがそのまま本番（`.github/workflows/deploy.yml` が公開対象を絞り込んでアップロード）。
- 共有アセットは `assets/site.{css,js}`（応援フッター帯・Cookieレス解析の注入）。ブログは `assets/blog.css` を共有。
- **ブログ** は `/blog/`（一覧）＋ `/blog/<英語ケバブケーススラッグ>/index.html`（1記事1ファイルの手書き静的HTML、SSG不使用・記事20本超で再検討）。記事は情報収集クエリ狙い・ツールページとtitle/h1を棲み分け、YMYL対応（一次情報の出典・著者ボックス・免責・公開/更新日）必須。
- **記事追加時のチェックリスト**（1つでも漏れると本番が中途半端な状態になる。自動化の手順は `Scheduled/rt-lab-blog-writer/SKILL.md` STEP 2 が正）:
  1. `blog/<slug>/index.html` を作成（既存記事に準拠。Article / BreadcrumbList / FAQPage の3種、Article には `image` と `author.sameAs`）
  2. `python3 scripts/generate-og.py --only <slug>` で `assets/og/<slug>.png`（1200×630）を生成し、記事に `og:image` / `og:image:width|height` / `og:site_name` / `twitter:card|title|description|image` を設定
  3. `blog/index.html`: `.blog-card` を先頭に追加＋ `CollectionPage.mainEntity` の ItemList にも追加（position を振り直す）
  4. ルート `index.html`: 「最新記事」`.posts` の先頭に `.post-card` を追加し**最新3本に保つ**（タイトルは一覧と文字列一致）／「更新情報」`.news-list` にも1行追加
  5. 既存記事の `.blog-related` に新記事を足して**相互リンク**にする
  6. 誘導先ツールページに「📖 より詳しい解説」の逆リンクを追加
  7. `sitemap.xml` に新記事の `<url>` を追加。**既存URLの `lastmod` は可視の内容が変わったときだけ動かす**（metaだけの変更で更新すると lastmod の信頼性が落ちる）
- トップ（`index.html`）は `assets/blog.css` を読み込まない。blog.css は `*` リセット・`body`・`:root`（`--bg`/`--text`）をグローバルに定義しており、トップのインライン`<style>`より後に来ると配色が変わる。`.post-*` のスタイルはトップのインライン`<style>`側にある。
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
| MRIシミュレータ（教育用） | ✅ 公開中 | `mri-simulator/index.html` |
| 造影検査 腎機能チェッカー（eGFR/CT・MRI） | ✅ 公開中 | `egfr-checker/index.html` |
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
├── mri-simulator/
│   └── index.html          ← MRIシミュレータ（教育用・公開中）
├── egfr-checker/
│   └── index.html          ← 造影検査 腎機能チェッカー（eGFR/CT・MRI・公開中）
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

- **FAQPage構造化データと可視コンテンツが不一致のページが6件**（`contrast-quick` / `ct-dose-estimator` / `egfr-checker` / `exposure-reference` / `mtf-calculator` / `nps-calculator`）。JSON-LD に Q&A があるのにページ上に対応する可視のQ&Aブロックが無い。構造化データは可視コンテンツと一致している必要があるため、`drl-comparison`（可視FAQセクション）か `mri-simulator`（`<details>` アコーディオン）のどちらかの形に揃える。**新規ツールページを作るときは最初から可視FAQを置く**

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
| 2026-07-05 | MRIシミュレータ（教育用）実装・公開（`mri-simulator/`）。脳の模式デジタルファントム（各ピクセルに組織ラベル→T1/T2/T2*/PDを割当）に信号方程式を適用し、TE・TR・TI・FA・ノイズを動かすと画像コントラストがリアルタイム変化。SE `PD(1−e^−TR/T1)e^−TE/T2`／IR（TIで反転回復、FLAIR・STIRプリセットはTI≈ln2·T1で算出）／GRE（spoiled、FA・T2*）対応。教育的仕掛けとして①組織別の信号バー②自動重みづけ判定バッジ（T1/T2/PD強調）③A/B並列比較（共有スケール）④Ricianノイズ＋SNR表示。1.5T代表緩和値は教育用近似と明記。ブラウザ完結・外部送信なし。物理サニティ（T1でCSF暗・T2でCSF明・FLAIRでCSF抑制・STIRで脂肪抑制）をプレビューで検証。トップ`.tool-card`先頭・sitemap追加 |
| 2026-07-08 | 造影検査 腎機能チェッカー（eGFR計算・CT/MRI両対応）実装・公開（`egfr-checker/`）。血清Cr・年齢・性別から日本人向けGFR推算式 `194×Cr^−1.094×年齢^−0.287（女性×0.739）` でeGFRを計算し、CKD重症度区分（G1〜G5）をカラーバッジ表示。任意入力の身長・体重からBSA（Mosteller）非補正eGFR（mL/min）も併記。CT/MRIタブ切替で、①造影CT（ヨード）＝ヨード造影剤GL2018の経静脈eGFR<30を高リスク帯として表示＋メトホルミン休薬注意、②造影MRI（Gd）＝ガドリニウム造影剤GL第3版(2024)のeGFR<30回避・30〜60慎重検討を表示＋環状/線状型のNSFリスク解説＋体重×0.1mmol/kgからGd投与量（0.5/1.0mmol/mL製剤別mL）を計算。全判定を「目安」とし出典明記、結果直近に医師判断への免責を配置。患者データ性を踏まえlocalStorage保存なし・外部送信なし。FAQPage構造化データ・SEO対応。contrast-quickと相互リンク。トップ`.tool-card`先頭・更新情報・sitemap追加。数値・閾値はWebSearchで一次情報（日本腎臓学会・日本医学放射線学会GL）を確認して確定 |
| 2026-07-13 | ブログ開設（`blog/`）＋第1回記事「実効径と水等価径の違いとは｜SSDEの使い分けと線量管理の実務」公開（`blog/ssde-guide/`）。狙いは検索流入→ツール誘導とE-E-A-T構築。テンプレート式手書き静的HTML（1記事1ファイル・SSG不使用）、共有スタイル`assets/blog.css`新設。記事はツールページの「SSDEとは」とのカニバリ回避のため一段深い検索意図（Deff/Dwの違い・AAPM 204/220/293・医療法の線量記録義務との関係）を担当。Article/BreadcrumbList/FAQPage構造化データ、可視FAQセクション、著者ボックス・免責・出典（AAPM PDF・厚労省資料は200確認）。ct-dose-estimatorと相互リンク、トップnav「ブログ」・更新情報・sitemap追加。code-reviewer（Fable）レビュー済（CRITICAL/HIGHなし）。以降の記事: 造影剤量の決め方→eGFRと造影検査→MRIコントラスト基礎を月2〜3本で追加予定 |
| 2026-07-15 | ブログ第2回記事「CT造影剤量の決め方｜体重あたりヨード量（mgI/kg）の根拠と検査別の目安」公開（`blog/contrast-dose-guide/`）。狙いは「造影剤 量 決め方／mgI/kg 目安」等の情報収集クエリ→`contrast-quick`ツール誘導。`contrast-quick`ツールページ（計算式・注入プロトコル）とのカニバリ回避のため、記事は一段深い「決め方の根拠」を担当：①体重ベースの物理的理由（血液量∝体重・実質相は総ヨード量依存）②動脈相はIDR（mgI/kg/s）で決まる③検査別目標ヨード量の目安表④体格補正（BSA/除脂肪体重LBW）⑤低管電圧でのヨード減量。数値はWebSearch＋一次情報で確定：肝ダイナミックCT 520〜600mgI/kg・門脈相肝実質+50HU・521mgI/kg（画像診断GL2021消化器）、LBW最適（Awai Radiology 2016）、80kVpで多血性HCC最低300mgI/kg（Goshima AJR 2016）、薬物動態レビュー（Bae Radiology 2010）。Article/BreadcrumbList/FAQPage構造化データ・可視FAQ・著者ボックス・免責・出典。contrast-quickへ相互リンク（📖より詳しい解説）、一覧カード・トップ更新情報・sitemap追加。code-reviewer（Fable）レビュー済 |
| 2026-07-17 | ブログ第3回記事「造影剤と腎機能の基準値はなぜ検査ごとに違うのか｜CT 45・CAG 60・Gd 30の根拠」公開（`blog/egfr-contrast-guide/`）＋**`egfr-checker`のGL2018閾値の誤りを是正**。狙いは「造影剤腎症 エビデンス／PC-AKI CIN 違い／NSF ガドリニウム」等の情報収集クエリ→`egfr-checker`誘導。ツールページとのカニバリ回避のため記事は一段深い「なぜ基準値が検査ごとに違うのか」を担当：①GL2018の基準値＝**造影CT(経静脈・非侵襲的) eGFR<45・推奨グレードB／CAG(経動脈・侵襲的) eGFR<60・グレードA・エビデンスⅠ**（経動脈のほうが"高い"eGFRから注意。希釈前に腎動脈へ流入するため）②CIN（因果前提）→PC-AKI→CA-AKI/CI-AKIという**ACR中心の国際的な**用語整理（GL2018の用語体系ではない旨を明記）③交絡を統制したプロペンシティスコア研究（Obed Eur Radiol 2022：eGFR≧45で有意増加なし・リスク因子は高血圧とeGFR≦30／Davenport Radiology 2020 ACR-NKF：経静脈eGFR≧30でCI-AKIリスク増加なし、真の高リスクはAKIまたは維持透析中でないeGFR<30）④**なぜ日本の45と国際的な30が食い違うのか**＝GL2018発行(2018)がこれら研究より前というタイムラグ。日本の適用規範はGL2018であり国際的議論はGLを個人判断で緩める根拠にならない、と明記⑤NSF発見史（1997最初の症例確認→2000 Lancet初報告→2006頃**線状型**GBCA関連指摘→2007 FDAブラックボックス警告→環状型優先で2008以降減少。線状型/環状型（構造）とイオン性/非イオン性（荷電）は独立軸で、NSFリスクを分けたのはキレート安定性）。出典：GL2018 PDF・Obed 2022・Davenport 2020・Lange 2021・Gd GL第3版2024（全5リンク200確認）。Article/BreadcrumbList/FAQPage構造化データ・可視FAQ・著者ボックス・免責。**⚠️ 初稿でGL2018の経静脈閾値をeGFR<30と誤記（ACR/国際の30と取り違え）。code-reviewer（Fable→529で3回失敗→opusにフォールバック）がGL2018 PDF原文を取得して指摘し発覚。同じ誤りが`egfr-checker`にも公開時(2026-07-08)から存在していたため同時是正**：ctBandの帯を45/60基準に変更（eGFR30〜44を「注意帯・主対象に至らず」→「経静脈・経動脈とも対象帯（グレードB）」risk-mid→risk-highへ引上げ、45〜59を「経動脈投与では対象帯（グレードA）」に）、FAQ構造化データ・解説文も修正。境界値はctBandを抽出しNodeで45/44.9/30/29.9を検証。**教訓：GLの数値はWebSearch要約で確定させずPDF本体のCQ原文を確認する**（詳細は`../content-hub/rt-lab-blog.md`「記事執筆の教訓」）。egfr-checkerへ相互リンク（📖より詳しい解説）、一覧カード・トップ更新情報・sitemap追加 |
| 2026-09-09 | **トップのブログ導線新設＋流入強化（Phase 1・2）**。①トップ `index.html` のツール一覧直後に「最新記事」セクション（`#posts`・記事カード3枚＋記事一覧へ）を新設し、ヒーローにも解説記事への言及と `#posts` サブCTAを追加。従来ブログはnavの1リンクと最下部「更新情報」16行中3行にしか出ておらず、13枚のツールカードの下に埋もれていた。`.post-*` はトップのインライン`<style>`に置き、**`assets/blog.css` は読み込まない**（blog.cssの `*`/`body`/`:root` がトップのインラインCSSより後に来て `--bg`/`--text` を上書きし配色が変わるため。実測で回避を確認）②**OGP画像を新設**：それまで全23ページで `og:image`・`twitter:card` がゼロで、X・noteからの共有が全て文字リンクになっていた。`assets/og/` に1200×630 PNG（共通1枚＋記事3本）を追加し、全23ページに `og:image`／`og:image:width/height`／`og:site_name`／`og:image:alt`／`og:locale`／`twitter:card=summary_large_image`／`twitter:title/description/image/image:alt` を付与。生成は `scripts/generate-og.py`（Chrome headless。記事は `blog/index.html` の `.blog-card` から自動抽出するので記事追加後は再実行するだけ）。`deploy.yml` に `--exclude 'scripts'` を追加③内部リンク補強：記事3本の末尾に`<aside class="blog-related">` で相互リンク、drl-comparison→ssde-guide・contrast-simulator→contrast-dose-guide の逆リンク追加（ツール→記事 3本→5本）、`blog/index.html` の CollectionPage に ItemList、Article に `image` と `author.sameAs`（noteプロフィール）④sitemap は**可視の内容が変わった3URLだけ** lastmod を更新（metaのみの変更で全部動かすと lastmod の信頼性が落ちるため）。code-reviewer（opus）レビュー済：CRITICAL/HIGHなし、MEDIUM6件・LOW8件を修正（特に `.blog-related-desc` が `.blog-article p` に詳細度で負けて margin が効いていない実バグ、generate-og.py の一時ディレクトリ滞留と切り詰めPNGの誤判定）。**⚠️ 併せてブログ自動公開が7週間停止していたことが判明**：scout/writer の SKILL.md は2026-07-22に作られたがスケジュールタスクとして未登録で、8/8・8/22・9/8 の3回とも未実行（fail-closedの失敗PRもゼロ、scoutが必ず追記する台帳のmtimeも07-22で停止）。登録はデスクトップアプリ側で行う必要がある。scout を手動で1回実行しバックログ確定を1→2本に補充（`drl-facility-comparison` を昇格、候補3件追加）。記事追加時のチェックリストを4点→7項目に拡張 |
| 2026-09-09 | **⚠️ drl-comparison / ct-dose-estimator のDRL値が原典と一致していなかったため全面是正**。Search Console分析で「drls2025」が988表示・CTR 0.4%と異常に低い原因を追う過程で発覚。drl-comparison は「Japan DRLs 2025対応」と表示しながら**48値中37値（77%）がDRLs2025と不一致**で、CT成人8件だけが2025の値、他はそれ以前の世代のまま。**小児CTと一般撮影はツール側の値が実際のDRLより高く、DRLを超えている施設が「DRL以下」と判定される向き**だった（小児CT腹部5-<10歳 CTDIvol 10 vs 実際4.5＝2.2倍、一般撮影 腰椎側面 10 vs 5.5）。同じ欠陥が ct-dose-estimator の `DRL_VALUES` にもあり（77/1350等はDRLs2020、1300はDRLs2015の値）、こちらも是正。①MODALITIES を J-RIME報告書から再構築（48→95件。マンモ・歯科・IVRは区分体系と測定量の定義自体が変わっているため再設計）②「比較方法」の記述を是正 — 施設側の代表値は**中央値**で、75パーセンタイルはDRL値を全国調査から設定する際の統計量。従来文言は施設側も75パーセンタイルを使うと読めた③マッチャの `exclude` がソフト減点で機能せず「非CTO PCI」が CTO PCI（DRL 2500）に吸われていた／小児CTの年齢キーワードが部分一致で「0歳」が「10歳」に当たり16区分中10が誤り／`PE` が Pelvis に誤爆 — いずれも**より緩い判定に倒れる**誤りで修正④可視FAQ追加・歯科の対数軸・CSVクォートエスケープ。検証: 全95値を原典テキストと機械照合（OK95/FAIL0）し、行番号と原文を `scripts/drl2025-provenance.json` に保存（99件）。回帰テスト `scripts/test-drl-mapping.js`（428チェック）を追加。**独立レビュー（code-reviewer opus が原典PDFを自分で再取得して全件照合）で数値は全件正しいと確認され、CRITICAL 1件・HIGH 4件の指摘を修正**。教訓: ツールの数値は「対応」と書いてあっても実際に原典と合っているとは限らない。数値を入れたら照合表を成果物として残し、独立レビュアに原典を再取得させる |
| 2026-09-18 | **drl-comparison にDRL値一覧を可視化（検索意図との整合）**。GSCで `drls2025` 単独988表示・4クリック・CTR0.42%（順位10.2）、DRL系クエリ合計1,194表示＝サイト全体の28%。原因は検索意図（DRLの**値**が知りたい）とページ（CSVを上げて比較する）のミスマッチで、95値は `MODALITIES`（JS）の中だけにありHTMLに1つも出ていなかった。①h1直後に「Japan DRLs 2025 の診断参考レベル」カードを新設し、モダリティ別7表・全95値を**可視のHTML**として掲載（モダリティ間ジャンプ・原典PDFリンク・「自施設のデータと比較する→」で `#tool` へ誘導）②title/description/og/twitter/JSON-LD を「一覧」主体に変更（旧: 「DRLs2025比較ツール｜施設線量と診断参考レベルの比較」）③sitemap の drl-comparison のみ lastmod 更新（可視の内容が変わったURLだけ動かす方針を踏襲）。**表は手書きしない**: 95値を手書きでHTMLに複製すると `MODALITIES` と表の2箇所に医療数値のコピーができ、2026-09-09に発覚した事故（drl-comparison と ct-dose-estimator が別々に古い値を持っていた）と同じ構造になる。`scripts/generate-drl-table.js` が `MODALITIES` からマーカー間を生成し（冪等）、`scripts/test-drl-mapping.js` に再生成結果との一致検査を追加（428→431チェック）。ドリフトは文章ではなくテストで止まる。検証: 可視表の値だけを改ざんするとテストが exit 1 で落ちることを確認（fail-closed）、`<` を含むカテゴリ名（`腹部（5-<10歳）`）の `&lt;` エスケープを確認、ローカルサーバで描画確認。**副次効果**: ツール側が「値を知りたい」を担当することで、ブログ記事 `drl-facility-comparison`（代表値の出し方＋超過時の対応）とのカニバリがむしろ減る |
| 2026-09-18 | **流入の詰まりを解消（PR #11の本番反映確認＋Search Console修復＋孤立ページ解消）**。「流入強化」を調べた結果、作るものではなく**届いていないもの**が3つあった。①**PR #11 が9日間未マージで本番未反映**だった（本番HTMLで `og:image` 0件・「最新記事」セクション無しを実測）。DRL値の是正も含まれていたため、本番は誤った値を「Japan DRLs 2025」として表示し続けていた。マージ後に本番実物で検証: 小児CT腹部5-<10歳 `ctdivol: 4.5`／ct-dose-estimator `67/1260`・`11/430`・`14/720`・`13/940`／sitemap全23URLが200・OGP・h1あり／`scripts/`と`CLAUDE.md`は404（deploy除外が効いている）／回帰テスト428 pass 0 fail ②**ブログ3本が3か月ゼロ表示の原因はサイトマップの未読込**だった。GSCの記録は「送信 2026/06/09・**最終読み込み 2026/06/18**・検出16ページ」で、ブログ開設(07-13)より前の版しかGoogleに渡っていなかった。ステータスは「成功」のままなのでGSC上はエラーに見えず3か月気づけなかった。再送信して**検出16→23ページ**に更新。URL検査で確定: `ssde-guide`・`egfr-contrast-guide`・`/blog/` は「検出-インデックス未登録／前回のクロール該当なし」＝**一度もクロールされていない**、`contrast-dose-guide` のみ07/30にクロールされ見送り。4URLともインデックス登録をリクエスト済み ③**`task-based-iq` がサイト内から一度もリンクされていない孤立ページ**だった（sitemapには収載）。トップのツール一覧に研究公開カードを追加し、フッターも新設（静的リンク1→5本）。あわせて `drl-comparison`（表示1,982＝サイトの38%・CTR1.6%）に**他ツールへの導線が一本も無かった**ため関連ツール行とフッターリンクを追加（静的リンク1→7本）。※ `assets/site.js` が全ページに応援バンド（`/`・`/about/`・`/contact/`・`/privacy/`・`/support/`）を注入しているので利用者の導線自体はあった。問題は配信HTMLの静的リンクの薄さと、ツール間導線の不在 ④**未解決**: ブログ自動化 scout/writer は依然未登録。この環境の `list_scheduled_tasks` は0件で登録先 `~/.claude/scheduled-tasks/` も存在せず、既存8本の `~/Documents/Claude/Scheduled/` とはレジストリが別。登録先を誤ると writer が二重に走り記事を二重公開するため、UI側の状態確認待ち |
| 2026-09-23 | **判定専用モデル Jev を「第二意見」に使い、`drl-comparison` のプロトコール名マッピングの誤りを洗い出して修正**（`scripts/jev-drl-oracle.js` 新設）。サイト側の実行時には何も呼ばない（オフラインの開発用ツール。`deploy.yml` が `scripts` を除外）。合成プロトコル名224件（`scripts/fixtures/protocol-names.json`。実施設データは不使用）を、①`drl-comparison/index.html` から**抽出してそのまま実行**した `suggestDrlCategory` と ②Jev の Choice の両方にかけ、食い違いを一覧化。**年齢帯・管電圧帯・FOV の数値判定はコード側で先に確定**させ、矛盾する選択肢を落としてから渡す（Jev は not a calculator。任せると2026-09-09と同じ年齢帯の取り違えを再生産する）。**見つかった誤りのうち危険な向き（より緩い＝高いDRLに倒れる）**: `'単純'` 単独でCT頭部（67/1260）に落ちる（例「尿路結石 単純」＝腹部の線量を頭部DRLと比較し必ず「DRL以下」になる）／`'正面'` 単独で胸部正面に落ちる（「膝関節正面」）／**数値表記のkVを読めず**120kV撮影が100kV未満（0.3 mGy）と判定される／頚椎側面が頚椎正面に吸われる（側面の区分は無い）／腹部大動脈瘤ステントグラフトが `'ステント'` で非CTO PCI（1300）に吸われる（正しくはEVAR 910）／肺動静脈奇形が脳動静脈奇形（3700）に吸われる（正しくはPAVM 870）／収載外のMIBGが `'123I'` でIMP（200MBq）に吸われる。他にも `'CTA'` 単独で大動脈CTA・腎動脈CTAが冠動脈（57/940）に、`'骨盤'` 単独で骨盤の骨条件が上腹部～骨盤1相（14/720）に、低線量肺がん検診CT（CTDIvol 1〜3程度）が胸部1相（11/430）に落ちていた（いずれも必ず「DRL以下」と出る）。**参考ラベル234件での正答率はキーワード判定 83.8%→93.6%**（Jev 95〜96%）。回帰テストを428→**488チェック**に拡張。費用は249件で約$0.013・約10秒。**独立レビュー（code-reviewer opus）でCRITICAL 4件・HIGH 8件**が出て同日中に修正: ①kVの正規表現が `1[0-4][0-9]` で**150kVを取りこぼし**、部位の文脈も要求していなかったため「膝関節正面 80kV」を胸部に吸い「腰椎正面 120kV」を（対象外）に後退させていた→**胸部・検診の文脈を伴うときだけ**kVを読む形に変更 ②`'腹部大動脈'` を手技語なしのキーワードにしたため「腹部大動脈造影」までEVAR（910）に落ちた→複合パターン化 ③**exclude は正規表現でなく素の部分一致**なので `'DAT'` が `sedation` に誤爆し、より高い「安静+負荷（270MBq）」へ落としていた→`'123I'` キーワード自体を削除して解決 ④**keywords は `new RegExp()` を通るため `'安静+負荷'` がリテラルに一致していなかった**（`+` が量指定子）→エスケープし全角＋も追加。**教訓: マッチャは正規表現を `toLowerCase()` してから使うので `\S` `\D` のような大文字クラスは壊れる**（`[\s\S]` が `[\s\s]` になって無言で不一致になった）。**Jevが常に上ではない**: 「RIベノグラフィ 99mTc-MAA」をconf 0.94で肺血流と誤り、PMMA 40mmをconf 0.18で取りこぼした＝**確信度で人に回す設計が要る**（確信度0.95以上の群は正答100%、0.7未満の群は約53%）。**未解決**: 一般撮影の小児は年齢を数値解釈できず「小児胸部 12歳」が小児胸部（5歳）に落ちる（安全側だが誤り・キーワード方式では直せない）。`低線量肺がん検診CT` 等の区分解釈はHiroki判断待ち（詳細は `scripts/README.md`）。アイデア出しの全体像と次の段階（静的デモ／実行時オプトイン）は `~/.claude/plans/system-reminder-you-are-operating-dreamy-puddle.md` |
