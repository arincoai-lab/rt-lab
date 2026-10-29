#!/usr/bin/env node
/**
 * おきばメモ（okiba/）の回帰テスト。依存なし。
 *
 *   node scripts/test-okiba.js
 *
 * 1. core.js（検索・読みの補完・場所ツリー・バックアップの検証/統合・日付表示・催促の条件）
 * 2. 「外部に送信しない」の担保: CSP（connect-src 'self'）・外部URL・インラインスクリプト/スタイルが無いこと、
 *    サイトの解析スクリプト（assets/site.js）を読み込まないこと
 * 3. PWA: manifest・アイコンの実寸・Service Worker のキャッシュ対象とファイルの一致・VERSION が内容と一致
 * 4. サイトとの境界: noindex で、sitemap に載せないこと
 *
 * ブラウザでの通し試験（登録→検索→移動→書き出し→別端末で復元→オフライン起動）は
 * scripts/e2e-okiba.js（Playwright が要る。CI では実行しない）。
 */
const fs = require('fs');
const path = require('path');
const C = require('../okiba/core.js');
const swVersion = require('./okiba-sw-version.js');

const ROOT = path.dirname(__dirname);
const DIR = path.join(ROOT, 'okiba');
let pass = 0, fail = 0;
function check(ok, label) { if (ok) pass++; else { fail++; console.log('FAIL: ' + label); } }
function eq(a, b, label) { check(JSON.stringify(a) === JSON.stringify(b), label + ' — 期待 ' + JSON.stringify(b) + ' / 実際 ' + JSON.stringify(a)); }

// ---------------------------------------------------------------------------
// 1. core.js
// ---------------------------------------------------------------------------
eq(C.normalize('カギ'), 'かぎ', 'normalize: カタカナ→ひらがな');
eq(C.normalize('ｶｷﾞ'), 'かぎ', 'normalize: 半角カナ');
eq(C.normalize('ＵＳＢメモリ'), 'usbめもり', 'normalize: 全角英字・大文字');
eq(C.normalize('  玄関　 トレイ '), '玄関 とれい', 'normalize: 空白（全角含む）');
eq(C.normalize(null), '', 'normalize: null');
eq(C.tokenize('玄関　トレイ、鍵'), ['玄関', 'とれい', '鍵'], 'tokenize: 全角空白・読点で区切る');

check(C.expandToken('かぎ').includes('鍵'), 'expandToken: かぎ → 鍵');
check(C.expandToken('鍵').includes('かぎ'), 'expandToken: 鍵 → かぎ');
check(C.expandToken('めが').includes('眼鏡'), 'expandToken: 2文字以上は読みの前方一致で補う');
check(!C.expandToken('め').includes('眼鏡'), 'expandToken: 1文字では補わない（候補が広がりすぎる）');
eq(C.expandToken('ぞうきん'), ['ぞうきん'], 'expandToken: 辞書に無い語はそのまま');
for (const g of C.SYNONYM_GROUPS) check(g.every(m => m === C.normalize(m) && m.length > 0), '読みの辞書は正規化済み: ' + g.join(','));

// 場所ツリー: 玄関 > 靴箱の上 / リビング > テレビ台 > 左の引き出し
const T0 = new Date(2026, 9, 1, 9, 0).getTime();
const P = (id, name, parentId, createdAt) => ({ id, name, parentId: parentId || null, note: '', photoId: null, createdAt: createdAt || T0, updatedAt: T0 });
const places = [P('g', '玄関'), P('gk', '靴箱の上', 'g'), P('l', 'リビング'), P('lt', 'テレビ台', 'l'), P('ltd', '左の引き出し', 'lt')];
const byId = C.indexById(places);
eq(C.placePathText(byId, 'ltd'), 'リビング › テレビ台 › 左の引き出し', 'placePathText');
eq(C.placePathText(byId, null), '', 'placePathText: null');
eq([...C.descendantIds(places, 'l')].sort(), ['l', 'lt', 'ltd'], 'descendantIds');
check(C.wouldCreateCycle(byId, 'l', 'ltd'), 'wouldCreateCycle: 自分の子孫の下には入れない');
check(C.wouldCreateCycle(byId, 'l', 'l'), 'wouldCreateCycle: 自分自身');
check(!C.wouldCreateCycle(byId, 'lt', 'g'), 'wouldCreateCycle: 別の枝へは移せる');
check(!C.wouldCreateCycle(byId, 'lt', null), 'wouldCreateCycle: 最上位へは移せる');
eq(C.childrenOf(places, null).map(p => p.name), ['玄関', 'リビング'].sort((a, b) => a.localeCompare(b, 'ja')), 'childrenOf: 最上位');
// 循環したデータでも止まる
const cyc = [P('a', 'A', 'b'), P('b', 'B', 'a')];
eq(C.placePath(C.indexById(cyc), 'a').map(p => p.id), ['b', 'a'], 'placePath: 循環していても止まる');
eq([...C.descendantIds(cyc, 'a')].sort(), ['a', 'b'], 'descendantIds: 循環していても止まる');

