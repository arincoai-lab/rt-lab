#!/usr/bin/env node
/**
 * 散乱線シミュレータ（scatter-simulator/scatter-core.js）の回帰テスト。
 *
 *   node scripts/test-scatter-simulator.js
 *
 * 守りたいこと:
 *  1. 係数が原典の照合表（scripts/scatter-provenance.json）と一致する（コピーのずれを止める。
 *     2026-09-09 の DRL 事故は、同じ値が2か所で別々に古くなっていたのが原因）
 *  2. NCRP Report 147 第5章の計算例を再現する（原典の丸めた値に対し所定の幅で）
 *  3. 物理的にありえない値が出ない（負・NaN・壁の向こうが手前より高い・遠いほうが高い）
 *  4. 法令の参考線（実効線量 mSv）と比べる前に E/Ka（1.433 Sv/Gy）を掛ける。
 *     空気カーマ mGy のまま比べると約30% 低く見積もる（危険側）。独立レビュー 2026-11-16 の HIGH
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/scatter-provenance.json'), 'utf8'));
let core;
try {
  core = require(path.join(ROOT, 'scatter-simulator/scatter-core.js'));
} catch (e) {
  console.error('scatter-core.js を読み込めない: ' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('FAIL: ' + msg); }
}
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
const finitePos = v => Number.isFinite(v) && v >= 0;

// ---------------------------------------------------------------- 1. 照合表との一致
const K47 = prov.secondary_kerma_per_patient_1m.rows;
const ROOMS = Object.keys(K47);
check(ROOMS.length === 8, '照合表の部屋の種類は8つのはず');
for (const r of ROOMS) {
  const c = core.SECONDARY_PER_PATIENT[r];
  check(!!c, 'SECONDARY_PER_PATIENT に ' + r + ' が無い');
  if (!c) continue;
  for (const k of ['leak', 'side', 'fb']) check(c[k] === K47[r][k], r + '.' + k + ' が照合表と違う: ' + c[k] + ' vs ' + K47[r][k]);
  for (const m of ['lead', 'concrete', 'gypsum']) {
    const a = core.ARCHER_SECONDARY[m] && core.ARCHER_SECONDARY[m][r];
    const b = prov.secondary_transmission_archer[m][r];
    check(Array.isArray(a) && a.length === 3 && a.every((v, i) => v === b[i]), 'ARCHER_SECONDARY.' + m + '.' + r + ' が照合表と違う');
  }
}
for (const m of ['lead', 'concrete', 'gypsum']) check(JSON.stringify(core.SECONDARY_RANGE_MM[m]) === JSON.stringify(prov.secondary_transmission_archer.valid_range_mm[m]), '当てはめの範囲（' + m + '）が照合表と違う');
check(JSON.stringify(core.CT_RANGE_MM) === JSON.stringify({ lead: prov.ct.transmission_archer.valid_range.lead_mm, concrete: prov.ct.transmission_archer.valid_range.concrete_mm }), 'CT の当てはめの範囲が照合表と違う');
check(Object.keys(core.SECONDARY_PER_PATIENT).length === ROOMS.length, 'SECONDARY_PER_PATIENT に照合表に無い部屋がある');
for (const m of ['lead', 'concrete']) for (const kv of ['120', '140']) {
  const a = core.ARCHER_CT[m][kv], b = prov.ct.transmission_archer[m][kv];
  check(a.every((v, i) => v === b[i]), 'ARCHER_CT.' + m + '.' + kv + ' が照合表と違う');
}
check(core.CT.kappaHead === prov.ct.kappa.head_per_cm, 'κhead が照合表と違う');
check(core.CT.kappaBody === prov.ct.kappa.body_per_cm, 'κbody が照合表と違う');
check(core.CT.bodyFactor === prov.ct.kappa.body_factor, '体幹の 1.2 が照合表と違う');
check(core.E_OVER_KA === prov.japan_law.conversion_E_over_Ka_Sv_per_Gy.value, 'E/Ka が照合表と違う');
check(core.LEAKAGE_LIMIT.ncrp === 0.876 && core.LEAKAGE_LIMIT.japan === prov.japan_law.leakage_diagnostic_mGy_per_h_at_1m.value, '漏れ線の上限が照合表と違う');
const LAW = prov.japan_law;
check(core.REFERENCE_LINES.controlledAreaBoundary_mSv_per_3mo === LAW.controlled_area_boundary_mSv_per_3mo.value, '管理区域境界の値が照合表と違う');
check(core.REFERENCE_LINES.siteBoundary_mSv_per_3mo === LAW.site_boundary_uSv_per_3mo.value / 1000, '敷地境界の値が照合表と違う');
check(core.REFERENCE_LINES.inpatientRoom_mSv_per_3mo === LAW.inpatient_room_mSv_per_3mo.value, '病室の値が照合表と違う');
check(core.EYE_LENS_LIMIT.mSv_per_year === LAW.eye_lens_mSv.per_year && core.EYE_LENS_LIMIT.mSv_per_5yr === LAW.eye_lens_mSv.per_5yr, '水晶体の限度が照合表と違う');
check(!Object.keys(core.REFERENCE_LINES).some(k => /eye/i.test(k)), '水晶体（等価線量）が点の実効線量の参考線に混ざっている');
const H = prov.ivr_operator_eye;
check(core.IVR_EYE.weightedLeft === H.weighted_left_eye && core.IVR_EYE.weightedRight === H.weighted_right_eye, 'IVR の水晶体係数が照合表と違う');

// ---------------------------------------------------------------- 2. 透過の式
const B = core.archerTransmission, X = core.archerThickness;
for (const m of ['lead', 'concrete', 'gypsum']) for (const r of ROOMS) {
  const p = core.ARCHER_SECONDARY[m][r];
  check(B(0, p) === 1, m + '/' + r + ': 厚さ0で透過1でない');
  let prev = 1, mono = true;
  for (let x = 0.1; x <= (m === 'lead' ? 4 : 300); x *= 1.5) { const b = B(x, p); if (!(b < prev && b > 0)) mono = false; prev = b; }
  check(mono, m + '/' + r + ': 厚さとともに単調に減っていない');
  for (const t of [1e-1, 1e-2, 1e-3]) check(rel(B(X(t, p), p), t) < 1e-9, m + '/' + r + ': 逆関数が戻らない B=' + t);
}
check(B(-1, core.ARCHER_SECONDARY.lead.rad_room_all) === 1, '負の厚さは0として扱う');

// ---------------------------------------------------------------- 3. NCRP 147 の計算例
const EX = prov.ncrp_worked_examples;
{ // CT（DLP 法）
  const e = EX.ct_dlp_example;
  const kb = core.ctKermaPerProcedureAt1m({ type: 'body', dlp: e.dlp_body });
  const kh = core.ctKermaPerProcedureAt1m({ type: 'head', dlp: e.dlp_head });
  check(rel(kb, e.Ksec_body_mGy) < 0.03, 'CT 例: 体幹 ' + kb + ' vs ' + e.Ksec_body_mGy);
  check(rel(kh, e.Ksec_head_mGy) < 0.03, 'CT 例: 頭部 ' + kh + ' vs ' + e.Ksec_head_mGy);
  const weekly = (e.body_per_week * kb + e.head_per_week * kh) / 9;
  check(rel(weekly, e.weekly_at_3m_mGy) < 0.03, 'CT 例: 3 m の週あたり ' + weekly + ' vs ' + e.weekly_at_3m_mGy);
  const x = X(e.B, core.ARCHER_CT.lead['120']);
  check(Math.abs(x - e.lead_mm) < 0.1, 'CT 例: 鉛の厚さ ' + x + ' vs ' + e.lead_mm);
}
{ // CT（CTDI 法の例。B と厚さだけ）
  const e = EX.ct_cdti_example;
  const x = X(e.B, core.ARCHER_CT.lead['120']);
  check(Math.abs(x - e.lead_mm_120kVp) < 0.1, 'CT CTDI 例: 鉛の厚さ ' + x + ' vs ' + e.lead_mm_120kVp);
}
{ // 一般撮影の操作室（doseAtPoint で再現。管球は患者の上 1 m、操作室は横に 1.8 m、NCRP の距離のそろえ方）
  const e = EX.control_booth_example;
  const r = core.doseAtPoint({ x: 2 + e.d_m, y: 2.5, z: 1 }, { room: 'rad_room_all', patientsPerWeek: e.patients, leakageLimit: 'ncrp',
    patient: { x: 2, y: 2.5, z: 1 }, tube: { x: 2, y: 2.5, z: 2 } }, []);
  check(rel(r.total, e.K_mGy) < 0.03, '操作室例: K ' + r.total + ' vs ' + e.K_mGy);
  const x = X(e.B, core.ARCHER_SECONDARY.lead.rad_room_all);
  check(Math.abs(x - e.lead_mm_rad_room_all) < 0.1, '操作室例: 鉛の厚さ ' + x + ' vs ' + e.lead_mm_rad_room_all);
}

// ---------------------------------------------------------------- 4. 散乱の角度
const S = core.scatterPerPatientAt1m;
for (const r of ROOMS) {
  const t = K47[r];
  check(S(r, 90) === t.side, r + ': 90° で側方散乱の値でない');
  for (const th of [0, 30, 45, 135, 150, 180]) check(S(r, th) === t.fb, r + ': ' + th + '° で前方・後方散乱の値でない');
  let cont = true, prev = S(r, 0);
  for (let th = 0.5; th <= 180; th += 0.5) { const v = S(r, th); if (Math.abs(v - prev) > (t.fb - t.side) * 0.05 + 1e-15) cont = false; prev = v; }
  check(cont, r + ': 角度に対して不連続');
  for (let th = 0; th <= 180; th += 5) { const v = S(r, th); check(v >= t.side && v <= t.fb, r + ': ' + th + '° の値が側方〜前後方の範囲外'); }
}

// ---------------------------------------------------------------- 5. 部屋の中の線量
// 4 m × 5 m の部屋。患者 (2, 2.5, 1.0)、管球はその真下 (2, 2.5, 0.5)（アンダーチューブ）
const baseSetup = (over = {}) => Object.assign({
  room: 'cardiac_angio', patientsPerWeek: 20, leakageLimit: 'ncrp',
  patient: { x: 2, y: 2.5, z: 1.0 }, tube: { x: 2, y: 2.5, z: 0.5 },
}, over);
const noWalls = [];
const wallX4 = (mm, material = 'lead') => [{ x1: 4, y1: 0, x2: 4, y2: 5, layers: [{ material, mm }] }];
const D = core.doseAtPoint;

{
  const s = baseSetup();
  const a = D({ x: 3, y: 2.5, z: 1.0 }, s, noWalls), b = D({ x: 4, y: 2.5, z: 1.0 }, s, noWalls);
  check(finitePos(a.total) && finitePos(b.total), '線量が有限・非負でない');
  check(b.total < a.total, '遠いほうが高い');
  // 既定（NCRP）: 散乱線と漏れ線の距離を短いほう（患者から 1 m）にそろえる
  check(rel(a.total, (K47.cardiac_angio.side + K47.cardiac_angio.leak) * 20) < 1e-9, '側方 1 m の値が表と合わない（NCRP の距離）: ' + a.total);
  // 別々の距離: 漏れ線は管球から√(1+0.25) m
  const sep = D({ x: 3, y: 2.5, z: 1.0 }, baseSetup({ distanceMode: 'separate' }), noWalls);
  check(rel(sep.total, (K47.cardiac_angio.side + K47.cardiac_angio.leak / 1.25) * 20) < 1e-9, '側方 1 m の値が表と合わない（別々の距離）: ' + sep.total);
  check(sep.total <= a.total, 'NCRP の距離のそろえ方が別々の距離より低い');
  const as = D({ x: 3, y: 2.5, z: 1.0 }, baseSetup({ distanceMode: 'separate' }), noWalls), bs = D({ x: 4, y: 2.5, z: 1.0 }, baseSetup({ distanceMode: 'separate' }), noWalls);
  check(rel(as.scatter / bs.scatter, 4) < 1e-9, '散乱線が距離の2乗に反比例しない');
  check(a.flags.length === 0, '通常の点に注意フラグが付いた: ' + a.flags);
}
{ // 壁の向こうは手前より低い・厚いほど低い・斜めに通ると低い
  const s = baseSetup();
  const p = { x: 5, y: 2.5, z: 1.0 };
  const open = D(p, s, noWalls).total, thin = D(p, s, wallX4(0.5)).total, thick = D(p, s, wallX4(2)).total;
  check(thin < open && thick < thin, '壁の厚さに対して線量が減っていない');
  check(rel(D(p, s, wallX4(0.5)).scatter, D(p, s, noWalls).scatter * B(0.5, core.ARCHER_SECONDARY.lead.cardiac_angio)) < 1e-9, '垂直に通るときの透過が式と合わない');
  // 斜めに通るとき: 既定は垂直入射（NCRP 147）。obliquity=true なら 厚さ/|cos|（上限2倍）
  const pB = core.ARCHER_SECONDARY.lead.cardiac_angio;
  const pd = { x: 5, y: 4.5, z: 1.0 };
  const ratioN = D(pd, s, wallX4(0.5)).scatter / D(pd, s, noWalls).scatter;
  check(rel(ratioN, B(0.5, pB)) < 1e-9, '既定で垂直入射になっていない');
  const so = baseSetup({ obliquity: true });
  const pz = { x: 5, y: 3.5, z: 2.0 }; // 3D で斜め（z も違う）
  const v = { x: 3, y: 1, z: 1 }, cos = Math.abs(v.x) / Math.hypot(v.x, v.y, v.z);
  const ratioO = D(pz, so, wallX4(0.5)).scatter / D(pz, so, noWalls).scatter;
  check(rel(ratioO, B(0.5 / cos, pB)) < 1e-9, '斜めの厚さが 3D の式（厚さ/cos）と合わない');
  const longWall = [{ x1: 4, y1: 0, x2: 4, y2: 20, layers: [{ material: 'lead', mm: 0.5 }] }];
  const graze = { x: 4.05, y: 15, z: 1.0 }; // cos ≈ 0.16（補正なしなら約6倍の厚さ）
  const ratioG = D(graze, so, longWall).scatter / D(graze, so, noWalls).scatter;
  check(rel(ratioG, B(1.0, pB)) < 1e-9, 'かすめる線で斜め補正が2倍の上限で止まっていない: ' + ratioG);
  // 壁の端のわずかに手前で途切れる壁は効かない（端の判定を甘くしない）
  const nearly = [{ x1: 4, y1: 0, x2: 4, y2: 2.5 - 1e-7, layers: [{ material: 'lead', mm: 2 }] }];
  check(rel(D(p, s, nearly).total, open) < 1e-12, '線の手前で途切れる壁が効いている');
  const two = [{ x1: 4, y1: 0, x2: 4, y2: 5, layers: [{ material: 'lead', mm: 0.5 }, { material: 'concrete', mm: 100 }] }];
  check(D(p, s, two).total < thin, '複数の層が掛け合わされていない');
  const short = [{ x1: 4, y1: 0, x2: 4, y2: 1, layers: [{ material: 'lead', mm: 2 }] }]; // 線の通り道より外で途切れる壁
  check(rel(D(p, s, short).total, open) < 1e-12, '線の通り道に無い（端の外の）壁が効いている');
  // 壁の継ぎ目・角を通る線で二重に数えない（2026-11-16 レビュー C1）
  const split = [{ x1: 4, y1: 0, x2: 4, y2: 2.5, layers: [{ material: 'lead', mm: 0.5 }] }, { x1: 4, y1: 2.5, x2: 4, y2: 5, layers: [{ material: 'lead', mm: 0.5 }] }];
  check(rel(D(p, s, split).total, thin) < 1e-12, '分けて描いた壁の継ぎ目で二重に数えている');
  const corner = [{ x1: 3, y1: 3.5, x2: 3, y2: 6, layers: [{ material: 'lead', mm: 0.5 }] }, { x1: 3, y1: 3.5, x2: 6, y2: 3.5, layers: [{ material: 'lead', mm: 0.5 }] }];
  const pc = { x: 4, y: 4.5, z: 1.0 }; // 患者(2,2.5)→(4,4.5) は角 (3,3.5) を通る
  const one = [{ x1: 3, y1: 3.5, x2: 3, y2: 6, layers: [{ material: 'lead', mm: 0.5 }] }];
  check(rel(D(pc, s, corner).scatter, D(pc, s, one).scatter) < 1e-12, '壁の角を通る線で二重に数えている');
  // 漏れ線の線だけを遮る壁は漏れ線だけを減らす（管球 (2,2.5,0.5) → 点 (2,4,0.5) の間、患者からの線は通らない高さ）
  const sl = baseSetup({ distanceMode: 'separate', ceiling: 3 });
  const lowWallPt = { x: 2, y: 4, z: 0.2 };
  const lw = [{ x1: 0, y1: 3, x2: 4, y2: 3, layers: [{ material: 'lead', mm: 1 }] }];
  const r0 = D(lowWallPt, sl, noWalls), r1 = D(lowWallPt, sl, lw);
  check(r1.leakage < r0.leakage && r1.scatter < r0.scatter, '壁が散乱線・漏れ線の両方の線を遮っていない');
  check(rel(r1.leakage, r0.leakage * B(1, pB)) < 1e-9, '漏れ線の透過が管球からの線で計算されていない');
  // 管球が患者の横にある（横向きの照射）とき、管球→点の線だけを遮る短い壁
  const sx = { room: 'cardiac_angio', patientsPerWeek: 20, distanceMode: 'separate', patient: { x: 2, y: 2.5, z: 1 }, tube: { x: 1, y: 2.5, z: 1 } };
  const px = { x: 2, y: 4, z: 1 };
  const sw = [{ x1: 1.2, y1: 3, x2: 1.6, y2: 3, layers: [{ material: 'lead', mm: 1 }] }];
  const q0 = D(px, sx, noWalls), q1 = D(px, sx, sw);
  check(q1.scatter === q0.scatter && rel(q1.leakage, q0.leakage * B(1, pB)) < 1e-9, '漏れ線の透過が管球からの線で、散乱線の透過が患者からの線で計算されていない');
  // 天井より上（別の階）を通る線では壁を差し引かない
  const up = D({ x: 5, y: 2.5, z: 10 }, s, wallX4(0.5));
  check(up.flags.includes('beyond-ceiling') && rel(up.total, D({ x: 5, y: 2.5, z: 10 }, s, noWalls).total) < 1e-12, '天井より上を通る線で壁を差し引いている');
  check(D(p, s, wallX4(3.5)).flags.includes('extrapolated') && !D(p, s, wallX4(2.5)).flags.includes('extrapolated'), '一般撮影系の鉛 3 mm 超で外挿の印が付かない（または範囲内で付く）');
  check(D(p, s, wallX4(250, 'gypsum')).flags.includes('extrapolated') && !D(p, s, wallX4(150, 'gypsum')).flags.includes('extrapolated'), '石こうボード 200 mm 超で外挿の印が付かない');
  const behind = D({ x: 1, y: 2.5, z: 1.0 }, s, wallX4(2)).total;
  check(rel(behind, D({ x: 1, y: 2.5, z: 1.0 }, s, noWalls).total) < 1e-12, '線源と点の間に無い壁が効いている');
}
{ // 近すぎる点は 0.3 m に丸めてフラグ
  const s = baseSetup();
  const r = D({ x: 2.05, y: 2.5, z: 1.0 }, s, noWalls);
  check(r.flags.includes('near') && finitePos(r.total), '0.3 m 未満でフラグが付かない');
  const r0 = D({ x: 2, y: 2.5, z: 1.0 }, s, noWalls);
  check(finitePos(r0.total), '患者の位置ちょうどで NaN/Infinity');
}
{ // 漏れ線の上限（日本 1.0 mGy/h）
  const p = { x: 3, y: 2.5, z: 1.0 };
  const n = D(p, baseSetup({ leakageLimit: 'ncrp' }), noWalls), j = D(p, baseSetup({ leakageLimit: 'japan' }), noWalls);
  check(rel(j.leakage / n.leakage, 1.0 / 0.876) < 1e-9, '日本の漏れ線の上限で 1.0/0.876 倍になっていない');
  check(j.scatter === n.scatter, '漏れ線の上限が散乱線に効いている');
}
{ // 不正な入力
  let threw = false;
  try { D({ x: 3, y: 2.5, z: 1 }, baseSetup({ room: 'no_such_room' }), noWalls); } catch (e) { threw = true; }
  check(threw, '存在しない部屋の種類でエラーにならない');
  threw = false;
  try { D({ x: 5, y: 2.5, z: 1 }, baseSetup(), wallX4(1, 'unobtainium')); } catch (e) { threw = true; }
  check(threw, '存在しない材質でエラーにならない');
  // 空欄・null・文字列・NaN を黙って0にしない（レビュー H3）
  for (const bad of ['', null, '5', NaN, undefined, Infinity]) {
    threw = false; try { D({ x: 3, y: 2.5, z: 1 }, baseSetup({ patientsPerWeek: bad }), noWalls); } catch (e) { threw = true; }
    check(threw, '患者数 ' + JSON.stringify(bad) + ' でエラーにならない');
  }
  threw = false; try { D({ x: undefined, y: 2.5, z: 1 }, baseSetup(), noWalls); } catch (e) { threw = true; }
  check(threw, '点の x が無くてもエラーにならない');
  threw = false; try { D({ x: 5, y: 2.5, z: 1 }, baseSetup(), [{ x1: 4, y1: 0, x2: 4, y2: 5, layers: [{ material: 'lead', mm: '' }] }]); } catch (e) { threw = true; }
  check(threw, '壁の厚さが空欄でもエラーにならない');
  threw = false; try { D({ x: 3, y: 2.5, z: 1 }, baseSetup({ tube: { x: 2, y: 2.5, z: 1.0 } }), noWalls); } catch (e) { threw = true; }
  check(threw, '管球と患者が同じ位置でもエラーにならない');
  check(D({ x: 5, y: 2.5, z: 1 }, baseSetup(), [{ x1: 4, y1: 1, x2: 4, y2: 1, layers: [{ material: 'lead', mm: 3 }] }]).total > 0, '長さ0の壁で壊れる');
  const z = D({ x: 3, y: 2.5, z: 1 }, baseSetup({ patientsPerWeek: 0 }), noWalls);
  check(z.total === 0, '患者数0で線量が0でない');
  threw = false;
  try { D({ x: 3, y: 2.5, z: 1 }, baseSetup({ patientsPerWeek: -5 }), noWalls); } catch (e) { threw = true; }
  check(threw, '負の患者数でエラーにならない');
}

// ---------------------------------------------------------------- 5b. 一次線の方向（一般撮影）
{
  const s = { room: 'chest_room', patientsPerWeek: 50, patient: { x: 2, y: 2, z: 1.4 }, tube: { x: 2, y: 0.2, z: 1.4 } }; // 立位、y 方向に照射
  check(D({ x: 2, y: 4, z: 1.4 }, s, noWalls).flags.includes('primary-direction'), '一般撮影で受像器の裏（一次線の方向）に印が付かない');
  check(!D({ x: 4, y: 2, z: 1.4 }, s, noWalls).flags.includes('primary-direction'), '一次線の方向でない点に印が付いた');
  const a = { room: 'cardiac_angio', patientsPerWeek: 5, patient: { x: 2, y: 2, z: 1 }, tube: { x: 2, y: 2, z: 0.5 } };
  check(!D({ x: 2, y: 2, z: 2.5 }, a, noWalls).flags.includes('primary-direction'), '血管撮影（受像器が一次線を遮る前提）に印が付いた');
}
{ // 角度の補間の中間点
  for (const r of ROOMS) check(rel(S(r, 112.5), (K47[r].side + K47[r].fb) / 2) < 1e-12, r + ': 112.5° が側方と前後方の中間でない');
}

// ---------------------------------------------------------------- 6. CT
{
  const ct = { modality: 'ct', iso: { x: 2, y: 3, z: 1.0 }, kvp: '120', headPerWeek: 30, bodyPerWeek: 150, dlpHead: 1680, dlpBody: 770 };
  const r3 = D({ x: 5, y: 3, z: 1.0 }, ct, noWalls);
  check(rel(r3.total, EX.ct_dlp_example.weekly_at_3m_mGy) < 0.03, 'CT: 3 m の週あたりが NCRP 例と合わない: ' + r3.total);
  const r3b = D({ x: 2, y: 6, z: 1.0 }, ct, noWalls);
  check(rel(r3.total, r3b.total) < 1e-12, 'CT: 等方でない（NCRP は等方を仮定）');
  const w = D({ x: 5, y: 3, z: 1.0 }, ct, wallX4(1.5));
  check(rel(w.total, r3.total * B(1.5, core.ARCHER_CT.lead['120'])) < 1e-9, 'CT: 壁の透過に CT 用の係数が使われていない');
  let threw = false;
  try { D({ x: 5, y: 3, z: 1 }, ct, wallX4(12, 'gypsum')); } catch (e) { threw = true; }
  check(threw, 'CT: 係数の無い材質（石こうボード）でエラーにならない');
  threw = false;
  try { D({ x: 5, y: 3, z: 1 }, Object.assign({}, ct, { kvp: undefined }), noWalls); } catch (e) { threw = true; }
  check(threw, 'CT: 管電圧が空でも 120 kVp に黙って切り替わる');
  const w140 = D({ x: 5, y: 3, z: 1.0 }, Object.assign({}, ct, { kvp: '140' }), wallX4(1.5));
  check(rel(w140.total, r3.total * B(1.5, core.ARCHER_CT.lead['140'])) < 1e-9, 'CT: 140 kVp の透過係数が使われていない');
  const headOnly = D({ x: 5, y: 3, z: 1.0 }, Object.assign({}, ct, { bodyPerWeek: 0, dlpBody: undefined }), noWalls);
  check(rel(headOnly.total, 30 * 9e-5 * 1680 / 9) < 1e-9, 'CT: 頭部だけの計算');
  threw = false;
  try { D({ x: 5, y: 3, z: 1 }, Object.assign({}, ct, { dlpHead: NaN }), noWalls); } catch (e) { threw = true; }
  check(threw, 'CT: DLP が NaN でもエラーにならない（黙って0）');
  check(D({ x: 5, y: 3, z: 1.0 }, ct, wallX4(4)).flags.includes('extrapolated'), 'CT: 鉛 3 mm を超えても外挿の印が付かない');
  check(!D({ x: 5, y: 3, z: 1.0 }, ct, wallX4(2)).flags.includes('extrapolated'), 'CT: 範囲内で外挿の印が付いた');
}

// ---------------------------------------------------------------- 7. 法令の参考線との比較（実効線量に換算）
{
  const K = 1.0; // mGy / 週
  const E = core.toEffectiveDose_mSv(K);
  check(rel(E, 1.433) < 1e-12, '空気カーマ→実効線量で 1.433 が掛かっていない');
  const r = core.compareWithReference({ weekly_mGy: K, occupancy: 1 });
  check(rel(r.per3months_mSv, 1.433 * 13) < 1e-12, '3か月（13週）の実効線量が合わない');
  check(r.per3months_mSv > K * 13, '空気カーマのまま比べている（危険側）');
  check(rel(core.compareWithReference({ weekly_mGy: K, occupancy: 0.25 }).per3months_mSv, 1.433 * 13 * 0.25) < 1e-12, '滞在係数が掛かっていない');
  check(r.verdict === undefined && r.pass === undefined, '合否の判定を返している（D2: 判定はしない）');
  check(rel(r.perYear_mSv, 1.433 * 52) < 1e-12, '1年（52週）の実効線量が合わない');
  const rT = core.compareWithReference({ weekly_mGy: K, occupancy: 0.25 });
  check(rel(rT.per3months_mSv_T1, 1.433 * 13) < 1e-12, '滞在係数を掛けない値（T=1）も返していない');
  for (const bad of [null, '', NaN, 1.5, -0.1]) {
    let threw = false; try { core.compareWithReference({ weekly_mGy: K, occupancy: bad }); } catch (e) { threw = true; }
    check(threw, '滞在係数 ' + JSON.stringify(bad) + ' でエラーにならない（null は黙って0になる）');
  }
}

// ---------------------------------------------------------------- 8. IVR 術者の水晶体
{
  const e = core.ivrEyeDose_uGy({ kap_Gycm2: 100, eye: 'left' });
  check(rel(e, 339) < 1e-12, 'IVR: 左眼 3.39 µGy/(Gy·cm²) × 100 にならない');
  check(rel(core.ivrEyeDose_uGy({ kap_Gycm2: 100, eye: 'right' }), 232) < 1e-12, 'IVR: 右眼の係数');
  const sh = core.ivrEyeDose_uGy({ kap_Gycm2: 100, eye: 'left', ceilingShield: true, glasses: true });
  check(rel(sh, 339 * 0.25 * 0.7) < 1e-12, 'IVR: 防護の「少なくとも」の減り方（上限側の見積もり）になっていない');
  check(core.ivrEyeDose_uGy({ kap_Gycm2: 0, eye: 'left' }) === 0, 'IVR: KAP 0 で 0 でない');
}

// ---------------------------------------------------------------- 9. 画面の説明文の数値（照合表と一致）
{
  const html = fs.readFileSync(path.join(ROOT, 'scatter-simulator/index.html'), 'utf8');
  const m = html.match(/var ROOM_HINTS = \{([\s\S]*?)\n    \};/);
  check(!!m, 'index.html の ROOM_HINTS が見つからない');
  if (m) for (const r of ROOMS) {
    const h = (m[1].match(new RegExp(r + ": '([^']*)'")) || [])[1];
    check(!!h, 'ROOM_HINTS に ' + r + ' が無い');
    if (!h) continue;
    const w = parseFloat((h.match(/([\d.]+) mA·min/) || [])[1]);
    const dF = parseFloat((h.match(/（([\d.]+) m）/) || [])[1]);
    check(w === K47[r].Wnorm_mAmin, r + ': 画面の mA·min が照合表と違う: ' + w);
    check(dF === K47[r].dF_m, r + ': 画面の距離 dF が照合表と違う: ' + dF);
  }
  const d52 = prov.ct.default_dlp_table_5_2;
  check(html.includes("dlpHead: " + d52.head) && html.includes("dlpBody: " + d52.body_average), 'CT のひな形の DLP が Table 5.2 と違う');
  check(html.includes('頭部 1,200・体幹平均 550'), 'CT の DLP の説明が Table 5.2 と違う');
  check(!/pass|合格|不合格|適合/.test((html.match(/<table class="probes"[\s\S]*?<\/table>/) || [''])[0]), '測定点の表に合否の言葉がある');
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
