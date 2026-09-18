#!/usr/bin/env node
/**
 * drl-comparison/index.html の MODALITIES から、可視のDRL値一覧HTMLを生成して
 * ページ内のマーカー間に差し込む。
 *
 *   node scripts/generate-drl-table.js          … 生成して書き戻す
 *   node scripts/generate-drl-table.js --check  … 差分があれば exit 1（テスト用）
 *
 * なぜ生成するのか:
 *   95値を手書きでHTMLに複製すると、MODALITIES と表の2箇所に医療数値のコピーが
 *   でき、片方だけ古くなる。2026-09-09に発覚した事故（drl-comparison と
 *   ct-dose-estimator が別々に古い値を持っていた）とまったく同じ構造になる。
 *   MODALITIES を唯一の正とし、表はそこから機械的に導く。
 *   ドリフトは scripts/test-drl-mapping.js の --check で検出する。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const PAGE = path.join(ROOT, 'drl-comparison/index.html');
const START = '<!-- DRL-TABLE:START 自動生成。手で編集しない（scripts/generate-drl-table.js） -->';
const END = '<!-- DRL-TABLE:END -->';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** モダリティキーからアンカーIDを作る（英数とハイフンのみ） */
function anchorId(key) {
  return 'drl-values-' + key.replace(/[^a-z0-9]+/gi, '-');
}

function extractModalities(html) {
  const m = html.match(/const MODALITIES = \{[\s\S]*?\n\};/);
  if (!m) throw new Error('MODALITIES が見つからない');
  return eval(m[0] + '\n;MODALITIES;');
}

function render(MODALITIES) {
  const entries = Object.entries(MODALITIES);
  const total = entries.reduce((n, [, c]) => n + Object.keys(c.drl || {}).length, 0);

  const nav = entries
    .map(([key, cfg]) => {
      const n = Object.keys(cfg.drl || {}).length;
      return `      <a href="#${anchorId(key)}">${esc(cfg.name)}<span class="drl-jump-n">${n}</span></a>`;
    })
    .join('\n');

  const sections = entries
    .map(([key, cfg]) => {
      const metrics = cfg.metrics || [];
      const rows = Object.entries(cfg.drl || {})
        .map(([category, vals]) => {
          const cells = metrics
            .map((mt) => {
              const v = vals[mt.key];
              return `<td>${v === null || v === undefined ? '—' : esc(v)}</td>`;
            })
            .join('');
          return `            <tr><th scope="row">${esc(category)}</th>${cells}</tr>`;
        })
        .join('\n');

      const heads = metrics
        .map((mt) => {
          const unit = mt.unit && mt.unit !== '（種別による）' ? ` [${esc(mt.unit)}]` : '';
          return `<th scope="col">${esc(mt.label)}${unit}</th>`;
        })
        .join('');

      return [
        `    <section class="drl-mod" id="${anchorId(key)}">`,
        `      <h3 class="drl-mod-title">${esc(cfg.name)}<span class="drl-mod-n">${Object.keys(cfg.drl || {}).length}値</span></h3>`,
        '      <div class="table-wrap">',
        '        <table class="result-table">',
        `          <caption>${esc(cfg.name)}の診断参考レベル（Japan DRLs 2025）</caption>`,
        `          <thead><tr><th scope="col">DRLカテゴリ</th>${heads}</tr></thead>`,
        '          <tbody>',
        rows,
        '          </tbody>',
        '        </table>',
        '      </div>',
        '    </section>',
      ].join('\n');
    })
    .join('\n');

  return [
    START,
    `    <nav class="drl-jump" aria-label="モダリティから探す">`,
    nav,
    '    </nav>',
    `    <p class="drl-total">全 ${total} 値。数値はすべてJ-RIME報告書の該当節と照合しています。</p>`,
    sections,
    '    ' + END,
  ].join('\n');
}

function build() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const block = render(extractModalities(html));
  const i = html.indexOf(START);
  const j = html.indexOf(END);
  if (i < 0 || j < 0) throw new Error('DRL-TABLE のマーカーがページに無い');
  const next = html.slice(0, i) + block + html.slice(j + END.length);
  return { html, next };
}

module.exports = { render, extractModalities, START, END, PAGE };

if (require.main !== module) return;

const { html, next } = build();

if (process.argv.includes('--check')) {
  if (html !== next) {
    console.error('FAIL: drl-comparison/index.html のDRL値一覧が MODALITIES と一致していない。');
    console.error('      node scripts/generate-drl-table.js を実行してコミットすること。');
    process.exit(1);
  }
  console.log('OK: DRL値一覧は MODALITIES と一致している。');
} else {
  if (html === next) {
    console.log('変更なし（既に最新）。');
  } else {
    fs.writeFileSync(PAGE, next);
    console.log('drl-comparison/index.html のDRL値一覧を更新した。');
  }
}