const I = (o) => C.sanitizeItem(Object.assign({ id: 'x', name: 'x', createdAt: T0, updatedAt: T0, history: [] }, o), T0);
const items = [
  I({ id: 'k', name: '鍵', placeId: 'gk', detail: '木のトレイの中', homePlaceId: 'gk' }),
  I({ id: 'ck', name: '車の鍵', placeId: 'ltd', aliases: 'くるま', homePlaceId: 'gk', updatedAt: T0 + 5 }),
  I({ id: 'm', name: '眼鏡ケース', placeId: 'lt' }),
  I({ id: 'b', name: '技術書', placeId: 'ltd', status: 'lent', lentTo: '田中さん' }),
  I({ id: 'r', name: 'リモコン', placeId: 'lt', detail: '鍵のかかる引き出し' }),
];
const names = q => C.searchItems(items, places, q).map(r => r.item.id);
eq(names('かぎ'), ['k', 'ck', 'r'], 'search: 読みで漢字の名前が見つかる（完全一致＞部分一致＞詳しい位置）');
eq(names('カギ'), names('かぎ'), 'search: カタカナでも同じ');
eq(names('玄関 トレイ'), ['k'], 'search: 複数語はAND（場所名＋詳しい位置）');
eq(names('引き出し'), ['r', 'ck', 'b'], 'search: 詳しい位置（30）＞場所名（25）、同点は更新が新しい順');
eq(names('田中'), ['b'], 'search: 貸した相手で探せる');
eq(names('くるま'), ['ck'], 'search: 別名・よみ');
eq(names('めがね'), ['m'], 'search: 読み→眼鏡（前方一致）');
eq(names(''), [], 'search: 空');
eq(names('ぞうきん'), [], 'search: 見つからない');
const notLent = items.map(i => (i.id === 'b' ? I({ id: 'b', name: '技術書', placeId: 'ltd', lentTo: '田中さん' }) : i));
eq(C.searchItems(notLent, places, '田中').length, 0, 'search: 貸していないなら lentTo は使わない（sanitize で消える）');
const withCount = items.map(i => (i.id === 'ck' ? Object.assign({}, i, { searchCount: 10 }) : i));
eq(C.searchItems(withCount, places, 'かぎ')[0].item.id, 'k', 'search: よく探す回数より名前の一致が優先');
eq(C.searchPlaces(places, '玄関').map(r => r.place.id), ['g', 'gk'], 'searchPlaces: 名前＞親の名前');
eq(C.searchPlaces(places, 'くつばこ').length, 0, 'searchPlaces: 辞書に無い読みは見つからない（既知の限界）');

check(C.isMisplaced(items[1]), 'isMisplaced: 定位置と違う');
check(!C.isMisplaced(items[0]), 'isMisplaced: 定位置にある');
check(!C.isMisplaced(I({ placeId: 'g' })), 'isMisplaced: 定位置なし');
check(!C.isMisplaced(I({ placeId: 'g', homePlaceId: 'gk', status: 'lent' })), 'isMisplaced: 貸出中は対象外');

