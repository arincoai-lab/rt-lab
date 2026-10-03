#!/usr/bin/env node
/**
 * 公開ページの「オンページ構造」の回帰テスト。
 *
 *   node scripts/test-onpage.js
 *
 * 目的:
 *  1. sitemap の全URLが実ファイルに解決し、全 index.html が sitemap に載っていること
 *  2. 全ページに title / description / canonical / og:image / h1（1つ）があること
 *  3. 孤立ページが無く、ツールページの被リンク（静的HTML上のaタグ）が閾値以上あること
 *  4. 「関連ツール」ブロックが scripts/generate-related.js の出力と一致していること
 *
 * 2026-10-03の監査で、8ツールの静的リンクの被リンクがトップ1本だけだった。
 * いずれも「ドキュメントに書いても再発する」種類の問題なので、文章ではなくテストで止める
 * （2026-09-09 の DRL値事故と同じ教訓）。
 */
const fs = require('fs');
const path = require('path');
const related = require('./generate-related.js');

const ROOT = path.dirname(__dirname);
const ORIGIN = 'https://rt-ai-lab.com';
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'samples', 'test-data', 'assets']);

// ツールページ（CLAUDE.md の「ツール進捗」表）。被リンクの最低本数を課す
const TOOL_SLUGS = Object.keys(related.TOOLS);
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

// 3. 被リンク（静的HTML上の <a href>。site.js が注入する応援帯は数えない）
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
for (const slug of TOOL_SLUGS) {
  const url = '/' + slug + '/';
  const min = MIN_INBOUND_OVERRIDE[slug] || MIN_INBOUND;
  const n = byUrl.has(url) ? inbound.get(url).size : 0;
  check(n >= min, url + ': 被リンクが ' + n + ' 本（' + min + ' 本以上必要）。from=' + [...(inbound.get(url) || [])].join(','));
}

// 4. 関連ツールブロックが生成物と一致
for (const e of related.validate()) check(false, 'RELATED の定義: ' + e);
for (const slug of Object.keys(related.RELATED)) {
  const p = byUrl.get('/' + slug + '/');
  if (!p) continue;
  let expected = null;
  try { expected = related.apply(p.html, slug); } catch (e) { check(false, slug + ': ' + e.message); continue; }
  check(expected === p.html,
    slug + ': 関連ツールブロックが RELATED と一致しない。node scripts/generate-related.js を実行してコミットすること');
  const n = (p.html.match(/<li><a href="\/[a-z0-9-]+\/">/g) || []).length;
  check(p.html.includes(related.START) && n >= 2, slug + ': 関連ツールブロックが無い、または2本未満');
}

console.log('\n  pass ' + pass + ' / fail ' + fail);
if (fail) { bad.forEach(b => console.log('  FAIL ' + b)); process.exit(1); }
console.log('  すべてのチェックを通過しました。');
