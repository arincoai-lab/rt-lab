# おきばメモ（okiba/）— 設計メモ・HANDOFF

ものの置き場所を写真つきで記録して、すぐ探せるスマホ用アプリ（PWA）。
RT-Lab のツールではない独立アプリで、`noindex`・sitemap 非掲載・サイトの解析（`assets/site.js`）なし。

- 公開URL（`main` にマージ後）: https://rt-ai-lab.com/okiba/ → iPhone は Safari の共有 →「ホーム画面に追加」
- このファイルは deploy 対象外（`deploy.yml` の `--exclude '*.md'`）

---

## 1. 何を解決するか（課題 → 設計）

「探し物に時間がかかる」の原因を3つに分け、それぞれに機能を当てた。

| 原因 | 対策（機能） |
|---|---|
| 置いた場所を覚えていない | 写真＋場所の階層（例: リビング › テレビ台 › 左の引き出し）＋詳しい位置で記録。名前・読み・場所名・詳しい位置・貸した相手のどれからでも検索 |
| 定位置が決まっていない／戻さない | 「定位置」を持たせ、外れたものをホームの「定位置に戻していないもの」に出す。「戻した」1タップ |
| 一時置き・貸し出しを忘れる | 「場所を移した」で履歴つきで記録。「貸した（相手）」→ ホームの「貸しているもの」 |

この種のアプリが続かない最大の理由は**記録の手間**（登録が面倒で使わなくなる）。そのため:

- 登録は「名前 → 最近の場所チップ1タップ → 保存」の最短3タップ。写真・詳しい位置は任意
- 新規登録は既定で「定位置にする」をオン（初回の登録は大抵「いつもの場所」のため）
- 音声入力はキーボードのマイクに任せる（Web Speech API は iOS のホーム画面アプリで不安定なため使わない）

探す側の工夫:

- 表記ゆれの吸収: NFKC（全角/半角）・大文字小文字・カタカナ→ひらがな
- 漢字の読み: 辞書が無いと「かぎ」で「鍵」が引けない。**よく探すもの約60語だけ読みの対応表**（`core.js` の `SYNONYM_GROUPS_RAW`）を持ち、それ以外は登録時の「別名・よみ」で補う
- 見つからなかった語は「メモしておく」→ ホームの「探したけど未登録」に残り、見つけたらタップで登録
- 結果を開くたびに「探した回数」を数え、2回以上探したものを「よく探すもの」に出す（定位置化を促す）

## 2. プライバシー（外部に送らない）

- 保存先はその端末のブラウザの IndexedDB だけ。サーバーなし
- `index.html` の CSP で `default-src 'self'; connect-src 'self'; img-src 'self' blob:` — **外部への通信そのものをブラウザが拒否する**（解析タグ・画像ビーコンも不可）。`test-okiba.js` が CSP・外部URL・送信APIの不在を検査
- 写真は保存時に canvas で縮小・再エンコード（長辺1280px・JPEG 0.78、サムネ320px）。**EXIF（GPS・機種名）は残らない**（E2E で GPS 入りの写真を入れて確認）
- 書き出したバックアップ（JSON）には写真と場所が入る。共有先は利用者の判断

## 3. データが消えるリスクと対策（重要）

ブラウザのストレージは「消えない保証」が無い。WebKit は Safari の script-writable storage に7日間の上限を設けた（2020）が、ホーム画面に追加した Web アプリは Safari とは別で、**使った日数で数える**とされている。一方で「ホーム画面アプリでも7日で消えた」という報告も WebKit Bugzilla にある（未確定）。
→ 端末内保存だけに頼らない設計にした:

1. 初回保存時に `navigator.storage.persist()` を要求（許可されるかはブラウザ次第。状態は「データ」画面に表示）
2. 書き出し（バックアップ）の催促: 未書き出しなら変更10件以上か最初の登録から3日、以降は前回から14日か変更30件で、ホームに表示
3. 書き出しは iPhone の共有シート（「ファイルに保存」→ iCloud Drive）かダウンロード。読み込みは「統合（同じidは更新が新しい方）」「置き換え」の2択。読み込み時に検証・修復（不正データ除外、親子の循環を断つ、存在しない参照を外す）
4. Safari のタブとホーム画面アプリで保存領域が分かれることがあるため、「いつも同じ開き方で」と案内

