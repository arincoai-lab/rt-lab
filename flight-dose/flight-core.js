/**
 * 海外旅行の被ばく線量（教育・娯楽用）の計算の中身。画面は持たない純粋な関数だけ。
 * ブラウザでは window.FlightCore、Node では require() で使う。
 *
 * 線量率は、JAEA の PARMA 4.19（EXPACS と同じモデル）で計算した「高度 11 km・客室内の実効線量率
 * （ICRP 116）・2025 年の月平均の太陽活動で12か月平均」の 2° 格子（doserate-2025.json）から読む。
 * 格子の作り方は scripts/flight-dose/README.md、JISCARD（QST）との照合は scripts/flight-dose-provenance.json。
 *
 * 飛行のモデル（単純化）:
 *  - 出発地と到着地を大円（地球上の最短ルート）で結ぶ。実際の航路とは違うことがある。
 *  - 飛行時間 = 距離 ÷（巡航の対地速度 + 偏西風の効果 × 東向きの割合）+ 地上近くの時間。
 *    係数は JISCARD の 24 区間の飛行時間に合わせたもの（FLIGHT_TIME）。
 *  - 離陸後 15 分と着陸前 20 分は上昇・降下中として、巡航中の線量率の RAMP_FACTOR 倍にする
 *    （PARMA で高度 0→11 km を直線で上がったときの平均。緯度により 0.28〜0.32）。
 * これは目安を出すための模型で、個人の線量評価には使えない。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlightCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const R_EARTH_KM = 6371.0;
  const CLIMB_H = 15 / 60;
  const DESCENT_H = 20 / 60;
  const RAMP_FACTOR = 0.3;
  // 飛行時間の係数（JISCARD との照合で決めた値。scripts/flight-dose-provenance.json の flightTime と一致させる）
  const FLIGHT_TIME = { speedKmh: 865, windKmh: 50, groundH: 0.8 };

  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const wrapLon = lon => ((lon + 540) % 360) - 180;

  function toVec(p) {
    const la = rad(p.lat), lo = rad(p.lon);
    return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  }
  function fromVec(v) {
    const n = Math.hypot(v[0], v[1], v[2]);
    return { lat: deg(Math.asin(v[2] / n)), lon: deg(Math.atan2(v[1], v[0])) };
  }

  /** 2点間の中心角（ラジアン） */
  function centralAngle(a, b) {
    const va = toVec(a), vb = toVec(b);
    const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
    return Math.acos(dot);
  }
  /** 大円距離（km） */
  function distanceKm(a, b) { return centralAngle(a, b) * R_EARTH_KM; }

  /** 大円上で a から b へ割合 f（0..1）だけ進んだ点 */
  function interpolate(a, b, f) {
    const om = centralAngle(a, b);
    if (om < 1e-9) return { lat: a.lat, lon: a.lon };
    const va = toVec(a), vb = toVec(b);
    const s = Math.sin(om);
    if (s < 1e-9) throw new Error('出発地と到着地が地球のちょうど反対側で、最短ルートが1本に決まらない');
    const k1 = Math.sin((1 - f) * om) / s, k2 = Math.sin(f * om) / s;
    return fromVec([k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]]);
  }

  /** 大円の点列（n+1 点）。地図に線を引くのにも使う */
  function greatCircle(a, b, n = 64) {
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push(interpolate(a, b, i / n));
    return pts;
  }

  /** 進む向き（北=0°、東=90°） */
  function bearing(a, b) {
    const la1 = rad(a.lat), la2 = rad(b.lat), dl = rad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /** 経路のうち東向きに進む割合の平均（-1=真西、+1=真東）。偏西風の効果に使う */
  function eastwardFraction(a, b, n = 32) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const p = interpolate(a, b, i / n), q = interpolate(a, b, (i + 1) / n);
      s += Math.sin(rad(bearing(p, q)));
    }
    return s / n;
  }

  /** 飛行時間（時間）。距離と東向きの割合から */
  function flightTimeH(a, b) {
    const d = distanceKm(a, b);
    const e = eastwardFraction(a, b);
    return d / (FLIGHT_TIME.speedKmh + FLIGHT_TIME.windKmh * e) + FLIGHT_TIME.groundH;
  }

  /** 格子の線量率（μSv/h）。緯度・経度の双線形補間。経度は 180° をまたいでつなぐ */
  function rateAt(grid, lat, lon) {
    const { lat0, dlat, nlat, lon0, dlon, nlon, values, scale } = grid;
    let y = (Math.max(-90, Math.min(90, lat)) - lat0) / dlat;
    y = Math.max(0, Math.min(nlat - 1, y));
    let x = (wrapLon(lon) - lon0) / dlon;
    x = ((x % nlon) + nlon) % nlon;
    const y0 = Math.min(nlat - 2, Math.floor(y)), fy = y - y0;
    const x0 = Math.floor(x) % nlon, x1 = (x0 + 1) % nlon, fx = x - Math.floor(x);
    const v = (j, i) => values[j * nlon + i] * scale;
    return (v(y0, x0) * (1 - fx) + v(y0, x1) * fx) * (1 - fy) + (v(y0 + 1, x0) * (1 - fx) + v(y0 + 1, x1) * fx) * fy;
  }

  /** 時刻 t（時間）での線量率の倍率（上昇・降下中は RAMP_FACTOR） */
  function profileFactor(t, T) {
    if (T <= CLIMB_H + DESCENT_H) return RAMP_FACTOR;
    return (t < CLIMB_H || t > T - DESCENT_H) ? RAMP_FACTOR : 1;
  }

  /**
   * 1区間の線量。返り値:
   *  { distanceKm, hours, doseUSv, maxRate, samples: [{t, lat, lon, rate, cum}] }
   * samples はアニメーション（線量計の針）に使う。cum は累積 μSv。
   */
  function legDose(grid, a, b, n = 240) {
    const T = flightTimeH(a, b);
    const dt = T / n;
    let cum = 0, maxRate = 0;
    const samples = [{ t: 0, lat: a.lat, lon: a.lon, rate: 0, cum: 0 }];
    for (let i = 0; i < n; i++) {
      const tm = (i + 0.5) * dt;                 // 中点則
      const p = interpolate(a, b, tm / T);
      const cruise = rateAt(grid, p.lat, p.lon);
      const r = cruise * profileFactor(tm, T);
      cum += r * dt;
      if (cruise > maxRate) maxRate = cruise;
      const q = interpolate(a, b, (i + 1) / n);
      samples.push({ t: (i + 1) * dt, lat: q.lat, lon: q.lon, rate: r, cum });
    }
    return { distanceKm: distanceKm(a, b), hours: T, doseUSv: cum, maxRate, samples };
  }

  /** 複数区間（乗り継ぎ）。stops は空港の配列 [出発, 経由..., 到着] */
  function routeDose(grid, stops) {
    const legs = [];
    for (let i = 0; i + 1 < stops.length; i++) legs.push(legDose(grid, stops[i], stops[i + 1]));
    return {
      legs,
      hours: legs.reduce((s, l) => s + l.hours, 0),
      doseUSv: legs.reduce((s, l) => s + l.doseUSv, 0),
      distanceKm: legs.reduce((s, l) => s + l.distanceKm, 0),
    };
  }

  /** 「◯時間◯分」 */
  function formatHours(h) {
    const m = Math.round(h * 60);
    return `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, '0')}分`;
  }

  return {
    R_EARTH_KM, CLIMB_H, DESCENT_H, RAMP_FACTOR, FLIGHT_TIME,
    distanceKm, interpolate, greatCircle, bearing, eastwardFraction, flightTimeH,
    rateAt, profileFactor, legDose, routeDose, formatHours, wrapLon,
  };
});
