#!/usr/bin/env node
/**
 * ページの FAQPage 構造化データ（JSON-LD）から、可視の「よくある質問」ブロックを生成して
 * ページ内のマーカー間に差し込む。
 *
 *   node scripts/generate-faq.js          … 生成して書き戻す（冪等）
 *   node scripts/generate-faq.js --check  … 差分があれば exit 1（テスト用）
 *
 * なぜ生成するのか:
 *   FAQPage 構造化データは、同じ質問と回答がページ上に見えていることが前提。
 *   2026-10-03の監査では、トップを含む8ページで構造化データだけが先行し、可視のQ&Aが無い
 *   （または一部だけ）状態だった。手書きで両方を保つとまた食い違うので、JSON-LD を唯一の
 *   正とし、可視ブロックはそこから機械的に導く。文面は変えない（JSON-LD の文をそのまま出す）。
 *   ドリフトは scripts/test-onpage.js が検出する。
 *
 * 対象外:
 *   drl-comparison・mri-simulator・ブログ記事は、ページ固有の見た目で手書きの可視FAQを持つ。
 *   生成物には置き換えず、test-onpage.js が「JSON-LD の質問と回答が可視テキストにある」ことだけ検査する。
 *
 * 差し込み位置:
 *   - トップ: <!-- ===== Footer ===== --> の直前（<section class="section"> の体裁）
 *   - ツールページ: 「関連ツール」ブロック（RELATED:START）の直前。無ければ最後の </main> の直前
 */
const fs = require('fs');
const path = require('path');
const { maskNonMarkup, countOf } = require('./generate-related.js');

const ROOT = path.dirname(__dirname);
const START_PREFIX = '<!-- FAQ:START';  // 古い文言のマーカーが残っていても検知するための接頭辞
const START = '<!-- FAQ:START 自動生成。手で編集しない。元は同ページの FAQPage 構造化データ（scripts/generate-faq.js） -->';
const END = '<!-- FAQ:END -->';
const RELATED_START = '<!-- RELATED:START';
const TOP_FOOTER = '<!-- ===== Footer ===== -->';

// 可視FAQを生成するページ（'' = トップ）
const PAGES = ['', 'ct-dose-estimator', 'nps-calculator', 'mtf-calculator', 'contrast-quick', 'egfr-checker', 'exposure-reference'];
// 手書きの可視FAQを持つページ（生成しない。テストが可視テキストとの一致だけ検査する）。
// ブログ記事（blog/ 配下）は本文と一体の可視FAQセクションを持つ（記事追加時のチェックリスト参照）ので、
// 記事を足すたびに登録しなくて済むよう接頭辞で一律に扱う
const HAND_WRITTEN = ['drl-comparison', 'mri-simulator'];
const isHandWritten = slug => HAND_WRITTEN.includes(slug) || slug.startsWith('blog/');

