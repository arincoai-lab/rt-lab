#!/usr/bin/env node
/**
 * 各ツールページの </main> 直前に「関連ツール」ブロックを生成して差し込む。
 *
 *   node scripts/generate-related.js          … 生成して書き戻す（冪等）
 *   node scripts/generate-related.js --check  … 差分があれば exit 1（テスト用）
 *
 * なぜ生成するのか:
 *   2026-10-03の監査で、8ツールの静的リンクの被リンクがトップ1本だけだった
 *   （CTRが最も高いツールの mtf-calculator も、トップ以外からは辿れなかった）。
 *   関連リンクを14ページに手書きすると、ツールを足すたびに全ページを直すことになり、
 *   また抜ける。リンクの関係を RELATED に一か所だけ書き、各ページへは機械的に差し込む。
 *   ドリフトは scripts/test-onpage.js が検出する。
 *
 * 設計:
 *   - 1ページの関連は3本以内（散らかさない）。クラスタ（画質評価／差分／MRI／造影剤／線量／心臓）で結ぶ
 *   - 説明文は各ページの meta description に書かれた機能だけを言う（言い過ぎない）
 *   - トップ（/）と記事は対象外。記事→ツールの導線は各記事の .blog-related が担当
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const START = '<!-- RELATED:START 自動生成。手で編集しない（scripts/generate-related.js） -->';
const END = '<!-- RELATED:END -->';
const MAX_RELATED = 3;

// name はリンクのアンカーテキスト、desc は一言説明（meta description の範囲内）
const TOOLS = {
  'mtf-calculator': { name: 'MTF計算ツール', desc: 'Circular Edge法でMTF（空間分解能）を算出' },
  'nps-calculator': { name: 'NPS計算ツール', desc: '2D-NPS・Radial Averageでノイズ特性を評価' },
  'cnr-calculator': { name: 'CNR計測ツール', desc: 'ROIからCNR・d′・Visibilityを計測' },
  'task-based-iq': { name: 'Task-based IQ評価ツール', desc: 'CNR・NPS・TTF・NPWE d′でCT低コントラスト条件を比較（研究公開）' },
  'brain-diff': { name: '脳画像差分ツール', desc: '脳CT/MRIの2シリーズを位置合わせして差分を可視化' },
  'subtraction-demo': { name: 'Subtractionツール デモ', desc: '位置合わせ後の差分オーバーレイの出力例（研究公開）' },
  'mri-simulator': { name: 'MRIシミュレータ', desc: 'TE・TR・TIを動かして画像コントラストの変化を学ぶ教育用' },
  'cardiac-phase-optimizer': { name: '心臓CT 最適位相決定ツール', desc: '心拍数・装置から最適な再構成位相を算出' },
  'contrast-quick': { name: '造影剤クイック計算', desc: '体重法・体表面積法で造影剤量・注入速度を計算' },
  'contrast-simulator': { name: '造影CTシミュレータ', desc: '時間濃度曲線（TDC）でスキャンタイミングを検討' },
  'egfr-checker': { name: '腎機能チェッカー（eGFR）', desc: 'eGFRを計算し、造影CT・MRIのガイドライン上の目安を確認' },
  'ct-dose-estimator': { name: 'SSDE計算ツール', desc: 'SSDE・実効線量・Japan DRLs 2025との比較' },
  'drl-comparison': { name: 'DRLs2025 一覧・比較ツール', desc: 'Japan DRLs 2025の全値と自施設データの比較' },
  'exposure-reference': { name: '一般撮影条件参照', desc: '部位別のkVp・mAs・グリッドの早見表と補正計算' },
};

// ページ → 関連ツール（表示順）。クラスタごとに結び、被リンクが偏らないようにする
const RELATED = {
  // 画質評価
  'mtf-calculator': ['nps-calculator', 'cnr-calculator', 'task-based-iq'],
  'nps-calculator': ['mtf-calculator', 'cnr-calculator', 'task-based-iq'],
  'cnr-calculator': ['mtf-calculator', 'nps-calculator', 'task-based-iq'],
  'task-based-iq': ['mtf-calculator', 'nps-calculator', 'cnr-calculator'],
  // 差分・MRI
  'brain-diff': ['subtraction-demo', 'mri-simulator', 'cnr-calculator'],
  'subtraction-demo': ['brain-diff', 'mri-simulator', 'cnr-calculator'],
  'mri-simulator': ['brain-diff', 'egfr-checker', 'cnr-calculator'],
  // 造影剤
  'contrast-quick': ['contrast-simulator', 'egfr-checker'],
  'contrast-simulator': ['contrast-quick', 'egfr-checker', 'cardiac-phase-optimizer'],
  'egfr-checker': ['contrast-quick', 'contrast-simulator', 'mri-simulator'],
  // 線量
  'ct-dose-estimator': ['drl-comparison', 'exposure-reference', 'cardiac-phase-optimizer'],
  'drl-comparison': ['ct-dose-estimator', 'exposure-reference'],
  'exposure-reference': ['drl-comparison', 'ct-dose-estimator'],
  // 心臓
  'cardiac-phase-optimizer': ['contrast-simulator', 'ct-dose-estimator', 'contrast-quick'],
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 1ページ分のブロック（全行に2スペースの基準インデントを付ける） */
function render(slug) {
  const items = RELATED[slug].map(t =>
    '      <li><a href="/' + t + '/">' + esc(TOOLS[t].name) + '</a>' +
    '<span class="rt-related-desc">' + esc(TOOLS[t].desc) + '</span></li>'
  );
  return [
    '  ' + START,
    '  <nav class="rt-related" aria-label="関連ツール">',
    '    <h2 class="rt-related-title">関連ツール</h2>',
    '    <ul class="rt-related-list">',
    ...items,
    '    </ul>',
    '  </nav>',
    '  ' + END,
  ].join('\n');
}