const recentItems = [I({ id: 'a', placeId: 'g', updatedAt: T0 + 10, history: [{ at: T0 + 10, kind: 'moved', placeId: 'g' }, { at: T0 + 1, kind: 'created', placeId: 'ltd' }] })];
eq(C.recentPlaceIds(recentItems, places, 3), ['g', 'ltd', 'gk'], 'recentPlaceIds: 使った順、足りない分は場所の作成順');
eq(C.recentPlaceIds([I({ placeId: 'deleted', history: [{ at: T0 + 99, kind: 'moved', placeId: 'deleted' }] })], places, 2).includes('deleted'), false, 'recentPlaceIds: 消えた場所は除く');

let h = [];
for (let i = 0; i < 40; i++) h = C.pushHistory(h, { at: i, kind: 'found' });
check(h.length === C.HISTORY_CAP && h[0].at === 39, 'pushHistory: 新しい順・上限30件');

const day = (d, hh, mm) => new Date(2026, 9, d, hh || 12, mm || 0).getTime();
eq(C.relativeTime(day(10, 0, 1), day(10, 23, 59)), '今日', 'relativeTime: 同じ日');
eq(C.relativeTime(day(9, 23, 59), day(10, 0, 1)), '昨日', 'relativeTime: 日付が変わったら昨日');
eq(C.relativeTime(day(4), day(10)), '6日前', 'relativeTime: 6日前');
eq(C.relativeTime(day(3), day(10)), '1週間前', 'relativeTime: 7日→1週間前');
eq(C.relativeTime(day(10) - 29 * C.DAY, day(10)), '4週間前', 'relativeTime: 29日');
eq(C.relativeTime(day(10) - 30 * C.DAY, day(10)), '1か月前', 'relativeTime: 30日');
eq(C.relativeTime(day(10) - 400 * C.DAY, day(10)), '1年以上前', 'relativeTime: 1年以上');
eq(C.relativeTime(null, day(10)), '—', 'relativeTime: 未確認');
eq(C.relativeTime(day(11), day(10)), '今日', 'relativeTime: 未来（時計のずれ）は今日');

const NOW = day(20);
const rem = (meta, n, oldest) => C.backupReminder(meta, n, NOW, oldest).show;
eq(rem({ changesSinceBackup: 5 }, 0, NOW), false, 'backupReminder: ものが無ければ促さない');
eq(rem({ changesSinceBackup: 0, lastBackupAt: null }, 3, NOW - 9 * C.DAY), false, 'backupReminder: 変更が無ければ促さない');
eq(rem({ changesSinceBackup: 9 }, 3, NOW - C.DAY), false, 'backupReminder: 使い始め（変更9件・1日目）は促さない');
eq(rem({ changesSinceBackup: 10 }, 3, NOW - C.DAY), true, 'backupReminder: 未書き出しで変更10件');
eq(rem({ changesSinceBackup: 1 }, 1, NOW - 3 * C.DAY), true, 'backupReminder: 未書き出しで最初の登録から3日');
eq(rem({ changesSinceBackup: 5, lastBackupAt: NOW - 13 * C.DAY }, 3, 0), false, 'backupReminder: 前回から13日');
eq(rem({ changesSinceBackup: 5, lastBackupAt: NOW - 14 * C.DAY }, 3, 0), true, 'backupReminder: 前回から14日');
eq(rem({ changesSinceBackup: 30, lastBackupAt: NOW - C.DAY }, 3, 0), true, 'backupReminder: 変更30件');

let misses = C.addMiss([], 'カギ', 1);
misses = C.addMiss(misses, '爪切り', 2);
misses = C.addMiss(misses, 'かぎ', 3);
eq(misses.map(m => [m.q, m.count]), [['かぎ', 2], ['爪切り', 1]], 'addMiss: 表記ゆれは同じ語として数え、先頭へ');
eq(C.removeMiss(misses, 'カギ').map(m => m.q), ['爪切り'], 'removeMiss: 表記ゆれでも消える');
let many = [];
for (let i = 0; i < 25; i++) many = C.addMiss(many, 'q' + i, i);
eq(many.length, C.MISSES_CAP, 'addMiss: 上限');
eq(C.addMiss([], '   ', 1), [], 'addMiss: 空は記録しない');