function pageFile(slug) { return path.join(ROOT, slug, 'index.html'); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// <script type="application/ld+json"> の書き方の揺れ（属性の順序・単引用符・大文字）を許す
const LD_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
// 回答や質問に HTML タグ状の文字列があると、esc() で文字としてそのまま表示されてしまう
const TAG_LIKE = /<\/?[a-z][^>]*>/i;

/** html の JSON-LD エンティティを全部返す。JSON として読めないものがあれば例外（黙って飛ばさない） */
function jsonLdEntities(html, label) {
  const out = [];
  for (const m of html.matchAll(LD_RE)) {
    let d;
    try { d = JSON.parse(m[1]); } catch (e) { throw new Error((label || 'page') + ': JSON-LD を JSON として読めない（' + e.message + '）'); }
    for (const it of (Array.isArray(d) ? d : (d && d['@graph']) || [d])) if (it && typeof it === 'object') out.push(it);
  }
  return out;
}

/** @type が文字列でも配列でも FAQPage を拾う */
function faqPages(html, label) {
  return jsonLdEntities(html, label).filter(it => [].concat(it['@type'] || []).includes('FAQPage'));
}

/** html の FAQPage JSON-LD から [{q, a}] を取り出す。無ければ [] */
function extractFaq(html, label) {
  const out = [];
  for (const it of faqPages(html, label)) {
    for (const q of [].concat(it.mainEntity || [])) out.push({ q: q.name, a: q.acceptedAnswer && q.acceptedAnswer.text });
  }
  return out;
}

/** 1ページ分のブロック。ind は基準インデント（トップは既存の section に合わせて無し） */
function render(slug, faq) {
  const top = slug === '';
  const ind = top ? '' : '  ';
  const qa = faq.flatMap(({ q, a }) => [
    '<h3 class="rt-faq-q">' + esc(q) + '</h3>',
    '<p class="rt-faq-a">' + esc(a) + '</p>',
  ]);
  const lines = top
    ? [
        START,
        '<section class="section" id="faq" aria-labelledby="rt-faq-title">',
        '  <h2 class="section-title" id="rt-faq-title">よくある質問</h2>',
        '  <div class="rt-faq rt-faq-top">',
        ...qa.map(l => '    ' + l),
        '  </div>',
        '</section>',
        END,
      ]
    : [
        START,
        '<section class="rt-faq" aria-labelledby="rt-faq-title">',
        '  <h2 class="rt-faq-title" id="rt-faq-title">よくある質問</h2>',
        ...qa.map(l => '  ' + l),
        '</section>',
        END,
      ];
  return lines.map(l => ind + l).join('\n');
}

/** 差し込み位置（行頭の index）を返す */
function insertionPoint(html, slug) {
  if (slug === '') {
    const at = html.indexOf(TOP_FOOTER);
    if (at < 0) throw new Error('トップ: ' + TOP_FOOTER + ' が見つからない');
    return html.lastIndexOf('\n', at) + 1;
  }
  const rs = html.indexOf(RELATED_START);
  if (rs >= 0) return html.lastIndexOf('\n', rs) + 1;
  const at = maskNonMarkup(html).lastIndexOf('</main>');
  if (at < 0) throw new Error(slug + ': </main> が見つからない');
  const lineStart = html.lastIndexOf('\n', at) + 1;
  if (html.slice(lineStart, at).trim() !== '') throw new Error(slug + ': </main> が行頭にない');
  return lineStart;
}

/** html に FAQ ブロックを差し込む（既にあれば置換） */
function apply(html, slug) {
  const label = slug || '(トップ)';
  if (html.includes('\r')) throw new Error(label + ': CRLF 改行は未対応');
  const faq = extractFaq(html, label);
  if (faq.length === 0) throw new Error(label + ': FAQPage 構造化データが見つからない');
  for (const { q, a } of faq) {
    if (!q || !a) throw new Error(label + ': FAQ に空の質問または回答がある');
    if (TAG_LIKE.test(q) || TAG_LIKE.test(a)) {
      throw new Error(label + ': FAQ に HTML タグ状の文字列がある（エスケープされて文字として見えてしまうため未対応）: ' + q.slice(0, 20));
    }
  }
  const block = render(slug, faq);
  const nStart = countOf(html, START), nEnd = countOf(html, END);
  if (nStart > 1 || nEnd > 1) throw new Error(label + ': マーカーが複数ある（START ' + nStart + ' / END ' + nEnd + '）');
  const si = html.indexOf(START), ei = html.indexOf(END);
  if (si >= 0 && ei > si) {
    const lineStart = html.lastIndexOf('\n', si) + 1;
    if (html.slice(lineStart, si).trim() !== '') throw new Error(label + ': START マーカーの前に別の文字列がある');
    return html.slice(0, lineStart) + block + html.slice(ei + END.length);
  }
  if (si >= 0 || ei >= 0) throw new Error(label + ': マーカーが片方しかない');
  const at = insertionPoint(html, slug);
  return html.slice(0, at) + block + '\n\n' + html.slice(at);
}

module.exports = { PAGES, HAND_WRITTEN, isHandWritten, START, START_PREFIX, END, jsonLdEntities, faqPages, extractFaq, render, apply, pageFile };

if (require.main === module) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const slug of PAGES) {
    const file = pageFile(slug);
    const before = fs.readFileSync(file, 'utf8');
    const after = apply(before, slug);
    if (after === before) continue;
    stale++;
    console.log((check ? '  差分あり ' : '  更新 ') + (slug || '/'));
    if (!check) fs.writeFileSync(file, after);
  }
  if (check && stale) {
    console.error('\n  可視FAQが FAQPage 構造化データと一致しない。node scripts/generate-faq.js を実行してコミットすること');
    process.exit(1);
  }
  console.log(stale ? '\n  ' + stale + ' ページを更新しました。' : '  変更なし（すべて最新）。');
}
