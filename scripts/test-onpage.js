#!/usr/bin/env node
/**
 * 公開ページの「オンページ構造」の回帰テスト。
 *
 *   node scripts/test-onpage.js
 *
 * 目的:
 *  1. sitemap の全URLが実ファイルに解決し、全 index.html が sitemap に載っていること
 *  2. 全ページに title / description / canonical / og:image / h1（1つ）があること
 *  3. sitemap にあるツールが TOOLS / RELATED に登録されていること（登録漏れの検出）
 *  4. 孤立ページが無く、ツールページの被リンク（静的HTML上のaタグ）が閾値以上あること
 *  5. 「関連ツール」ブロックが scripts/generate-related.js の出力と一致し、
 *     ページに1つだけ、<main> の中にあること
 *
 * 2026-10-03の監査で、8ツールの静的リンクの被リンクがトップ1本だけだった。
 * 「ドキュメントに書いても再発する」種類の問題なので、文章ではなくテストで検知する
 * （2026-09-09 の DRL値事故と同じ教訓）。
 *
 * 注意: このテストは CI では実行されない（deploy.yml には載っていない）。
 *       ページを足す・リンクを変える・RELATED を触ったら、コミット前に手で実行すること。
 */
const fs = require('fs');
const path = require('path');
const related = require('./generate-related.js');

const ROOT = path.dirname(__dirname);
const ORIGIN = 'https://rt-ai-lab.com';
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'samples', 'test-data', 'assets']);

// ツールではないページ。これ以外の sitemap URL（/blog/ 配下を除く）は「ツール」とみなす。
// ツール一覧を TOOLS から作ると登録漏れを検出できなくなる（循環する）ため、sitemap から独立に導く。
const NON_TOOL = new Set(['/', '/about/', '/contact/', '/privacy/', '/support/', '/blog/']);
const MIN_INBOUND = 3;
// 研究公開デモは関連づけられる相手が限られるため、緩めの閾値にしている
const MIN_INBOUND_OVERRIDE = { 'subtraction-demo': 2 };

let pass = 0, fail = 0;
const bad = [];
function check(ok, label) { if (ok) pass++; else { fail++; bad.push(label); } }

// ---- ページ一覧（public な index.html） ----
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === 'index.html') out.push(p);
  }
  return out;
}
function urlPath(file) {
  const rel = path.relative(ROOT, path.dirname(file)).split(path.sep).join('/');
  return rel ? '/' + rel + '/' : '/';
}
const pages = walk(ROOT, []).map(f => ({ file: f, url: urlPath(f), html: fs.readFileSync(f, 'utf8') }));
const byUrl = new Map(pages.map(p => [p.url, p]));

function stripNonContent(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
}

// 1. sitemap ⇔ ファイル
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].trim().replace(ORIGIN, ''));
for (const u of sitemapUrls) check(byUrl.has(u), 'sitemap のURL ' + u + ' に対応する index.html が無い');
for (const p of pages) check(sitemapUrls.includes(p.url), p.url + ' が sitemap に載っていない');
check(new Set(sitemapUrls).size === sitemapUrls.length, 'sitemap に重複URLがある');

// 2. 全ページの基本タグ
for (const p of pages) {
  const body = stripNonContent(p.html);
  check(/<title>[^<]+<\/title>/.test(p.html), p.url + ': title が無い');
  check(/<meta\s+name="description"\s+content="[^"]+"/.test(p.html), p.url + ': meta description が無い');
  check(p.html.includes('<link rel="canonical" href="' + ORIGIN + p.url + '">'),
    p.url + ': canonical が自分のURL（' + ORIGIN + p.url + '）になっていない');
  check(/<meta\s+property="og:image"\s+content="[^"]+"/.test(p.html), p.url + ': og:image が無い');
  check((body.match(/<h1\b/gi) || []).length === 1, p.url + ': h1 が1つではない');
}

// 3. ツールの登録漏れ（ツール集合は sitemap から独立に導く）
const toolSlugs = sitemapUrls
  .filter(u => !NON_TOOL.has(u) && !u.startsWith('/blog/'))
  .map(u => u.replace(/^\/|\/$/g, ''));