// ---- バックアップ ----
const fatal = o => C.validateBackup(o, T0).fatal || null;
check(!!fatal(null), 'validate: null は拒否');
check(!!fatal([]), 'validate: 配列は拒否');
check(!!fatal({ app: 'other', version: 1 }), 'validate: 別アプリは拒否');
check(!!fatal({ app: 'okiba' }), 'validate: 版が無いものは拒否');
check(/新しい版/.test(fatal({ app: 'okiba', version: C.BACKUP_VERSION + 1 })), 'validate: 新しすぎる版は拒否');

const b64 = C.bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
const raw = {
  app: 'okiba', version: 1,
  places: [P('g', '玄関'), P('gk', '靴箱の上', 'g'), P('orphan', '親なし', 'nope'), P('a', 'A', 'b'), P('b', 'B', 'a'), P('g', '重複'), { id: '', name: 'x' }, 'junk',
    Object.assign(P('long', 'あ'.repeat(500)), {})],
  items: [
    { id: 'k', name: '鍵', placeId: 'gk', homePlaceId: 'missing', homeDetail: '古い', photoId: 'ph1', status: 'weird', lentTo: '消える', history: [{ at: 1, kind: 'created', placeId: 'gk' }, { at: 2, kind: 'hack' }, { at: 3, kind: 'moved', placeId: 'missing' }] },
    { id: 'n', name: '  ', placeId: 'g' },
    { id: 'p', name: '写真なし', photoId: 'gone', placeId: 'nowhere' },
    { id: 'l', name: '本', status: 'lent', lentTo: '田中さん', lentAt: 5 },
  ],
  photos: [{ id: 'ph1', type: 'image/jpeg', full: b64, thumb: b64 }, { id: 'bad', type: 'image/jpeg', full: '<script>' }, { id: 'svg', type: 'image/svg+xml', full: b64 }],
  misses: [{ q: '爪切り', at: 1, count: 2 }, { q: '' }, 'x'],
};
const v = C.validateBackup(raw, T0);
check(!v.fatal, 'validate: 修復できるデータは受け入れる');
const vp = C.indexById(v.data.places);
eq(v.data.places.map(p => p.id), ['g', 'gk', 'orphan', 'a', 'b', 'long'], 'validate: 不正・重複の場所を除く');
eq(vp.get('orphan').parentId, null, 'validate: 親が無い場所は最上位へ');
check(vp.get('a').parentId === null || vp.get('b').parentId === null, 'validate: 循環を断つ');
check(!C.wouldCreateCycle(vp, 'a', vp.get('a').parentId) && !C.wouldCreateCycle(vp, 'b', vp.get('b').parentId), 'validate: 修復後は循環が無い');
eq(vp.get('long').name.length, C.LIMITS.name, 'validate: 長すぎる名前を切る');
const vi = C.indexById(v.data.items);
eq(v.data.items.map(i => i.id), ['k', 'p', 'l'], 'validate: 名前の無いものは除く');
const badIds = C.validateBackup({ app: 'okiba', version: 1, items: [{ id: 'a%b', name: 'x' }, { id: 'a/b', name: 'x' }, { id: 'x'.repeat(65), name: 'x' }, { id: 'ok-1_A', name: 'x' }] }, T0);
eq(badIds.data.items.map(i => i.id), ['ok-1_A'], 'validate: URL を壊す id（% / や長すぎるもの）は除く');
eq([vi.get('k').homePlaceId, vi.get('k').homeDetail], [null, ''], 'validate: 存在しない定位置は外す');
eq([vi.get('k').status, vi.get('k').lentTo], ['placed', ''], 'validate: 不明な状態は「置いてある」、貸していないなら相手は消す');
eq(vi.get('k').history.map(x => [x.kind, x.placeId]), [['created', 'gk'], ['moved', null]], 'validate: 履歴の不正な種類を除き、消えた場所は null');
eq(vi.get('k').photoId, 'ph1', 'validate: 有効な写真は残す');
eq([vi.get('p').photoId, vi.get('p').placeId], [null, null], 'validate: 存在しない写真・場所は外す');
eq([vi.get('l').status, vi.get('l').lentTo, vi.get('l').lentAt], ['lent', '田中さん', 5], 'validate: 貸出中を保つ');
eq(v.data.photos.map(p => p.id), ['ph1'], 'validate: 壊れた写真・SVG は除く');
eq(v.data.misses.map(m => m.q), ['爪切り'], 'validate: 未登録メモ');
check(v.warnings.length >= 6, 'validate: 直した内容を警告として返す（' + v.warnings.length + '件）');

