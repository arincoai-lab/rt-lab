#!/usr/bin/env node
/**
 * 海外旅行の被ばく線量（flight-dose/flight-core.js）の回帰テスト。
 *
 *   node scripts/test-flight-dose.js
 *
 * 守りたいこと:
 *  1. 線量率の格子に物理的にありえない値がない（NaN・負・範囲外）、照合表の範囲と一致する
 *  2. 計算の係数（飛行時間・上昇降下の倍率）が照合表（scripts/flight-dose-provenance.json）と一致する
 *  3. JISCARD との比の要約と画面の文言が一致する（照合用ファイルが手元にあれば 24 区間を計算し直し、比 0.90〜1.20・飛行時間 ±12%）
 *  4. 高緯度ほど線量率が高い（地磁気の効果。このアプリの主題）
 *  5. 経度 180° をまたいでも線量率と大円が連続する
 *  6. 行き先データの空港コードがすべて存在し、線量が 0 より大きく、乗り継ぎは区間の和になる
 *  7. 画面の比べるもの（胸部X線・自然放射線・CT・100 mSv）の定数が照合表と一致する
 *  8. どの空港からどの空港へも線量が計算でき、帰りは行きの逆ルート、渡航歴の合計は便の和
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/flight-dose-provenance.json'), 'utf8'));
const grid = JSON.parse(fs.readFileSync(path.join(ROOT, 'flight-dose/doserate-2025.json'), 'utf8'));
const places = JSON.parse(fs.readFileSync(path.join(ROOT, 'flight-dose/places.json'), 'utf8'));
let C;
try {
  C = require(path.join(ROOT, 'flight-dose/flight-core.js'));
} catch (e) {
  console.error('flight-core.js を読み込めない: ' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('FAIL: ' + msg); }
}

// 1. 格子
check(grid.values.length === grid.nlat * grid.nlon, `格子の点数 ${grid.values.length} ≠ ${grid.nlat}×${grid.nlon}`);
const vals = grid.values.map(v => v * grid.scale);
const bad = vals.filter(v => !Number.isFinite(v) || v < 0.5 || v > 10).length;
check(bad === 0, `ありえない線量率が ${bad} 点`);
const [lo, hi] = prov.doseRateGrid.range_uSvh;
check(Math.abs(Math.min(...vals) - lo) < 0.002 && Math.abs(Math.max(...vals) - hi) < 0.002,
  `格子の範囲 ${Math.min(...vals)}〜${Math.max(...vals)} が照合表 ${lo}〜${hi} と違う`);
check(grid.year === 2025 && grid.altKm === prov.doseRateGrid.altKm && grid.g === -11, '格子の条件（2025年・11 km・客室）が照合表と違う');

// 2. 係数
for (const k of ['speedKmh', 'windKmh', 'groundH'])
  check(C.FLIGHT_TIME[k] === prov.flightTime[k], `飛行時間の係数 ${k}: ${C.FLIGHT_TIME[k]} ≠ 照合表 ${prov.flightTime[k]}`);
check(C.RAMP_FACTOR === prov.rampFactor.value, `上昇降下の倍率 ${C.RAMP_FACTOR} ≠ 照合表 ${prov.rampFactor.value}`);

// 3. JISCARD との照合。JISCARD の出力はサイト規程で転載できないのでリポジトリに入れていない。
//    手元に照合用ファイルがあるときだけ全区間を計算し直し、照合表の要約（比の最小・最大・平均）と一致するか確かめる。
//    CI では要約と画面の文言の一致だけを見る。
const os = require('os');
const JIS_LOCAL = process.env.FLIGHT_DOSE_JISCARD || path.join(os.homedir(), 'Documents/Claude/plan/2026-11-17-flight-dose-jiscard-legs.json');
const jc = prov.jiscardComparison;
if (fs.existsSync(JIS_LOCAL)) {
  const loc = JSON.parse(fs.readFileSync(JIS_LOCAL, 'utf8'));
  const pt = c => ({ lat: loc.airports[c][0], lon: loc.airports[c][1] });
  const ratios = [];
  for (const leg of loc.legs) {
    const [a, b] = leg.route.split('-');
    const r = C.legDose(grid, pt(a), pt(b));
    const ratio = r.doseUSv / leg.jiscard.doseUSv;
    ratios.push(ratio);
    check(ratio >= 0.90 && ratio <= 1.20, `${leg.route}: 線量の比 ${ratio.toFixed(3)}`);
    check(Math.abs(r.hours / leg.jiscard.hours - 1) <= 0.12, `${leg.route}: 飛行時間の比 ${(r.hours / leg.jiscard.hours).toFixed(3)}`);
  }
  const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  check(ratios.length === jc.nLegs, `照合の区間数 ${ratios.length} ≠ ${jc.nLegs}`);
  check(Math.abs(Math.min(...ratios) - jc.doseRatio.min) < 0.0015 && Math.abs(Math.max(...ratios) - jc.doseRatio.max) < 0.0015 && Math.abs(mean - jc.doseRatio.mean) < 0.0015,
    `JISCARD との比 ${Math.min(...ratios).toFixed(3)}〜${Math.max(...ratios).toFixed(3)}（平均 ${mean.toFixed(3)}）が照合表の要約と違う`);
} else {
  console.log('（JISCARD の照合用ファイルがないので、全区間の再計算は飛ばす: ' + JIS_LOCAL + '）');
}
const pct = v => Math.round((v - 1) * 100);
const claim = `差は −${-pct(jc.doseRatio.min)}%〜+${pct(jc.doseRatio.max)}%（平均 +${pct(jc.doseRatio.mean)}%）`;
check(claim === jc.pageText, `照合表の要約から作った文言「${claim}」が pageText「${jc.pageText}」と違う`);
const page = fs.readFileSync(path.join(ROOT, 'flight-dose/index.html'), 'utf8');
check(page.includes(jc.pageText), `画面に「${jc.pageText}」がない（JISCARD との差の書き方が照合表とずれている）`);

// 4. 高緯度ほど高い（同じ経度で比べる）
const r0 = C.rateAt(grid, 0, 140), r35 = C.rateAt(grid, 35, 140), r65 = C.rateAt(grid, 65, -150);
check(r0 < r35 && r35 < r65, `緯度による差の向きがおかしい: 赤道 ${r0.toFixed(2)}・35° ${r35.toFixed(2)}・65° ${r65.toFixed(2)}`);
check(r65 / r0 > 2.5, `極域と赤道の比 ${(r65 / r0).toFixed(2)} が小さすぎる`);

// 5. 経度 180° の連続性
const e1 = C.rateAt(grid, 40, 179.9), e2 = C.rateAt(grid, 40, -179.9);
check(Math.abs(e1 - e2) < 0.01, `経度180°で線量率が飛ぶ: ${e1} / ${e2}`);
const hnl = C.greatCircle(places.airports.NRT, places.airports.HNL, 64);
let maxStep = 0;
for (let i = 1; i < hnl.length; i++) maxStep = Math.max(maxStep, C.distanceKm(hnl[i - 1], hnl[i]));
check(maxStep < 200, `大円の点の間隔が飛ぶ（${maxStep.toFixed(0)} km）`);

// 6. 行き先データ
for (const d of places.destinations) {
  check(places.airports[d.id], `行き先 ${d.id} の空港がない`);
  check(d.routes.length >= 1, `${d.id}: ルートがない`);
  for (const route of d.routes) {
    check(route[0] === places.origin && route[route.length - 1] === d.id, `${d.id}: ルート ${route.join('-')} の両端が違う`);
    const stops = route.map(c => places.airports[c]);
    check(stops.every(Boolean), `${d.id}: ルート ${route.join('-')} に知らない空港`);
    if (!stops.every(Boolean)) continue;
    const r = C.routeDose(grid, stops);
    check(r.doseUSv > 0 && Number.isFinite(r.doseUSv), `${route.join('-')}: 線量 ${r.doseUSv}`);
    const sum = r.legs.reduce((s, l) => s + l.doseUSv, 0);
    check(Math.abs(sum - r.doseUSv) < 1e-9, `${route.join('-')}: 区間の和と合計が違う`);
    for (const l of r.legs) {
      const last = l.samples[l.samples.length - 1];
      check(Math.abs(last.cum - l.doseUSv) < 1e-9, `${route.join('-')}: アニメーション用の累積の最後が線量と違う`);
    }
  }
}
// 主題: 欧州は乗り継ぎ（ドバイ経由）の方が直行より少ない
const lhr = places.destinations.find(d => d.id === 'LHR');
const direct = C.routeDose(grid, lhr.routes[0].map(c => places.airports[c]));
const viaDxb = C.routeDose(grid, lhr.routes[1].map(c => places.airports[c]));
check(viaDxb.doseUSv < direct.doseUSv && viaDxb.hours > direct.hours, 'ロンドン: ドバイ経由が「長いのに少ない」にならない');

// 8. 続けて飛ぶ（どの空港からどの空港へも計算できる）・帰りのルート・渡航歴の合計
const codes = Object.keys(places.airports);
let pairs = 0, badPair = 0;
for (const a of codes) for (const b of codes) {
  if (a === b) { check(C.routeOptions(places, a, b).length === 0, `${a}→${a}: 同じ空港へのルートがある`); continue; }
  const opts = C.routeOptions(places, a, b);
  check(opts.length >= 1 && opts.every(r => r[0] === a && r[r.length - 1] === b), `${a}→${b}: ルートの両端が違う`);
  const fromOrigin = a === places.origin && places.destinations.some(d => d.id === b);
  const toOrigin = b === places.origin && places.destinations.some(d => d.id === a);
  // 決まったルートがない組み合わせ（外国→外国など）は直行便1本だけ
  if (!fromOrigin && !toOrigin) check(opts.length === 1 && opts[0].length === 2, `${a}→${b}: 直行便1本になっていない`);
  try {
    const r = C.routeDose(grid, opts[0].map(c => places.airports[c]));
    pairs++;
    if (!(Number.isFinite(r.doseUSv) && r.doseUSv > 0 && r.hours > 0)) badPair++;
  } catch (e) { badPair++; }
}
check(badPair === 0, `空港の組み合わせ ${pairs} 組のうち ${badPair} 組で線量が計算できない`);
for (const d of places.destinations) {
  const back = C.routeOptions(places, d.id, places.origin);
  check(back.length === d.routes.length && back.every((r, k) => r.join('-') === d.routes[k].slice().reverse().join('-')),
    `${d.id}→東京: 帰りのルートが行きのルートの逆になっていない`);
}
const trip = [['NRT', 'DXB', 'LHR'], ['LHR', 'DXB', 'NRT'], ['NRT', 'HNL']].map(r => C.routeDose(grid, r.map(c => places.airports[c])));
const tot = C.journeyTotals(trip);
check(tot.flights === 3 && Math.abs(tot.doseUSv - trip.reduce((s, r) => s + r.doseUSv, 0)) < 1e-9
  && Math.abs(tot.hours - trip.reduce((s, r) => s + r.hours, 0)) < 1e-9, '渡航歴の合計が便の和にならない');
check(C.journeyTotals([]).doseUSv === 0, '空の渡航歴の合計が 0 でない');
check(Math.abs(C.EARTH_CIRCUMFERENCE_KM - 40030) < 50, `地球一周 ${C.EARTH_CIRCUMFERENCE_KM} km がおかしい`);

// 7. 比べるもの: 画面の定数（index.html）が照合表と一致する
const cmp = prov.comparisons;
const konst = name => { const m = page.match(new RegExp('const ' + name + ' = ([^;]+);')); return m ? m[1].trim() : null; };
check(Number(konst('CHEST_USV')) === cmp.chestXray.mSv * 1000, `画面の CHEST_USV ${konst('CHEST_USV')} ≠ 照合表 ${cmp.chestXray.mSv} mSv`);
check(Number(konst('NATURAL_JP_USV_Y')) === cmp.naturalJapan.mSv * 1000, `画面の NATURAL_JP_USV_Y ${konst('NATURAL_JP_USV_Y')} ≠ 照合表 ${cmp.naturalJapan.mSv} mSv`);
check(konst('CT_USV') === `[${cmp.ctRange.mSvMin * 1000}, ${cmp.ctRange.mSvMax * 1000}]`, `画面の CT_USV ${konst('CT_USV')} ≠ 照合表 ${cmp.ctRange.mSvMin}〜${cmp.ctRange.mSvMax} mSv`);
check(Number(konst('HEALTH_USV')) === cmp.health100.mSv * 1000, `画面の HEALTH_USV ${konst('HEALTH_USV')} ≠ 照合表 ${cmp.health100.mSv} mSv`);
check(cmp.chestXray.mSv === 0.08 && cmp.naturalJapan.mSv === 2.1 && cmp.naturalWorld.mSv === 2.4 && cmp.ctRange.mSvMin === 0.06 && cmp.ctRange.mSvMax === 17 && cmp.health100.mSv === 100,
  '照合表の比べるものの値が、原典で確かめた値（0.08・2.1・2.4・0.06〜17・100 mSv）から変わっている');

console.log(`test-flight-dose: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