for (const s of toolSlugs) {
  check(s in related.TOOLS && s in related.RELATED,
    '/' + s + '/: sitemap にあるが TOOLS / RELATED に未登録。ツールなら scripts/generate-related.js に追記して再生成、' +
    'ツールでなければ scripts/test-onpage.js の NON_TOOL に追加すること');
}
for (const s of Object.keys(related.TOOLS)) {
  check(toolSlugs.includes(s), s + ': TOOLS にあるが sitemap のツールに無い（削除済み？ NON_TOOL に入れた？）');
}
for (const p of pages) {
  const slug = p.url.replace(/^\/|\/$/g, '');
  if (p.html.includes(related.START)) {
    check(slug in related.RELATED, p.url + ': 関連ツールのマーカーがあるのに RELATED に無い（古いブロックが残っている）');
  }
}

// 4. 被リンク（静的HTML上の <a href>。site.js が注入する応援帯は数えない）
function normalize(href) {
  let h = href.split('#')[0].split('?')[0].replace(/^https?:\/\/(www\.)?rt-ai-lab\.com/, '');
  if (!h.startsWith('/')) return null;
  h = h.replace(/index\.html$/, '');
  if (!h.endsWith('/') && !/\.[a-z0-9]+$/i.test(h)) h += '/';
  return h;
}
const inbound = new Map(pages.map(p => [p.url, new Set()]));
for (const p of pages) {
  for (const m of stripNonContent(p.html).matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)) {
    const t = normalize(m[1]);
    if (t && t !== p.url && inbound.has(t)) inbound.get(t).add(p.url);
  }
}
for (const p of pages) {
  if (p.url === '/') continue;
  check(inbound.get(p.url).size >= 1, p.url + ': 孤立ページ（どのページからもリンクされていない）');
}
for (const slug of toolSlugs) {
  const url = '/' + slug + '/';
  const min = MIN_INBOUND_OVERRIDE[slug] || MIN_INBOUND;
  const n = byUrl.has(url) ? inbound.get(url).size : 0;
  check(n >= min, url + ': 被リンクが ' + n + ' 本（' + min + ' 本以上必要）。from=' + [...(inbound.get(url) || [])].join(','));
}

// 5. 関連ツールブロック（生成物との一致・個数・位置）
for (const e of related.validate()) check(false, 'RELATED の定義: ' + e);
for (const slug of Object.keys(related.RELATED)) {
  const p = byUrl.get('/' + slug + '/');
  if (!p) continue;
  let expected = null;
  try { expected = related.apply(p.html, slug); } catch (e) { check(false, slug + ': ' + e.message); continue; }
  check(expected === p.html,
    slug + ': 関連ツールブロックが RELATED と一致しない。node scripts/generate-related.js を実行してコミットすること');
  const nStart = related.countOf(p.html, related.START);
  check(nStart === 1, slug + ': 関連ツールブロックが ' + nStart + ' 個ある（1個であるべき）');
  const si = p.html.indexOf(related.START), ei = p.html.indexOf(related.END);
  if (si >= 0 && ei > si) {
    const masked = related.maskNonMarkup(p.html);
    const mainOpen = masked.search(/<main\b/), mainClose = masked.lastIndexOf('</main>');
    check(mainOpen >= 0 && si > mainOpen && ei < mainClose, slug + ': 関連ツールブロックが <main> の中にない');
    const n = (p.html.slice(si, ei).match(/<li><a href="\/[a-z0-9-]+\/">/g) || []).length;
    check(n === related.RELATED[slug].length, slug + ': ブロック内のリンク数 ' + n + ' が RELATED の ' + related.RELATED[slug].length + ' 本と違う');
  } else {
    check(false, slug + ': 関連ツールブロックが無い');
  }
}

console.log('\n  pass ' + pass + ' / fail ' + fail);
if (fail) { bad.forEach(b => console.log('  FAIL ' + b)); process.exit(1); }
console.log('  すべてのチェックを通過しました。');