## 4. ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨組み・CSP・PWA の meta |
| `style.css` | スタイル（ライト/ダーク、セーフエリア対応） |
| `core.js` | DOM に依存しない中核ロジック（検索・読み補完・場所ツリー・バックアップ検証/統合・催促条件）。Node でテスト |
| `app.js` | 画面・IndexedDB・写真処理・書き出し/読み込み・Service Worker 登録 |
| `sw.js` | オフライン用キャッシュ。`VERSION` は内容のハッシュ（手で書かない） |
| `manifest.webmanifest`, `icons/` | PWA。アイコンは `scripts/generate-okiba-icons.py` で生成 |

データ（IndexedDB `okiba` v1）: `places`（id, name, parentId, note, photoId）／`items`（id, name, aliases, placeId, detail, homePlaceId, homeDetail, photoId, status=placed|lent, lentTo, lentAt, lastSeenAt, searchCount, foundCount, history[≤30]）／`photos`（id, type, full, thumb は ArrayBuffer）／`meta`（lastBackupAt, changesSinceBackup, misses, persistAsked）。

## 5. 開発の手順

```bash
python3 -m http.server 8080                      # → http://localhost:8080/okiba/
node scripts/test-okiba.js                       # 単体・静的（CI でも実行）
node scripts/okiba-sw-version.js                 # okiba/ のファイルを変えたら必ず実行（CI が --check で検知）
node scripts/e2e-okiba.js http://localhost:8080/okiba/   # 通し試験（Playwright が要る。CI では実行しない）
python3 scripts/generate-okiba-icons.py          # アイコンを作り直すとき
```

- `scripts/test-onpage.js` はサイトのページ検査から `okiba/` を外している（`APP_DIRS`）。外している間は「noindex で sitemap に無いこと」を検査する
- `okiba/` にファイルを足したら `sw.js` の `ASSETS` にも足す（`test-okiba.js` が不一致を検知）

## 6. 検証の記録（2026-10-12）

- `test-okiba.js`: 199 pass。故意に壊した10通り（CSP に https: を足す・fetch 追加・外部URL・VERSION 未更新・ASSETS 漏れ・読み辞書無効化・循環修復の削除・noindex 削除・style 属性・site.js 読み込み）がすべて赤になることを確認
- `e2e-okiba.js`（Chromium・390×844）: 46 pass。登録→読みで検索（かぎ/カギ/ｶｷﾞ/キー/場所名/AND）→ここにあった→移動・定位置外→戻した→貸した→未登録メモ→場所ツリー（削除不可・自分の子孫を親にできない）→書き出し→**オフライン起動**→別コンテキストで置き換え復元（写真含む）→同じファイルの統合で重複しない→別アプリのJSONを拒否。コンソールエラー0・外部への通信0・保存写真に EXIF なし
- 既存テスト（test-onpage 481・test-drl-mapping 488・test-contrast-simulator 481・生成物 --check）はすべて緑

## 7. 既知の限界・未検証

- **iOS Safari の実機では未検証**（この環境に WebKit が無く、検証は Chromium のみ）。使っている API は iOS 15.4 以降を想定（`<dialog>`・`crypto.randomUUID`（無ければ代替）・`Blob.arrayBuffer`・ファイル共有）
- 読みの対応表は約60語のみ。それ以外の漢字名は「別名・よみ」が要る
- 端末間の同期は無い（ファイルで移す）。家族で共有するにはサーバーが要り、「外部に送らない」方針と衝突する
- 写真1枚あたり数十〜200KB程度（実写真の場合の見込み。合成画像の実測は約11KB）

## 8. 次の候補（優先度順・未着手）

1. **実機で1〜2週間使う**（iPhone のホーム画面から）→ 登録の手間・検索の取りこぼしを記録して直す
2. 収納ボックス用 QR ラベル（箱に貼る → 読むと中身一覧）。iOS Safari は BarcodeDetector 非対応のためライブラリ同梱が要る
3. 探すのにかかった時間の計測（「探し中」→「見つかった」）で、削減効果を数字で見る
4. 家族共有（要判断: サーバーを置くか、ファイル受け渡しのままか）

## HANDOFF（最新）

- 2026-10-12: 初版を実装（ブランチ `ccr-4da265af-vyt9nu`、draft PR）。**未決**: ①公開場所（rt-ai-lab.com/okiba/ のままか、別リポジトリ／別ドメインに分けるか）②iPhone 実機での動作確認 ③アプリ名（仮: おきばメモ）
