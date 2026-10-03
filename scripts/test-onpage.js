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
 *  6. FAQPage 構造化データの質問と回答がページ上に見えていること（回答は可視の1段落と完全一致、
 *     質問→回答の対応も見る）。生成ページは scripts/generate-faq.js の出力と一致し、1つだけ、正しい位置にあること
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
const faqGen = require('./generate-faq.js');

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
  if (p.html.includes(related.START_PREFIX)) {
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

// 6. FAQ: FAQPage 構造化データの質問・回答が、ページ上に見えていること
//    （構造化データは可視コンテンツと一致していることが前提）。
//    - 回答: 可視テキストの「1つの段落（ブロック要素）」と、空白を除いて完全一致すること。
//            回答の一部だけ・長い別の段落の一部・<title>・非表示要素・<template> の中では通さない
//            （JSON-LD の末尾を削っただけの回答や、別の質問の回答を載せた場合を検知するため）
//    - 質問: いずれかの段落に含まれること（「Q1.」のようなラベル付きの見出しを許す）
//    - 対応: 回答は、その質問より後ろ・次に現れる「別の質問」より前にあること
//    限界: 表示の可否は hidden 属性とインラインの display:none までしか追わない
//          （クラスや CSS による非表示、空白だけの差は検査しない）。
function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
const squash = s => String(s).replace(/\s+/g, '');
const slugOf = url => url.replace(/^\/|\/$/g, '');
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** hidden 属性、またはインラインの display:none を持つ要素を、対応する閉じタグまでまとめて除く */
function removeHiddenElements(html) {
  const openRe = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
  let out = '', last = 0, m;
  while ((m = openRe.exec(html)) !== null) {
    const tag = m[1].toLowerCase(), attrs = m[2];
    const names = attrs.replace(/"[^"]*"|'[^']*'/g, '""').split(/\s+/).map(a => a.split('=')[0].toLowerCase());
    const hidden = names.includes('hidden') || /style\s*=\s*(["'])[^"']*display\s*:\s*none/i.test(attrs);
    if (!hidden || VOID_TAGS.has(tag) || /\/\s*$/.test(attrs)) continue;
    const re = new RegExp('<(/?)' + tag + '\\b[^>]*>', 'gi');
    re.lastIndex = openRe.lastIndex;
    let depth = 1, n, end = html.length;
    while ((n = re.exec(html)) !== null) {
      depth += n[1] ? -1 : 1;
      if (depth === 0) { end = re.lastIndex; break; }
    }
    out += html.slice(last, m.index);
    last = end;
    openRe.lastIndex = end;
  }
  return out + html.slice(last);
}

/** <body> の可視テキストを、ブロック要素の境目で区切った「段落」の配列にする（空白は除去） */
function visibleParagraphs(html) {
  let b = html.slice(Math.max(0, html.search(/<body\b/i)));
  b = b.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<template\b[\s\S]*?<\/template>|<noscript\b[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ');
  b = removeHiddenElements(b);
  b = b.replace(/<\/(?:p|li|div|h[1-6]|summary|details|section|nav|td|th|tr|ul|ol|dl|dd|dt|blockquote|figure|figcaption|article|aside|header|footer|main)>|<br\s*\/?>/gi, '\u0001');
  return decodeEntities(b.replace(/<[^>]+>/g, ' ')).split('\u0001').map(squash).filter(Boolean);
}

function checkFaqVisible(url, slug, html) {
  let pagesWithFaq, faq;
  try {
    pagesWithFaq = faqGen.faqPages(html, url);
    faq = faqGen.extractFaq(html, url);
  } catch (e) { check(false, url + ': ' + e.message); return; }
  check(pagesWithFaq.length === 1, url + ': FAQPage の構造化データが ' + pagesWithFaq.length + ' 個ある（1個であるべき）');
  check(faq.length > 0, url + ': FAQPage の構造化データに質問が無い');
  check(faqGen.PAGES.includes(slug) || faqGen.isHandWritten(slug),
    url + ': FAQPage があるのに scripts/generate-faq.js の PAGES / HAND_WRITTEN に無い（ブログ記事は blog/ 配下なら自動で手書き扱い）');
  const segs = visibleParagraphs(html);
  const qs = faq.map(x => squash(x.q));
  const anchors = i => { const r = []; segs.forEach((sg, k) => { if (sg.includes(qs[i])) r.push(k); }); return r; };
  faq.forEach(({ q, a }, i) => {
    const aq = anchors(i);
    check(aq.length > 0, url + ': FAQ の質問が可視テキストに無い: ' + q.slice(0, 30));
    if (!aq.length) return;
    const aa = squash(a);
    const ok = aq.some(k => {
      let end = segs.length;
      for (let j = 0; j < faq.length; j++) {
        if (j === i) continue;
        const nk = anchors(j).find(x => x > k);
        if (nk !== undefined && nk < end) end = nk;
      }
      return segs.slice(k, end).includes(aa);
    });
    check(ok, url + ': FAQ の回答が「その質問の後・次の別の質問の前」の段落と完全一致しない' +
      '（途中で切れた回答・別の質問の回答・非表示の疑い）: ' + q.slice(0, 20) + '…');
  });
}

for (const p of pages) {
  if (!/FAQPage/.test(p.html)) continue;
  checkFaqVisible(p.url, slugOf(p.url), p.html);
}
for (const slug of faqGen.PAGES) {
  const url = slug ? '/' + slug + '/' : '/';
  const p = byUrl.get(url);
  if (!p) { check(false, url + ': generate-faq.js の PAGES にあるがページが無い'); continue; }
  let expected = null;
  try { expected = faqGen.apply(p.html, slug); } catch (e) { check(false, url + ': ' + e.message); continue; }
  check(expected === p.html, url + ': 可視FAQが FAQPage 構造化データと一致しない。node scripts/generate-faq.js を実行してコミットすること');
  const n = related.countOf(p.html, faqGen.START);
  check(n === 1, url + ': 可視FAQブロックが ' + n + ' 個ある（1個であるべき）');
  const si = p.html.indexOf(faqGen.START), ei = p.html.indexOf(faqGen.END);
  if (si >= 0 && ei > si) {
    if (slug === '') {
      const footer = p.html.indexOf('<!-- ===== Footer ===== -->');
      check(footer > ei, url + ': 可視FAQがフッターより後ろにある');
    } else {
      const masked = related.maskNonMarkup(p.html);
      const mainOpen = masked.search(/<main\b/), mainClose = masked.lastIndexOf('</main>');
      check(mainOpen >= 0 && si > mainOpen && ei < mainClose, url + ': 可視FAQが <main> の中にない');
      const rs = p.html.indexOf(related.START);
      if (rs >= 0) check(ei < rs, url + ': 可視FAQが関連ツールブロックより後ろにある');
    }
  } else {
    check(false, url + ': 可視FAQブロックが無い');
  }
}
for (const p of pages) {
  if (p.html.includes(faqGen.START_PREFIX)) {
    check(faqGen.PAGES.includes(slugOf(p.url)), p.url + ': 可視FAQのマーカーがあるのに generate-faq.js の PAGES に無い（古いブロックが残っている）');
  }
}

console.log('\n  pass ' + pass + ' / fail ' + fail);
if (fail) { bad.forEach(b => console.log('  FAIL ' + b)); process.exit(1); }
console.log('  すべてのチェックを通過しました。');
