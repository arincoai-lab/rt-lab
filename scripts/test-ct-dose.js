#!/usr/bin/env node
// ct-dose-estimator の SSDE 換算係数が原典（AAPM Report 204 Table 1D / Report 293 Eq.1）と
// 一致していることを検査する。照合表は scripts/ssde-provenance.json。
// 2026-11-16 まで、ページには原典と一致しない表が入っていた（成人体幹部（実効径 25〜45 cm）で SSDE を2〜5割低く出した）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ct-dose-estimator/index.html'), 'utf8');
const prov = JSON.parse(fs.readFileSync(path.join(__dirname, 'ssde-provenance.json'), 'utf8'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; console.log('  FAIL: ' + msg); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── ページのスクリプトから定義を取り出す（中かっこの対応で切り出す）──
function extract(startPattern) {
  const m = startPattern.exec(html);
  if (!m) return null;
  const open = html.indexOf('{', m.index);
  let depth = 0;
  for (let i = open; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) return html.slice(m.index, i + 1); }
  }
  return null;
}
const parts = [
  ['SSDE_TABLE_32', /const SSDE_TABLE_32\s*=/],
  ['SSDE_HEAD_293', /const SSDE_HEAD_293\s*=/],
  ['REGIONS', /const REGIONS\s*=/],
  ['effectiveDiameter', /function effectiveDiameter\s*\(/],
  ['interpolate', /function interpolate\s*\(/],
  ['getSsdeFactor', /function getSsdeFactor\s*\(/],
  ['ssdeRangeNote', /function ssdeRangeNote\s*\(/],
];
const src = [];
for (const [name, re] of parts) {
  const code = extract(re);
  ok(code !== null, `ページに ${name} の定義がある`);
  if (code) src.push(code + ';');
}
if (fail > 0) {
  console.log(`\nct-dose: ${pass} pass, ${fail} fail`);
  process.exit(1);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.join('\n') +
  '\nthis.T32 = SSDE_TABLE_32; this.H = SSDE_HEAD_293; this.getSsdeFactor = getSsdeFactor; this.ssdeRangeNote = ssdeRangeNote; this.REGIONS = REGIONS; this.effectiveDiameter = effectiveDiameter;', ctx);
const { T32, H, getSsdeFactor, ssdeRangeNote, REGIONS, effectiveDiameter } = ctx;

// ── 1. 照合表そのものの健全性 ──
const pt = prov.body32.table;
const diams = Object.keys(pt).map(Number).sort((a, b) => a - b);
ok(diams.length === 38 && diams[0] === 8 && diams[37] === 45, '照合表は 8〜45 cm の 38 点');
diams.forEach((d, i) => {
  if (i > 0) ok(pt[d] < pt[diams[i - 1]], `照合表は単調減少（${d} cm）`);
  const fit = prov.body32.fitCheck.a * Math.exp(-prov.body32.fitCheck.b * d);
  ok(near(pt[d], fit, prov.body32.fitCheck.tolerance), `照合表 ${d} cm = ${pt[d]} は Report 204 の近似式 ${fit.toFixed(3)} と整合`);
});

// ── 2. ページの 32 cm 表 = 照合表（全点・過不足なし）──
ok(Array.isArray(T32.diam) && Array.isArray(T32.f) && T32.diam.length === T32.f.length, 'SSDE_TABLE_32 の diam と f の長さが同じ');
ok(T32.diam.length === diams.length, `SSDE_TABLE_32 は ${diams.length} 点（実際 ${T32.diam.length} 点）`);
diams.forEach((d) => {
  const i = T32.diam.indexOf(d);
  ok(i >= 0 && T32.f[i] === pt[d], `32 cm 表 ${d} cm: ページ ${i >= 0 ? T32.f[i] : 'なし'} / 原典 ${pt[d]}`);
});
T32.diam.forEach((d) => ok(pt[d] !== undefined, `ページの ${d} cm は原典の表にある径`));

// ── 3. 頭部は Report 293 の式 ──
ok(H.a === prov.head16.a && H.b === prov.head16.b, `頭部の係数 a=${H.a}, b=${H.b} が Report 293 Eq.1 と一致`);
for (const d of [10.6, 12, 14, 16, 18, 20.2]) {
  const want = prov.head16.a * Math.exp(-prov.head16.b * d);
  ok(near(getSsdeFactor(16, d), want, 1e-9), `頭部 Dw ${d} cm の係数が式どおり（${want.toFixed(3)}）`);
}
ok(near(getSsdeFactor(16, 16), 0.912, 0.001), '頭部 16 cm で f ≈ 0.912');

// ── 4. 計算結果（補間・端の扱い）──
ok(getSsdeFactor(32, 32) === 1.14, '体幹部 32 cm で f = 1.14');
ok(getSsdeFactor(32, 20) === 1.78, '体幹部 20 cm で f = 1.78');
ok(near(getSsdeFactor(32, 26.5), 1.40, 0.001), '体幹部 26.5 cm で f = 1.40（1.43 と 1.37 の中間）');
ok(near(getSsdeFactor(32, 26.5) * 10, 14.0, 0.01), 'CTDIvol 10 mGy・実効径 26.5 cm で SSDE 14.0 mGy');
ok(getSsdeFactor(32, 5) === 2.76 && getSsdeFactor(32, 60) === 0.71, '表の外は端の値で止める（外挿しない）');
for (let d = 8; d <= 45; d += 0.25) {
  const f = getSsdeFactor(32, d);
  const fit = prov.body32.fitCheck.a * Math.exp(-prov.body32.fitCheck.b * d);
  ok(near(f, fit, 0.015), `補間値 ${d} cm = ${f.toFixed(3)} が近似式 ${fit.toFixed(3)} から外れない`);
}

// ── 5. 範囲外の注意 ──
ok(ssdeRangeNote(32, 26.5) === '', '体幹部の範囲内では注意を出さない');
ok(ssdeRangeNote(32, 7.9) !== '' && ssdeRangeNote(32, 45.1) !== '', '体幹部 8〜45 cm の外で注意を出す');
ok(ssdeRangeNote(16, 16) === '', '頭部の範囲内では注意を出さない');
ok(ssdeRangeNote(16, 10) !== '' && ssdeRangeNote(16, 21) !== '', '頭部 10.6〜20.2 cm の外で注意を出す');

// ── 6. 部位とファントム径の対応・実効径の式 ──
const wantPhantom = { head: 16, 'ped-head': 16, chest: 32, abdomen: 32, 'chest-abdomen': 32, 'ped-abdomen': 32 };
ok(Object.keys(REGIONS).sort().join() === Object.keys(wantPhantom).sort().join(), '部位は6つ（増減したらこのテストも見直す）');
for (const k of Object.keys(wantPhantom)) {
  ok(REGIONS[k] && REGIONS[k].phantom === wantPhantom[k], `${k} は ${wantPhantom[k]} cm ファントム基準`);
}
ok(near(effectiveDiameter(22, 32), Math.sqrt(22 * 32), 1e-12) && near(effectiveDiameter(22, 32), 26.533, 0.001), '実効径 = √(AP×LAT)（22×32 → 26.53 cm）');
ok(H.dwMin === prov.head16.dataRangeCm[0] && H.dwMax === prov.head16.dataRangeCm[1], '頭部のデータ範囲が照合表と一致');
ok(/id="sizeFactorInfo"/.test(html), '換算係数の表示欄（#sizeFactorInfo）がある（無いと計算が止まる）');
ok(/id="phantomBasisHint"/.test(html), 'CTDIvol のファントム基準の注意書きがある');

// ── 7. 訂正の告知（見える文）と、その数値 ──
// スクリプト・スタイル・コメントを除いた「見える部分」だけを対象にする
const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<!--[\s\S]*?-->/g, '');
const nStart = visible.indexOf('id="correction-notice"');
ok(nStart >= 0, '訂正の告知（#correction-notice）がある');
const nEnd = visible.indexOf('<!-- end', nStart) >= 0 ? visible.indexOf('<!-- end', nStart) : visible.indexOf('検査部位選択', nStart);
const notice = nStart >= 0 ? visible.slice(nStart, nEnd > nStart ? nEnd : nStart + 4000).replace(/<[^>]+>/g, '') : '';
ok(/2026年11月/.test(notice), '告知に修正の年月がある');
// 修正前の表（2026-03〜2026-11 に公開されていた値。告知の「修正前」の数値の根拠としてここに固定する）
const OLD32 = { d: [8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50],
  f: [3.04, 2.70, 2.40, 2.13, 1.90, 1.69, 1.50, 1.34, 1.19, 1.06, 0.94, 0.84, 0.75, 0.67, 0.59, 0.53, 0.47, 0.42, 0.37, 0.33, 0.30, 0.27] };
const OLD16 = { d: [8, 10, 12, 14, 16, 18, 20, 22, 24], f: [1.57, 1.43, 1.31, 1.19, 1.09, 1.00, 0.92, 0.84, 0.78] };
function oldF(t, x) {
  for (let i = 0; i < t.d.length - 1; i++) {
    if (x >= t.d[i] && x <= t.d[i + 1]) return t.f[i] + (x - t.d[i]) / (t.d[i + 1] - t.d[i]) * (t.f[i + 1] - t.f[i]);
  }
  return NaN;
}
const pair = (a, b) => `${a.toFixed(2)} → 正しくは ${b.toFixed(2)}`;
const pairShort = (a, b) => `${a.toFixed(2)} → ${b.toFixed(2)}`;
ok(notice.includes('20 cm で換算係数 ' + pair(oldF(OLD32, 20), getSsdeFactor(32, 20))), '告知: 体幹部 20 cm の修正前後');
ok(notice.includes('28 cm で ' + pairShort(oldF(OLD32, 28), getSsdeFactor(32, 28))), '告知: 体幹部 28 cm の修正前後');
ok(notice.includes('36 cm で ' + pairShort(oldF(OLD32, 36), getSsdeFactor(32, 36))), '告知: 体幹部 36 cm の修正前後');
ok(notice.includes('8 cm で ' + pairShort(oldF(OLD32, 8), getSsdeFactor(32, 8))), '告知: 体幹部 8 cm の修正前後');
ok(notice.includes('12 cm で換算係数 ' + pair(oldF(OLD16, 12), getSsdeFactor(16, 12))), '告知: 頭部 12 cm の修正前後');
ok(notice.includes('16 cm で ' + pairShort(oldF(OLD16, 16), getSsdeFactor(16, 16))), '告知: 頭部 16 cm の修正前後');
ok(notice.includes(`修正前は ${(oldF(OLD32, 26.5) * 10).toFixed(1)} mGy、修正後は ${(getSsdeFactor(32, 26.5) * 10).toFixed(1)} mGy`), '告知: 例（26.5 cm・10 mGy）の修正前後');
// 「13 cm 以上で低く、12 cm 以下で高く」の向き
for (let d = 13; d <= 45; d++) ok(oldF(OLD32, d) < getSsdeFactor(32, d), `修正前の体幹部は ${d} cm で低かった`);
for (let d = 8; d <= 12; d++) ok(oldF(OLD32, d) > getSsdeFactor(32, d), `修正前の体幹部は ${d} cm で高かった`);
for (let d = 8; d <= 24; d++) ok(oldF(OLD16, d) > getSsdeFactor(16, d), `修正前の頭部は ${d} cm で高かった`);
ok(/Table 1D/.test(visible), '見える文に出典の表（Table 1D）の記載がある');
ok(/Report 293/.test(visible), '見える文に頭部の出典（Report 293）の記載がある');

console.log(`\nct-dose: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
