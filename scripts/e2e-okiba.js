#!/usr/bin/env node
/**
 * おきばメモ（okiba/）の通し試験。スマホ幅（390×844）の Chromium で、実際の操作を順に行う。
 *
 *   python3 -m http.server 8080            # リポジトリのルートで
 *   node scripts/e2e-okiba.js http://localhost:8080/okiba/ [スクリーンショットの保存先]
 *
 * 依存: Playwright（npm i -g playwright 等）。CI では実行しない（test.yml は依存なしのスクリプトだけ）。
 * 見ること: 登録（写真・場所の新規作成）→ 読みで検索 → ここにあった → 移動と定位置 → 貸した →
 *          未登録メモ → 場所ツリー → 書き出し → オフライン起動 → 別端末へ復元（置き換え・統合）。
 *          あわせて、保存した写真から EXIF（GPS）が消えていること、コンソールエラーと外部への通信が無いこと。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.argv[2] || 'http://localhost:8080/okiba/';
const OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'okiba-e2e-'));
const PHOTO = path.join(__dirname, 'fixtures', 'okiba-photo-gps.jpg');
const ORIGIN_HOST = new URL(BASE).host;
let pass = 0, fail = 0;
function check(ok, label) { if (ok) { pass++; } else { fail++; console.log('FAIL:', label); } }

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'ja-JP', acceptDownloads: true, colorScheme: opts.dark ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  const errors = [];
  const foreign = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('request', r => { const u = new URL(r.url()); if (u.host !== ORIGIN_HOST && !u.protocol.startsWith('blob') && !u.protocol.startsWith('data')) foreign.push(r.url()); });
  return { ctx, page, errors, foreign };
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(o <= 0, label + ': 横スクロールが出ている (' + o + 'px)');
}

async function text(page) { return page.evaluate(() => document.body.innerText); }

(async () => {
  const browser = await chromium.launch();
  const { ctx, page, errors, foreign } = await newCtx(browser);
  await page.goto(BASE);
  await page.waitForSelector('#q');
  check((await text(page)).includes('はじめに'), 'オンボーディングが出る');
  await page.screenshot({ path: path.join(OUT, '01-home-empty.png') });
  await noOverflow(page, 'home');

  // ---- 1件目を登録（写真つき・新しい場所をピッカーで作る）----
  await page.click('.tabbar a[data-tab="new"]');
  await page.waitForSelector('#f-name');
  await page.fill('#f-name', '鍵');
  await page.click('[data-act="pick-place"]');
  await page.waitForSelector('#picker[open]');
  await page.click('#picker [data-pick="suggest"][data-name="玄関"]');
  await page.fill('#picker-add input[name="name"]', '靴箱の上');
  await page.click('#picker-add button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#picker-choose').textContent.includes('靴箱の上'));
  check(true, 'ピッカー: 追加した場所に入る');
  await page.screenshot({ path: path.join(OUT, '02-picker.png') });
  await page.click('#picker-choose');
  check((await page.textContent('#place-widget .place-field')).includes('玄関 › 靴箱の上'), '場所がフォームに入る');
  await page.fill('#f-detail', '木のトレイの中');
  await page.fill('#f-aliases', 'キー 家');
  const inputs = await page.$$('input[data-photo-input]');
  await inputs[1].setInputFiles(PHOTO);
  await page.waitForSelector('#photo-widget img.preview[src^="blob:"]');
  await page.screenshot({ path: path.join(OUT, '03-form.png'), fullPage: true });
  await noOverflow(page, 'form');
  await page.click('form[data-form="item"] button[type="submit"]');
  await page.waitForSelector('.where-card');
  let t = await text(page);
  check(t.includes('玄関 › 靴箱の上') && t.includes('木のトレイの中'), '詳細: 場所と詳しい位置');
  check(t.includes('ここが定位置です'), '詳細: 新規は定位置になる');
  await page.waitForFunction(() => { const i = document.querySelector('.photo-wrap img'); return i && i.complete && i.naturalWidth > 0; });
  const dims = await page.evaluate(() => { const i = document.querySelector('.photo-wrap img'); return [i.naturalWidth, i.naturalHeight]; });
  check(dims[0] === 1280 && dims[1] === 800, '写真は長辺1280に縮小 (' + dims + ')');
  await page.screenshot({ path: path.join(OUT, '04-detail.png'), fullPage: true });

  // 保存された写真から EXIF（GPS）が消えていること
  const exif = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('okiba'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise(res => { const r = db.transaction('photos').objectStore('photos').getAll(); r.onsuccess = () => res(r.result); });
    const bytes = new Uint8Array(all[0].full);
    const s = Array.from(bytes.subarray(0, 4096)).map(b => String.fromCharCode(b)).join('');
    return { n: all.length, exif: s.includes('Exif'), maker: s.includes('TestMaker'), soi: bytes[0] === 0xff && bytes[1] === 0xd8, size: bytes.length, thumb: all[0].thumb.byteLength };
  });
  check(exif.n === 1 && exif.soi, '写真がJPEGで1枚保存');
  check(!exif.exif && !exif.maker, '保存した写真に EXIF（GPS・メーカー名）が残っていない');
  console.log('photo bytes', exif.size, 'thumb', exif.thumb);

  // ---- 検索（読み・カタカナ・場所名）----
  await page.click('.tabbar a[data-tab="home"]');
  for (const q of ['かぎ', 'カギ', 'ｶｷﾞ', 'キー', '靴箱', '玄関 トレイ']) {
    await page.fill('#q', q);
    t = await text(page);
    check(t.includes('見つかったもの（1）'), '検索「' + q + '」で鍵が出る');
  }
  await page.fill('#q', 'かぎ');
  await page.screenshot({ path: path.join(OUT, '05-search.png') });
  await page.click('[data-act="open-result"]');
  await page.waitForSelector('.where-card');
  t = await text(page);
  check(t.includes('探した回数 1'), '結果から開くと探した回数が増える');

  // ---- ここにあった ----
  await page.click('[data-act="found"]');
  await page.waitForFunction(() => document.body.innerText.includes('「ここにあった」の回数 1'));
  check((await text(page)).includes('ここにあった: 玄関 › 靴箱の上'), '履歴に「ここにあった」');

  // ---- 移動 → 定位置外 → 戻した ----
  await page.click('a[href^="#/move/"]');
  await page.waitForSelector('form[data-form="move"]');
  await page.click('[data-act="pick-place"]');
  await page.click('#picker [data-pick="open"][data-id=""]').catch(() => {});
  await page.click('#picker [data-pick="suggest"][data-name="リビング"]');
  await page.click('#picker-choose');
  await page.fill('#m-detail', 'ソファの上');
  await page.click('form[data-form="move"] button[type="submit"]');
  await page.waitForSelector('.where-card');
  t = await text(page);
  check(t.includes('リビング') && t.includes('ソファの上') && t.includes('定位置に戻した'), '移動後: 定位置外の表示');
  await page.click('.tabbar a[data-tab="home"]');
  await page.fill('#q', '');
  await page.dispatchEvent('#q', 'input');
  t = await text(page);
  check(t.includes('定位置に戻していないもの'), 'ホーム: 定位置に戻していないもの');
  await page.screenshot({ path: path.join(OUT, '06-home-misplaced.png'), fullPage: true });
  await page.click('#home-body [data-act="return-home"]');
  await page.waitForFunction(() => !document.body.innerText.includes('定位置に戻していないもの'));
  check(true, '戻したで一覧から消える');

  // ---- 2件目: 貸した ----
  await page.click('.tabbar a[data-tab="new"]');
  await page.fill('#f-name', '放射線技術学の本');
  await page.click('[data-act="choose-recent"]');
  await page.click('form[data-form="item"] button[type="submit"]');
  await page.waitForSelector('.where-card');
  await page.click('[data-act="lend-toggle"]');
  await page.fill('#lend-to', '田中さん');
  await page.click('form[data-form="lend"] button[type="submit"]');
  await page.waitForFunction(() => document.body.innerText.includes('返ってきた'));
  await page.click('.tabbar a[data-tab="home"]');
  t = await text(page);
  check(t.includes('貸しているもの') && t.includes('田中さん に貸している'), 'ホーム: 貸しているもの');
  await page.fill('#q', '田中');
  check((await text(page)).includes('放射線技術学の本'), '貸した相手の名前で検索できる');

  // ---- 見つからない → メモ ----
  await page.fill('#q', '爪切り');
  t = await text(page);
  check(t.includes('まだ登録されていません'), '未登録の表示');
  await page.click('[data-act="miss-add"]');
  t = await text(page);
  check(t.includes('探したけど未登録') && t.includes('爪切り'), 'メモが残る');
  await page.click('.chip a[href*="miss=1"]');
  await page.waitForSelector('#f-name');
  check((await page.inputValue('#f-name')) === '爪切り', 'メモから登録で名前が入る');
  await page.click('[data-act="choose-recent"]');
  await page.click('form[data-form="item"] button[type="submit"]');
  await page.waitForSelector('.where-card');
  await page.click('.tabbar a[data-tab="home"]');
  check(!(await text(page)).includes('探したけど未登録'), '登録するとメモが消える');

  // ---- 場所タブ ----
  await page.click('.tabbar a[data-tab="places"]');
  await page.waitForSelector('.crumbs');
  t = await text(page);
  check(t.includes('玄関') && t.includes('リビング'), '場所一覧');
  await page.click('a.entry[href^="#/places/"]:has-text("玄関")');
  await page.waitForFunction(() => document.querySelector('#title').textContent === '玄関');
  check((await text(page)).includes('靴箱の上'), '子の場所');
  await page.screenshot({ path: path.join(OUT, '07-places.png'), fullPage: true });
  // 中にものがある場所は削除できない
  await page.click('a.entry[href^="#/places/"]:has-text("靴箱の上")');
  await page.click('a[href^="#/place-edit/"]');
  check((await text(page)).includes('削除できません'), '中にものがある場所は削除不可');
  // 自分の子孫を親に選べない
  await page.click('[data-act="pick-parent"]');
  check(!(await page.$('#picker [data-pick="open"][data-id] >> text=靴箱の上')), 'ピッカー: 自分自身は選べない');
  await page.click('#picker [data-pick="close"]');

  // ---- 戻るボタン ----
  await page.click('[data-act="back"]');
  check((await page.textContent('#title')) === '靴箱の上', '戻るで1つ前へ');

  // ---- データ: 書き出し ----
  await page.click('.tabbar a[data-tab="data"]');
  await page.waitForSelector('[data-act="export-prepare"]');
  await page.screenshot({ path: path.join(OUT, '08-data.png'), fullPage: true });
  await noOverflow(page, 'data');
  await page.click('[data-act="export-prepare"]');
  await page.waitForSelector('[data-act="export-download"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="export-download"]')]);
  const backupPath = path.join(OUT, 'backup.json');
  await dl.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  check(backup.app === 'okiba' && backup.items.length === 3 && backup.places.length === 3 && backup.photos.length === 1, 'バックアップの中身 (' + backup.items.length + '/' + backup.places.length + '/' + backup.photos.length + ')');
  check(/^okiba-backup-\d{8}-\d{4}\.json$/.test(dl.suggestedFilename()), 'ファイル名');
  await page.click('.tabbar a[data-tab="home"]');
  check(!(await text(page)).includes('バックアップをおすすめします'), '書き出し後はバックアップ催促が消える');

  // ---- オフライン起動（Service Worker）----
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  check(controlled, 'Service Worker が制御している');
  await ctx.setOffline(true);
  await page.goto(BASE + '#/');
  await page.waitForSelector('#q');
  check((await text(page)).includes('最近置いたもの'), 'オフラインでも起動してデータが見える');
  await ctx.setOffline(false);

  check(errors.length === 0, 'コンソールエラー無し: ' + errors.join(' | '));
  check(foreign.length === 0, '外部への通信無し: ' + foreign.join(' | '));

  // ---- 別の端末（新しいコンテキスト）に置き換えで復元 ----
  const b = await newCtx(browser, { dark: true });
  await b.page.goto(BASE + '#/data');
  await b.page.waitForSelector('[data-import-input]');
  await b.page.setInputFiles('[data-import-input]', backupPath);
  await b.page.waitForSelector('[data-act="import-replace"]');
  check((await text(b.page)).includes('もの 3件・場所 3件・写真 1枚'), '読み込みプレビュー');
  b.page.once('dialog', d => d.accept());
  await b.page.click('[data-act="import-replace"]');
  await b.page.waitForSelector('#q');
  await b.page.fill('#q', 'かぎ');
  await b.page.click('[data-act="open-result"]');
  await b.page.waitForFunction(() => { const i = document.querySelector('.photo-wrap img'); return i && i.complete && i.naturalWidth === 1280; });
  check(true, '復元: 写真も表示できる');
  await b.page.screenshot({ path: path.join(OUT, '09-detail-dark.png'), fullPage: true });
  // 統合: 同じファイルをもう一度統合しても増えない
  await b.page.goto(BASE + '#/data');
  await b.page.waitForSelector('[data-import-input]');
  await b.page.setInputFiles('[data-import-input]', backupPath);
  await b.page.click('[data-act="import-merge"]');
  await b.page.waitForSelector('#q');
  const counts = await b.page.evaluate(async () => {
    const db = await new Promise(res => { const r = indexedDB.open('okiba'); r.onsuccess = () => res(r.result); });
    const c = s => new Promise(res => { const r = db.transaction(s).objectStore(s).count(); r.onsuccess = () => res(r.result); });
    return [await c('items'), await c('places'), await c('photos')];
  });
  check(counts.join() === '3,3,1', '同じファイルの統合で重複しない (' + counts + ')');
  // 別アプリのJSONは拒否
  const bogus = path.join(OUT, 'bogus.json');
  fs.writeFileSync(bogus, JSON.stringify({ app: 'other', items: [] }));
  await b.page.goto(BASE + '#/data');
  await b.page.waitForSelector('[data-import-input]');
  await b.page.setInputFiles('[data-import-input]', bogus);
  await b.page.waitForFunction(() => document.body.innerText.includes('おきばメモのバックアップファイルではありません'));
  check(true, '別アプリのファイルを拒否');
  await b.page.screenshot({ path: path.join(OUT, '10-data-dark.png'), fullPage: true });
  check(b.errors.length === 0, '(端末B) コンソールエラー無し: ' + b.errors.join(' | '));
  check(b.foreign.length === 0, '(端末B) 外部への通信無し');

  await browser.close();
  console.log('E2E: ' + pass + ' pass / ' + fail + ' fail（スクリーンショット: ' + OUT + '）');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
