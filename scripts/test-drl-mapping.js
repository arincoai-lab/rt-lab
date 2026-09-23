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

  // 2026-09-23: scripts/jev-drl-oracle.js（判定モデルによる第二意見）で見つかった誤マッピング。
  // 上4件は「より緩い判定（＝高いDRL）」に倒れる向きで、2026-09-09 に直したものと同じ種類。
  ['ct', '尿路結石 単純', EXCLUDE_LABEL],          // '単純' 単独で頭部（67/1260）に落ちていた
  ['ct', '頭部CTA 脳動脈瘤', EXCLUDE_LABEL],       // 単純の区分しか無いのに頭部単純に落ちていた
  ['ct', '頭部単純', '頭部単純ルーチン'],
  ['general', '膝関節正面', EXCLUDE_LABEL],        // '正面' 単独で胸部（0.3）に落ちていた
  ['general', '股関節正面', EXCLUDE_LABEL],
  ['general', '頚椎側面', EXCLUDE_LABEL],          // 頚椎に側面の区分は無い。正面（0.5）に吸われていた
  ['general', '頚椎正面', '頚椎正面'],
  ['general', '胸部正面 120kV', '胸部正面（100kV以上）'],  // 数値表記のkVを読めず 100kV未満（0.3）にしていた
  ['general', 'CHEST PA 120kV', '胸部正面（100kV以上）'],
  ['general', '胸部立位正面 125kV', '胸部正面（100kV以上）'],
  ['general', '胸部正面 80kV', '胸部正面（100kV未満）'],
  ['general', '検診胸部 120kV', '検診胸部正面（100kV以上）'],
  ['general', '健診 胸部正面', '検診胸部正面（100kV以上）'],
  ['ivr', '腹部大動脈瘤 ステントグラフト', 'EVAR'],        // 'ステント' で非CTO PCI（1300）に吸われていた
  ['ivr', '肺動静脈奇形 塞栓 simple', 'PAVM simple type'], // 脳動静脈奇形（3700）に吸われていた
  ['ivr', 'TEVAR', 'TEVAR'],                              // 'EVAR' が部分一致し同点で（対象外）だった
  ['ivr', 'EVAR', 'EVAR'],
  ['ivr', '心臓カテーテル検査（診断）', '診断カテーテル検査（心臓）'],
  ['ivr', '未破裂動脈瘤 コイリング', '脳血管内治療：嚢状動脈瘤'],
  ['ivr', '髄膜腫 栄養血管塞栓', '脳血管内治療：頭蓋内腫瘍'],
  ['nm', 'MIBGシンチ 123I', EXCLUDE_LABEL],        // 収載外の薬剤が '123I' で IMP（200 MBq）に吸われていた
  ['nm', 'DATスキャン イオフルパン', EXCLUDE_LABEL],
  ['nm', 'IMP SPECT 安静', '脳血流：123I-IMP（安静あるいは負荷1回のみ）'],
  ['nm', '123I-IMP 安静+負荷', '脳血流：123I-IMP（安静+負荷）'],
  ['general', '胸部 100kV未満', '胸部正面（100kV未満）'],  // kVの数値正規表現が「100kV未満」表記に当たらないこと
  ['general', '胸部 100kV以上', '胸部正面（100kV以上）'],
  ['nm', 'MIBI rest and stress', '心筋血流：99mTc-MIBI（安静+負荷）'],  // 英語表記の負荷ありを安静のみにしない
  ['nm', 'tetrofosmin rest and stress', '心筋血流：99mTc-tetrofosmin（安静+負荷）'],
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

// 5. 可視のDRL値一覧が MODALITIES と一致しているか（ドリフト検知）
//    表を手書きすると医療数値のコピーが2つになる。生成物と再生成結果を突き合わせて
//    片方だけ古くなる事故（2026-09-09のDRL値不一致と同型）を機械的に止める。
const gen = require('./generate-drl-table.js');
const gi = html.indexOf(gen.START), gj = html.indexOf(gen.END);
check(gi >= 0 && gj >= 0, '可視DRL表のマーカー（DRL-TABLE:START/END）がページに無い');
if (gi >= 0 && gj >= 0) {
  const actual = html.slice(gi, gj + gen.END.length);
  check(
    actual === gen.render(MODALITIES),
    '可視のDRL値一覧が MODALITIES と一致しない。node scripts/generate-drl-table.js を実行してコミットすること'
  );
  const rendered = (actual.match(/<th scope="row">/g) || []).length;
  check(rendered === nValues, '可視表の行数 ' + rendered + ' が DRL値の数 ' + nValues + ' と一致しない');
}

console.log('\n  pass ' + pass + ' / fail ' + fail);
if (fail) { bad.forEach(b => console.log('  FAIL ' + b)); process.exit(1); }
console.log('  すべてのチェックを通過しました。');