/** html にブロックを差し込む（既にあれば置換）。差し込み先は最後の </main> の直前 */
function apply(html, slug) {
  const block = render(slug);
  const si = html.indexOf(START);
  const ei = html.indexOf(END);
  if (si >= 0 && ei > si) {
    const lineStart = html.lastIndexOf('\n', si) + 1;
    return html.slice(0, lineStart) + block + html.slice(ei + END.length);
  }
  if (si >= 0 || ei >= 0) throw new Error(slug + ': マーカーが片方しかない');
  const at = html.lastIndexOf('</main>');
  if (at < 0) throw new Error(slug + ': </main> が見つからない');
  const lineStart = html.lastIndexOf('\n', at) + 1;
  if (html.slice(lineStart, at).trim() !== '') throw new Error(slug + ': </main> が行頭にない');
  return html.slice(0, lineStart) + block + '\n\n' + html.slice(lineStart);
}

function validate() {
  const errors = [];
  for (const [slug, rel] of Object.entries(RELATED)) {
    if (!TOOLS[slug]) errors.push(slug + ': TOOLS に無い');
    if (!fs.existsSync(path.join(ROOT, slug, 'index.html'))) errors.push(slug + ': ページが無い');
    if (rel.length > MAX_RELATED) errors.push(slug + ': 関連が' + MAX_RELATED + '本を超える');
    if (new Set(rel).size !== rel.length) errors.push(slug + ': 関連が重複');
    for (const t of rel) {
      if (t === slug) errors.push(slug + ': 自分自身へのリンク');
      if (!TOOLS[t]) errors.push(slug + ' → ' + t + ': TOOLS に無い');
    }
  }
  return errors;
}

module.exports = { TOOLS, RELATED, START, END, MAX_RELATED, render, apply, validate };

if (require.main === module) {
  const check = process.argv.includes('--check');
  const errors = validate();
  if (errors.length) { errors.forEach(e => console.error('  NG ' + e)); process.exit(1); }
  let stale = 0;
  for (const slug of Object.keys(RELATED)) {
    const file = path.join(ROOT, slug, 'index.html');
    const before = fs.readFileSync(file, 'utf8');
    const after = apply(before, slug);
    if (after === before) continue;
    stale++;
    console.log((check ? '  差分あり ' : '  更新 ') + slug);
    if (!check) fs.writeFileSync(file, after);
  }
  if (check && stale) {
    console.error('\n  関連ツールブロックが RELATED と一致しない。node scripts/generate-related.js を実行してコミットすること');
    process.exit(1);
  }
  console.log(stale ? '\n  ' + stale + ' ページを更新しました。' : '  変更なし（すべて最新）。');
}
