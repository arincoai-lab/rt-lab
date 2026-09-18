#!/usr/bin/env node
/**
 * drl-comparison のDRL値とプロトコール名マッピングの回帰テスト。
 *
 *   node scripts/test-drl-mapping.js
 *
 * 目的:
 *  1. DRL値が scripts/drl2025-provenance.json（原典照合表）と一致していること
 *  2. keywordMap が「より緩い判定（＝高いDRL）」側へ誤マッピングしないこと
 *  3. templateRows（配布サンプル）が実マッチャで正しいカテゴリに解決すること
 *
 * 2026-09-09: exclude がソフト減点だったため「非CTO PCI」が CTO PCI（DRL 2500）に
 * 吸われ、本来1300で判定すべき症例が緩く判定されていた。年齢キーワードも部分一致で
 * 「0歳」が「10歳」に当たり、16区分中10が誤っていた。同種の再発を防ぐためのテスト。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const html = fs.readFileSync(path.join(ROOT, 'drl-comparison/index.html'), 'utf8');
const MODALITIES = eval(html.match(/const MODALITIES = \{[\s\S]*?\n\};/)[0] + '\n;MODALITIES;');
const EXCLUDE_LABEL = '（対象外）';

// drl-comparison/index.html の suggestDrlCategory と同じロジック
function suggest(modality, protocolName) {
  const lower = protocolName.toLowerCase();
  let best = EXCLUDE_LABEL, bestScore = 0, tied = false;
  for (const [category, config] of Object.entries(MODALITIES[modality].keywordMap)) {
    let score = 0;
    for (const [kw, weight] of config.keywords) {
      try { if (new RegExp(kw.toLowerCase()).test(lower)) score += weight; }
      catch { if (lower.includes(kw.toLowerCase())) score += weight; }
    }
    if (config.exclude && config.exclude.some(ex => lower.includes(ex.toLowerCase()))) score = 0;
    if (score > bestScore) { bestScore = score; best = category; tied = false; }
    else if (score === bestScore && score > 0) { tied = true; }
  }
  return tied ? EXCLUDE_LABEL : best;
}

let pass = 0, fail = 0;
const bad = [];
function check(ok, label) { if (ok) pass++; else { fail++; bad.push(label); } }

// 1. DRL値が照合表と一致するか
const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/drl2025-provenance.json'), 'utf8'));
const provMap = new Map(prov.filter(r => (r.tool || 'drl-comparison') === 'drl-comparison')
                            .map(r => [r.modality + ' ' + r.category, r.values]));
let nValues = 0;
for (const [mod, m] of Object.entries(MODALITIES)) {
  for (const [cat, vals] of Object.entries(m.drl)) {
    const expect = provMap.get(mod + ' ' + cat);
    const got = Object.values(vals).filter(v => v !== null);
    nValues++;
    check(expect && JSON.stringify(expect) === JSON.stringify(got),
      'DRL値 ' + mod + '/' + cat + ': code=' + JSON.stringify(got) + ' provenance=' + JSON.stringify(expect));
  }
}
check(provMap.size === nValues, '照合表の件数 ' + provMap.size + ' とコードの件数 ' + nValues + ' が不一致');

// 1b. ct-dose-estimator の DRL_VALUES も照合表と一致するか
const ctdeHtml = fs.readFileSync(path.join(ROOT, 'ct-dose-estimator/index.html'), 'utf8');
const DRL_VALUES = eval(ctdeHtml.match(/const DRL_VALUES = \{[\s\S]*?\n\};/)[0] + '\n;DRL_VALUES;');
for (const r of prov.filter(x => x.tool === 'ct-dose-estimator')) {
  const got = DRL_VALUES[r.category];
  check(got && got.ctdi === r.values[0] && got.dlp === r.values[1],
    'ct-dose-estimator ' + r.category + ': code=' + JSON.stringify(got) + ' provenance=' + JSON.stringify(r.values));
}

// 2. 誤マッピングの回帰ケース
const CASES = [
  // 否定形が肯定形（より高いDRL）に吸われないこと
  ['ivr', '非CTO PCI', '非CTO PCI'], ['ivr', 'CTO PCI', 'CTO PCI'],
  ['ivr', '非PVI RFCA', '非PVI RFCA'], ['ivr', 'PVI RFCA', 'PVI RFCA'],
  ['ivr', 'EVT 非CTO 腸骨動脈', 'EVT 非CTO 腸骨動脈'], ['ivr', 'EVT CTO 腸骨動脈', 'EVT CTO 腸骨動脈'],
  ['ivr', 'EVT 非CTO 浅大腿動脈', 'EVT 非CTO 浅大腿動脈'], ['ivr', 'EVT CTO 浅大腿動脈', 'EVT CTO 浅大腿動脈'],
  // 収載していない薬剤を別薬剤のDRLで判定しないこと
  ['nm', '副甲状腺シンチ 99mTc-MIBI', EXCLUDE_LABEL],
  ['nm', 'RIベノグラフィ 99mTc-MAA', EXCLUDE_LABEL],
  // 英字略語の部分一致で誤爆しないこと（PE が Pelvis/Perfusion に当たっていた）
  ['ct', 'Pelvis', EXCLUDE_LABEL], ['ct', 'PERFUSION', EXCLUDE_LABEL],
  ['ct', 'Chest to Pelvis', '胸部～骨盤1相'],
  ['ct', '急性肺血栓塞栓症', '急性肺血栓塞栓症&深部静脈血栓症'],
];
for (const [mod, input, expected] of CASES) {
  const got = suggest(mod, input);
  check(got === expected, 'マッピング ' + mod + ' "' + input + '" -> ' + got + '（期待 ' + expected + '）');
}

// 小児CTの年齢バケット（0〜14歳が正しい区分に入り、15歳は自動推定しない）
const band = a => a < 1 ? '0-<1歳' : a < 5 ? '1-<5歳' : a < 10 ? '5-<10歳' : a < 15 ? '10-<15歳' : null;
for (const site of ['頭部', '胸部', '腹部']) {
  for (let a = 0; a <= 15; a++) {
    const got = suggest('pediatric_ct', site + ' ' + a + '歳');
    const expected = band(a) ? site + '（' + band(a) + '）' : EXCLUDE_LABEL;
    check(got === expected, '小児CT ' + site + ' ' + a + '歳 -> ' + got + '（期待 ' + expected + '）');
  }
}

// 3. templateRows が実マッチャで正しく解決すること
for (const [mod, m] of Object.entries(MODALITIES)) {
  for (const row of m.templateRows) {
    const name = row[m.protocolCol];
    const got = suggest(mod, name);
    check(got !== EXCLUDE_LABEL && got in m.drl, 'templateRow ' + mod + ' "' + name + '" -> ' + got);
    for (const col of m.requiredCols) {
      check(col in row, 'templateRow ' + mod + ' "' + name + '" に必須列 ' + col + ' がない');
    }
  }
}

// 4. drl と keywordMap のキー整合
for (const [mod, m] of Object.entries(MODALITIES)) {
  for (const cat of Object.keys(m.drl)) check(cat in m.keywordMap, mod + ': keywordMap に ' + cat + ' がない');
  for (const cat of Object.keys(m.keywordMap)) check(cat in m.drl, mod + ': drl に ' + cat + ' がない');
}

console.log('\n  pass ' + pass + ' / fail ' + fail);
if (fail) { bad.forEach(b => console.log('  FAIL ' + b)); process.exit(1); }
console.log('  すべてのチェックを通過しました。');