// 書き出し→読み込みで変わらない
const data0 = { places: v.data.places, items: v.data.items, photos: v.data.photos, misses: v.data.misses };
const round = C.validateBackup(JSON.parse(JSON.stringify(C.buildBackup(data0, T0))), T0);
eq(round.data, data0, 'buildBackup→validateBackup: 往復で変わらない');
eq(round.warnings, [], 'buildBackup→validateBackup: 警告なし');

// 統合
const curD = { places: [P('g', '玄関')], items: [I({ id: 'k', name: '鍵（新）', placeId: 'g', updatedAt: T0 + 100 }), I({ id: 'only', name: '端末だけ', placeId: 'g' })], photos: [{ id: 'mine' }], misses: [{ q: 'かぎ', at: 1, count: 1 }] };
const incD = { places: [P('g', '玄関（古い）'), P('x', '新しい場所')], items: [I({ id: 'k', name: '鍵（古）', placeId: 'g', updatedAt: T0 }), I({ id: 'inc', name: 'ファイルだけ', placeId: 'x', photoId: 'mine' })], photos: [], misses: [{ q: 'カギ', at: 2, count: 1 }, { q: '傘', at: 2, count: 1 }] };
const mg = C.mergeData(curD, incD);
const mi = C.indexById(mg.items);
eq(mi.get('k').name, '鍵（新）', 'merge: 同じものは更新が新しい方を残す');
check(mi.has('only') && mi.has('inc'), 'merge: 両方にしか無いものは足す');
eq(mi.get('inc').photoId, 'mine', 'merge: 端末にある写真は参照を保つ');
eq(mg.places.length, 2, 'merge: 場所を統合');
eq(mg.misses.map(m => m.q).sort(), ['かぎ', '傘'].sort(), 'merge: 未登録メモの表記ゆれを重複させない');

// Base64（大きいデータは分割して変換）
const big = new Uint8Array(200001);
for (let i = 0; i < big.length; i++) big[i] = (i * 7919) & 0xff;
eq(Buffer.from(C.bytesToBase64(big), 'base64').equals(Buffer.from(big)), true, 'bytesToBase64: Node の Base64 と一致');
eq(Buffer.from(C.base64ToBytes(C.bytesToBase64(big))).equals(Buffer.from(big)), true, 'base64ToBytes: 往復');
const ids = new Set(Array.from({ length: 1000 }, C.makeId));
eq(ids.size, 1000, 'makeId: 重複しない');

