#!/usr/bin/env node
/**
 * contrast-simulator の薬物動態モデル（runSimulationCore）の回帰テスト。
 *
 *   node scripts/test-contrast-simulator.js
 *
 * 2026-10-08: 生食後押しを 30 mL にしても 1 mL にしても結果が完全一致し、肝実質のピークが
 * 計算範囲の端（299 秒）に張り付いていた。原因は ①注入したヨードを右心へ直接足していて
 * 腕の静脈（死腔）が無く、生食＝何もしないのと同じだった ②全身の血管外細胞外液と腎排泄が
 * 無く、血中濃度が下がらないまま肝の血管外腔が埋まり続けた ③臓器のCT値を組織全体ではなく
 * 造影剤の入れる空間で割っていて、肝が文献値の2倍超になっていた。同種の再発を防ぐ。
 *
 * 数値は一点に合わせ込まず、文献の範囲で検査する（モデルは教育用の近似）。
 *  - 肝ピーク: Bae 1998（125 mL ioversol-320）でシミュレーション 63.6〜63.8 HU、実測 59.8〜60.8 HU
 *  - 平衡相の肝/大動脈比: 肝 ECV 約26%・Hct 0.4 → 0.26/0.6 ≈ 0.43
 *  - 生食後押し: 短いボーラス（5 mL/s×10 s）で大動脈ピーク約14%増（Bayer/Medrad のモデル）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const html = fs.readFileSync(path.join(ROOT, 'contrast-simulator/index.html'), 'utf8');
const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1])
  .find(s => s.includes('function runSimulationCore'));
if (!src) { console.error('runSimulationCore が見つからない'); process.exit(1); }

const noop = () => {};
const ctx = { document: { addEventListener: noop, getElementById: () => null }, window: { addEventListener: noop } };
vm.createContext(ctx);
vm.runInContext(src + '\n;this.__api = { runSimulationCore, T_MAX, ORGANS };', ctx);
const { runSimulationCore, T_MAX, ORGANS } = ctx.__api;

// ページ側のプリセットをそのまま使う（プリセットを足したらテスト対象にも入る）
function extractPresets(firstKey) {
  const m = src.match(new RegExp('const presets = \\{\\s*' + firstKey + ':[\\s\\S]*?\\n  \\};'));
  if (!m) throw new Error('presets（' + firstKey + '）が見つからない');
  return vm.runInNewContext(m[0].replace('const presets =', '(') .replace(/;$/, ')'));
}
const PROTOCOLS = extractPresets('chest');
const PATIENTS = extractPresets('small');
const AGENT_CONC = { '300': 300, '350': 350, '370': 370, '300b': 300, '350b': 350 };

let pass = 0, fail = 0;
const bad = [];
function check(ok, label) { if (ok) pass++; else { fail++; bad.push(label); } }

const run = (phases, weight = 60, co = 5.0, conc = 350, kvp = 120) =>
  runSimulationCore(weight, co, conc, phases, kvp);
function peak(r, key) {
  const d = r.results[key];
  let p = -Infinity, idx = 0;
  for (let i = 0; i < d.length; i++) if (d[i] > p) { p = d[i]; idx = i; }
  return { hu: p, t: r.timePoints[idx], idx };
}
const at = (r, key, t) => r.results[key][r.timePoints.findIndex(x => x >= t)];
const withSaline = (ml, rate = 3, vol = 100) =>
  ml > 0 ? [{ type: 'contrast', rate, volume: vol }, { type: 'saline', rate, volume: ml }]
         : [{ type: 'contrast', rate, volume: vol }];
const fmt = x => (Math.round(x * 10) / 10).toString();

// ── 1. 生食後押しが結果に効くこと ──
{
  const pk = ml => peak(run(withSaline(ml)), 'aorta').hu;
  const p0 = pk(0), p1 = pk(1), p10 = pk(10), p30 = pk(30), p60 = pk(60);
  check(Math.abs(p30 - p1) > 1, `生食 1 mL と 30 mL で大動脈ピークが変わらない（${fmt(p1)} vs ${fmt(p30)} HU）`);
  check(p30 > p0 * 1.02, `生食 30 mL で大動脈ピークが2%以上上がらない（なし ${fmt(p0)} → 30 mL ${fmt(p30)} HU）`);
  check(p0 <= p1 + 1e-6 && p1 <= p10 + 1e-6 && p10 <= p30 + 1e-6,
    `生食を増やすと大動脈ピークが下がる（0/1/10/30 mL: ${[p0, p1, p10, p30].map(fmt).join('/')}）`);
  check(Math.abs(p60 - p30) / p30 < 0.005,
    `死腔を押し切った後（30→60 mL）も結果が動く（${fmt(p30)} vs ${fmt(p60)} HU）`);

  const lv = ml => peak(run(withSaline(ml)), 'liverParenchyma').hu;
  check(lv(30) > lv(0), `生食で肝実質ピークが上がらない（なし ${fmt(lv(0))} / 30 mL ${fmt(lv(30))} HU）`);

  // 短いボーラス 50 mL@5 mL/s (370) ＋生食 30 mL@5 mL/s: 大動脈ピーク 3〜25% 増（Bayer/Medrad のモデルで 14%）
  const s0 = peak(run([{ type: 'contrast', rate: 5, volume: 50 }], 60, 5.0, 370), 'aorta').hu;
  const s1 = peak(run([{ type: 'contrast', rate: 5, volume: 50 }, { type: 'saline', rate: 5, volume: 30 }], 60, 5.0, 370), 'aorta').hu;
  const gain = s1 / s0 - 1;
  check(gain > 0.03 && gain < 0.25, `短いボーラスでの生食の効果が範囲外（+${fmt(gain * 100)}%、期待 3〜25%）`);
}

// ── 2〜6. プリセット×体格の全組み合わせで物理的に妥当なこと ──
const cases = [{ name: '既定', phases: withSaline(30), conc: 350, weight: 60, co: 5.0 }];
for (const [pk, p] of Object.entries(PROTOCOLS)) {
  for (const [ptk, pt] of Object.entries(PATIENTS)) {
    cases.push({ name: `${pk}/${ptk}`, phases: p.phases, conc: AGENT_CONC[p.agent], weight: pt.weight, co: pt.co });
  }
}
for (const c of cases) {
  const r = run(c.phases, c.weight, c.co, c.conc);
  const last = r.timePoints.length - 1;

  // 2. どの臓器もピークが計算範囲の端に無い（端なら本当のピークは範囲外）
  for (const key of Object.keys(ORGANS)) {
    const p = peak(r, key);
    check(p.idx < last - 5, `${c.name}: ${ORGANS[key].label} のピークが計算範囲の端（${p.t} s）`);
  }

  // 3. ヨードの物質収支: 注入量 = 体内 + 腎排泄 + 腕の静脈内
  const expected = c.phases.filter(ph => ph.type === 'contrast').reduce((s, ph) => s + ph.volume * c.conc, 0);
  const io = r.iodine;
  if (!io) { check(false, `${c.name}: iodine（物質収支）が返らない`); }
  else {
    check(Math.abs(io.injected - expected) / expected < 1e-3, `${c.name}: 注入ヨード量 ${io.injected} mg ≠ ${expected} mg`);
    const err = Math.abs(io.injected - (io.inBody + io.excreted + io.inArmVein)) / io.injected;
    check(err < 0.005, `${c.name}: 物質収支が合わない（誤差 ${fmt(err * 100)}%）`);
    check(io.excreted > 0, `${c.name}: 腎排泄が 0`);
  }

  // 4. 平衡相（180 s）の肝/大動脈比 0.35〜0.55（肝 ECV 約26%・Hct 0.4 → 約0.43）
  const ratio = at(r, 'liverParenchyma', 180) / at(r, 'aorta', 180);
  check(ratio > 0.35 && ratio < 0.55, `${c.name}: 180 s の肝/大動脈比 ${fmt(ratio)}（期待 0.35〜0.55）`);

  // 5. 順序: 門脈ピーク < 大動脈ピーク、時刻は 大動脈 < 門脈 < 肝実質
  const pa = peak(r, 'aorta'), pp = peak(r, 'portalVein'), pl = peak(r, 'liverParenchyma');
  check(pp.hu < pa.hu * 0.85, `${c.name}: 門脈ピーク ${fmt(pp.hu)} HU が大動脈 ${fmt(pa.hu)} HU に近すぎる`);
  check(pa.t < pp.t && pp.t <= pl.t, `${c.name}: ピーク時刻の順序（大動脈 ${pa.t} / 門脈 ${pp.t} / 肝 ${pl.t} s）`);

  // 6. 値が有限で負にならない
  const allOk = Object.keys(ORGANS).every(k => r.results[k].every(v => Number.isFinite(v) && v >= 0));
  check(allOk, `${c.name}: NaN・無限大・負の値がある`);
}

// ── 7. Bae 1998 の条件（125 mL ioversol-320）で肝ピーク 45〜75 HU、速度に鈍感 ──
{
  const lo = run([{ type: 'contrast', rate: 2, volume: 125 }], 72, 5.0, 320);
  const hi = run([{ type: 'contrast', rate: 5, volume: 125 }], 72, 5.0, 320);
  const l2 = peak(lo, 'liverParenchyma').hu, l5 = peak(hi, 'liverParenchyma').hu;
  check(l2 > 45 && l2 < 75, `Bae条件 2 mL/s の肝ピーク ${fmt(l2)} HU（期待 45〜75）`);
  check(l5 > 45 && l5 < 75, `Bae条件 5 mL/s の肝ピーク ${fmt(l5)} HU（期待 45〜75）`);
  check(l5 / l2 > 0.9 && l5 / l2 < 1.2, `肝ピークが注入速度に敏感すぎる（2→5 mL/s: ${fmt(l2)}→${fmt(l5)} HU）`);
  check(peak(hi, 'aorta').hu > peak(lo, 'aorta').hu * 1.2, '注入速度を上げても大動脈ピークが上がらない');
}

// ── 8. 大動脈ピークは注入終了の後・15秒以内 ──
{
  const r = run(withSaline(30));
  const end = 100 / 3;
  const t = peak(r, 'aorta').t;
  check(t >= end && t <= end + 15, `大動脈ピーク ${t} s が注入終了 ${fmt(end)} s の後15秒以内にない`);
}

// ── 9. 計算範囲の終端（T_MAX 秒）にも値がある（スキャン時刻の上限で 0 HU にならない） ──
{
  const r = run(withSaline(30));
  check(r.timePoints[r.timePoints.length - 1] === T_MAX, `最後の時刻 ${r.timePoints[r.timePoints.length - 1]} s が T_MAX ${T_MAX} s でない`);
  check(at(r, 'aorta', T_MAX) > 0, `T_MAX ${T_MAX} s の大動脈が 0 HU`);
}

// ── 10. 入力の端（体重・心拍出量の上下限）でも破綻しない ──
for (const [w, co] of [[20, 15], [200, 1], [20, 1], [200, 15]]) {
  const r = run(withSaline(30), w, co);
  const ok = Object.keys(ORGANS).every(k => r.results[k].every(v => Number.isFinite(v) && v >= 0));
  check(ok, `体重 ${w} kg・CO ${co} L/min で NaN・負の値`);
  if (r.iodine) {
    const err = Math.abs(r.iodine.injected - (r.iodine.inBody + r.iodine.excreted + r.iodine.inArmVein)) / r.iodine.injected;
    check(err < 0.005, `体重 ${w} kg・CO ${co} L/min で物質収支の誤差 ${fmt(err * 100)}%`);
  }
}

console.log(`contrast-simulator: ${pass} pass, ${fail} fail`);
if (fail) { for (const b of bad) console.log('  FAIL ' + b); process.exit(1); }
