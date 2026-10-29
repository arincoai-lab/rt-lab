# RT-Lab プロジェクト

放射線技師（RT）が業務で役立つWebツールを無料・ブラウザ完結で提供するサイト。

> **正典は [`CLAUDE.md`](./CLAUDE.md)。** ツール進捗・ディレクトリ構造・作業ログの詳細はそちらを参照。
> このファイルはコアな前提のみを保持し、内容が食い違う場合は `CLAUDE.md` を優先する。

**オーナー:** Hiroki
**本番URL:** https://rt-ai-lab.com/ （GitHub Pages / `main` へのpushで自動デプロイ）
**リポジトリ:** https://github.com/arincoai-lab/rt-lab
**ローカル確認:** `python3 -m http.server 8080` → http://localhost:8080

---

## 構成方針（重要）

- **純粋な静的HTMLサイト**。ビルド不要、各ツールは自己完結型の `index.html`。
- リポジトリのルートがそのまま本番。`.github/workflows/deploy.yml` が公開対象を絞り込んでアップロードする（`CLAUDE.md`・`AGENTS.md`・`test-data/`・`.claude/` 等は非公開）。
- 共有アセットは `assets/site.{css,js}`。外部CDN（Chart.js / PapaParse）は SRI 付きで読み込む。
- Next.js版は未デプロイの死蔵コードだったため 2026-07-03 に撤去済み。

---

## サイトコンセプト

- インストール不要（ブラウザで完結）
- データ外部送信なし（プライバシー重視）
- 無料・広告なし

---

## エージェント向けメモ

- 新ツールは `<tool>/index.html` として追加し、トップ `index.html` の `#tools` グリッドと `sitemap.xml` に登録する。
- 医療計算を含むため、各ツールに免責（診断用途外・参考値）を明示する。
- 変更は原則ブランチを切って作業し、`main` への直接pushは避ける（PR推奨）。
