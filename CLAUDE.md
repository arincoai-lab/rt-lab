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
  6. 誘導先ツールページに「📖 より詳しい解説」の逆リンクを追加（**PR記事＝アフィリエイトリンクを含む記事は例外で、ツールページから逆リンクを張らない**。「ツールのページに広告はありません」の表示と矛盾するため）
  7. `sitemap.xml` に新記事の `<url>` を追加。**既存URLの `lastmod` は可視の内容が変わったときだけ動かす**（metaだけの変更で更新すると lastmod の信頼性が落ちる）。記事を足すと一覧の中身も変わるので、**`/blog/` の `lastmod` も新記事の日付にする**（古いままだと `test-onpage.js` が落ちる）
- トップ（`index.html`）は `assets/blog.css` を読み込まない。blog.css は `*` リセット・`body`・`:root`（`--bg`/`--text`）をグローバルに定義しており、トップのインライン`<style>`より後に来ると配色が変わる。`.post-*` のスタイルはトップのインライン`<style>`側にある。
- **favicon と 404 ページ**: 全ページの `<head>` に favicon の `<link>` 3行（`/favicon.ico`・`/assets/icon-192.png`・`/apple-touch-icon.png`）を置く。新しいページを作るときは既存ページからコピーする（`/rousui/` は生成物なので例外）。画像は `python3 scripts/generate-favicon.py` で作り直せる。`404.html`（ルート直下・noindex・リンクは `/` 始まりだけ）は GitHub Pages が存在しないURLに返すページで、**ツールを足したら 404.html のツール一覧にも1行足す**。どちらも抜けると `test-onpage.js` が落ちる。
- 外部CDN（Chart.js / PapaParse）は SRI（`integrity` + `crossorigin`）付きで読み込む。
- **ツールページの「関連ツール」ブロック**（`.rt-related`）は `scripts/generate-related.js` が `</main>` 直前に生成する。手で編集しない。ツールを足したら `TOOLS` / `RELATED` に追記して再生成する（関連は1ページ2〜3本・被リンク3本以上。研究公開の subtraction-demo のみ2本）。孤立・被リンク不足・ツールの登録漏れ・生成物のドリフトは `node scripts/test-onpage.js` が検知する。PR と main への push で `.github/workflows/test.yml`（Tests）が `test-onpage` / `test-drl-mapping` / `test-contrast-simulator` / 各生成スクリプトの `--check` を実行する。**失敗してもデプロイは止まらない（検知のみ）ので、ページを足す・リンクを変えたらコミット前にも手で実行し、PR の Tests が緑なのを確かめてからマージする。**
- **可視FAQ**: FAQPage の JSON-LD を唯一の正とし、`scripts/generate-faq.js` がトップと6ツールページに可視ブロック（`.rt-faq`）を生成する（文面は JSON-LD のまま。JSON-LD を直したら再生成）。`drl-comparison`・`mri-simulator`・ブログ記事は手書きの可視FAQを持ち、`test-onpage.js` が「JSON-LD の質問と回答が可視テキストにある」ことを検査する。構造化データだけ先行させない
- ~~Next.js版~~ は未デプロイの死蔵コードだったため 2026-07-03 に撤去済み（履歴参照）。

---

## サイトコンセプト