// ---------------------------------------------------------------------------
// 2. 外部に送信しない
// ---------------------------------------------------------------------------
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || '';
const dir = Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean).map(s => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
eq(dir['default-src'], ["'self'"], "CSP: default-src 'self'");
eq(dir['connect-src'], ["'self'"], "CSP: connect-src 'self'（fetch/XHR/WebSocket で外へ出られない）");
eq(dir['script-src'], ["'self'"], "CSP: script-src 'self'（インライン・外部スクリプト不可）");
eq(dir['style-src'], ["'self'"], "CSP: style-src 'self'");
eq(dir['img-src'], ["'self'", 'blob:'], 'CSP: img-src は自分と blob: のみ（外部画像のビーコン不可）');
eq(dir['form-action'], ["'none'"], "CSP: form-action 'none'");
check(!/unsafe-/.test(csp), 'CSP: unsafe-* を使わない');

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
check(scripts.length >= 2 && scripts.every(m => /\ssrc="[^"]+"/.test(m[1]) && !m[2].trim()), 'index.html: インラインスクリプトが無い');
check(!/<style\b/i.test(html), 'index.html: <style> が無い（CSP で無効になる）');
check(!/\sstyle\s*=/i.test(html), 'index.html: style 属性が無い（CSP で無効になる）');
check(!/\son[a-z]+\s*=/i.test(html), 'index.html: インラインのイベントハンドラが無い');
check(!/(src|href)="(https?:)?\/\//i.test(html), 'index.html: 外部URLを読み込まない');
check(!/assets\/site\.js|cloudflareinsights|googletagmanager/i.test(html), 'index.html: サイトの解析スクリプトを読み込まない');
for (const f of ['app.js', 'core.js', 'sw.js', 'style.css']) {
  const src = fs.readFileSync(path.join(DIR, f), 'utf8');
  check(!/https?:\/\//.test(src), f + ': 外部URLを含まない');
  check(!/localStorage|sessionStorage|document\.cookie|sendBeacon|XMLHttpRequest|WebSocket/.test(src), f + ': 保存は IndexedDB のみ・送信APIを使わない');
  if (f !== 'sw.js') check(!/\bfetch\s*\(/.test(src), f + ': fetch を使わない');
}
const app = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
check(!/style="/.test(app) && !/setAttribute\(\s*'style'/.test(app), 'app.js: style 属性を生成しない（CSP で無効になる）');
check(!/\son[a-z]+="/.test(app), 'app.js: インラインのイベントハンドラを生成しない');

// ---------------------------------------------------------------------------
// 3. PWA
// ---------------------------------------------------------------------------
function pngInfo(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
}
let manifest = null;
try { manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.webmanifest'), 'utf8')); } catch (e) { check(false, 'manifest: JSON として読めない ' + e.message); }
if (manifest) {
  for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'id', 'lang']) check(k in manifest, 'manifest: ' + k);
  eq(manifest.display, 'standalone', 'manifest: standalone');
  check(manifest.short_name.length <= 12, 'manifest: short_name はホーム画面で切れない長さ');
  check(manifest.icons.some(i => i.purpose === 'maskable') && manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'any') && manifest.icons.some(i => i.sizes === '192x192'), 'manifest: 192・512・maskable');
  for (const i of manifest.icons) {
    const info = pngInfo(path.join(DIR, i.src));
    const [w, hh] = i.sizes.split('x').map(Number);
    check(info && info.w === w && info.h === hh, 'manifest: ' + i.src + ' の実寸が ' + i.sizes);
  }
}
const apple = (html.match(/<link rel="apple-touch-icon" href="([^"]+)">/) || [])[1];
const ai = apple && pngInfo(path.join(DIR, apple));
check(ai && ai.w === 180 && ai.h === 180, 'apple-touch-icon: 180×180');
check(ai && ai.colorType === 2, 'apple-touch-icon: 透過なし（iOS は透過部分を黒くする）');
check(/<link rel="manifest" href="manifest.webmanifest">/.test(html), 'index.html: manifest を参照');

const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
const assets = swVersion.assetsOf(sw);
function listFiles(d, base) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap(e => {
    const rel = base ? base + '/' + e.name : e.name;
    return e.isDirectory() ? listFiles(path.join(d, e.name), rel) : [rel];
  });
}
const shipped = listFiles(DIR, '').filter(f => f !== 'sw.js' && !f.endsWith('.md')).map(f => './' + f).sort();
eq(assets.filter(a => a !== './').sort(), shipped, 'sw.js: ASSETS が配信ファイルと一致（追加・削除の反映漏れ）');
check(assets.includes('./'), 'sw.js: ./ をキャッシュ');
eq((sw.match(/const VERSION = '([^']+)'/) || [])[1], swVersion.computeVersion(sw), 'sw.js: VERSION が内容と一致（node scripts/okiba-sw-version.js を実行）');

// ---------------------------------------------------------------------------
// 4. サイトとの境界
// ---------------------------------------------------------------------------
check(/<meta name="robots" content="noindex,nofollow">/.test(html), 'index.html: noindex（RT-Lab の検索対象に混ぜない）');
check(!fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').includes('/okiba/'), 'sitemap.xml: /okiba/ を載せない');

console.log('test-okiba: ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);