- インストール不要（ブラウザで完結）
- データ外部送信なし（プライバシー重視）
- 無料・広告なし（**解説記事に PR リンク＝アフィリエイト広告を載せるときのルール**: その記事の冒頭に `.blog-pr-disclosure`、広告リンクは `.blog-pr-box` の中だけ。あわせてフッター・トップ・About・応援ページの「広告なし」を「ツールは無料・広告なし。一部の解説記事に PR リンクを含みます」に直す。`test-onpage.js` が検査し、公開前の仮置き `【★…】` と未設定の sponsored リンクも検知する。2026-10-29 時点で PR リンクを載せた記事はない。戻し方はブランチ `claude/affiliate-pr-box`）

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
| 散乱線シミュレータ（教育用） | ✅ 公開中 | `scatter-simulator/index.html`（計算は `scatter-core.js`、係数の照合表は `scripts/scatter-provenance.json`） |
| 造影検査 腎機能チェッカー（eGFR/CT・MRI） | ✅ 公開中 | `egfr-checker/index.html` |
| Task-based IQ評価ツール | 🔬 研究公開 | `task-based-iq/index.html` |
| Subtractionツール（脳CT/MRI差分）デモ | 🔬 研究公開 | `subtraction-demo/index.html`（サンプルは `samples/`） |
| MRI QA/QC自動計測ツール | 📋 計画中 | 未作成 |
| 各モダリティ 計測・QAQCツール | 📋 計画中 | 未作成 |
| CT臓器線量推定ツール | 📋 計画中 | 未作成 |

**おまけ（余興・業務ツールとは別枠）**: 1.2億分の1.2億 〜無事に老衰できるか〜（人生シミュレーション）— `rousui/index.html`（生成物。原本は `~/rt-lab/disease-life-sim`、`SITE_URL=https://rt-ai-lab.com/rousui/ OUTHTML=../release/index.html node prototype/build.mjs` で作り `release/` の2ファイルをコピー）。トップでは「ツール一覧」ではなく `#games`「おまけ：遊べるシミュレーション」に置く
- 息を吸って止めてください！胸部X線写真の匠（検診の胸部X線のポジショニングゲーム・日英）— `chest-xray-master/index.html`（採点は `chest-core.js`、採点基準と EUR 16260 の照合表は `scripts/chest-xray-provenance.json`、テストは `scripts/test-chest-xray.js`、共有用画像は `scripts/og-chest-xray.html` で作る）。`#games` に置き、`test-onpage.js` の `NON_TOOL` に入れて関連リンク網からは外す

---

## 既知の課題

- （解消 2026-10-03）FAQPage構造化データと可視コンテンツの不一致（トップ・`contrast-quick` / `ct-dose-estimator` / `egfr-checker` / `exposure-reference` / `mtf-calculator` / `nps-calculator` / `mri-simulator`）は、`scripts/generate-faq.js`（JSON-LD から可視ブロックを生成）と `mri-simulator` の手書き `<details>` の整合で解消した。再発は `node scripts/test-onpage.js` が検知する。**新規ツールページは FAQPage の JSON-LD を書き、`generate-faq.js` の `PAGES` に足して再生成する**（可視FAQは自動で付く）
- **「対応している画像形式」まわりで未決の既存の食い違い（要判断）**: ①（解消 2026-11-16）`nps-calculator` の `accept` から `image/png` を削除 ②`mtf-calculator` は TIFF 対応をうたう（meta description・og/twitter description・WebApplication JSON-LD・本文の紹介文・ドロップ領域の表示・`accept`・`.upload-hint`・エラーメッセージ・トップのFAQ）が、TIFF は `new Image()` で読むため Chromium（Chrome 154 で再現）では読み込めない。Safari は未検証。記載を外すか、デコーダを足して記載を真にするか

---

## 作業ログ

過去の作業の経緯は `.claude/worklog.md` にある（毎回は読み込まない。経緯・数値の由来が要るときに読む）。作業の区切りには、そちらに1行追記する。

作業ログから残す教訓:

- ガイドライン・DRL の数値は WebSearch の要約で確定させない。原典 PDF の原文と照合し、照合表を成果物に残し、独立レビューに原典を再取得させる（eGFR・DRL で2回事故）。
- `drl-comparison` のマッチャは keywords を `toLowerCase()` してから `new RegExp()` に通す（`\S` `\D` は壊れる。`+` などはエスケープが要る）。exclude は正規表現でなく素の部分一致。
- Search Console のサイトマップは「成功」表示でも再読込されていないことがある。最終読み込み日時と検出ページ数を見る。
