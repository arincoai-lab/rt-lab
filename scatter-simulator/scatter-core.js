/**
 * 散乱線シミュレータ（教育用）の計算の中身。画面は持たない純粋な関数だけ。
 * ブラウザでは window.ScatterCore、Node では require() で使う。
 *
 * 考え方は NCRP Report No. 147（2004）と同じ:
 *   - 患者を散乱線の点線源、管球を漏れ線の点線源とみなし、距離の2乗で弱める
 *   - 1 m・1患者あたりの値は NCRP 147 Table 4.7（部屋の種類ごとの平均的な撮影条件込み）
 *   - 壁の透過は Archer の式（Table C.1。二次線＝漏れ線＋散乱線の全体に使う）
 *   - CT は DLP × κ（Eq. 5.10）、等方（NCRP 自身の仮定。実際はガントリ面で小さい）
 * 係数はすべて scripts/scatter-provenance.json と一致していなければならない
 * （scripts/test-scatter-simulator.js が検査する）。値を変えるときは照合表と原典を先に直す。
 *
 * これは教育用の目安で、法令に基づく遮へい計算・作業環境測定の代わりにはならない。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ScatterCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // NCRP 147 Table 4.7: 未遮へいの二次線空気カーマ（mGy/患者、1 m）。side=90°、fb=135°（30° の前方にも安全側として使う）
  const SECONDARY_PER_PATIENT = {
    rad_room_all:         { leak: 5.3e-4, side: 3.4e-2, fb: 4.8e-2 },
    rad_room_chest_bucky: { leak: 3.9e-4, side: 4.9e-3, fb: 6.9e-3 },
    rad_room_floor:       { leak: 1.4e-4, side: 2.3e-2, fb: 3.3e-2 },
    fluoro_tube_rf:       { leak: 1.2e-2, side: 3.1e-1, fb: 4.4e-1 },
    rad_tube_rf:          { leak: 9.4e-4, side: 2.8e-2, fb: 3.9e-2 },
    chest_room:           { leak: 3.8e-4, side: 2.3e-3, fb: 3.2e-3 },
    cardiac_angio:        { leak: 8.8e-2, side: 2.6,    fb: 3.7 },
    peripheral_angio:     { leak: 3.4e-3, side: 6.6e-1, fb: 9.5e-1 },
  };

  // NCRP 147 Table C.1: 二次線の透過の当てはめ係数 [α, β, γ]（mm^-1, mm^-1, -）
  const ARCHER_SECONDARY = {
    lead: {
      rad_room_all: [2.298, 1.738e1, 6.193e-1], rad_room_chest_bucky: [2.256, 1.380e1, 8.837e-1], rad_room_floor: [2.513, 1.734e1, 4.994e-1],
      fluoro_tube_rf: [2.322, 1.291e1, 7.575e-1], rad_tube_rf: [2.272, 1.360e1, 7.184e-1], chest_room: [2.288, 9.848, 1.054],
      cardiac_angio: [2.354, 1.494e1, 7.481e-1], peripheral_angio: [2.661, 1.954e1, 5.094e-1],
    },
    concrete: {
      rad_room_all: [3.610e-2, 1.433e-1, 5.600e-1], rad_room_chest_bucky: [3.560e-2, 1.079e-1, 7.705e-1], rad_room_floor: [3.920e-2, 1.464e-1, 4.486e-1],
      fluoro_tube_rf: [3.630e-2, 9.360e-2, 5.955e-1], rad_tube_rf: [3.560e-2, 1.114e-1, 6.620e-1], chest_room: [3.640e-2, 6.590e-2, 7.543e-1],
      cardiac_angio: [3.710e-2, 1.067e-1, 5.733e-1], peripheral_angio: [4.219e-2, 1.559e-1, 4.472e-1],
    },
    gypsum: {
      rad_room_all: [1.380e-2, 5.700e-2, 7.937e-1], rad_room_chest_bucky: [1.270e-2, 4.450e-2, 1.049], rad_room_floor: [1.640e-2, 6.080e-2, 7.472e-1],
      fluoro_tube_rf: [1.330e-2, 4.100e-2, 9.566e-1], rad_tube_rf: [1.290e-2, 4.570e-2, 9.355e-1], chest_room: [1.300e-2, 2.970e-2, 1.195],
      cardiac_angio: [1.390e-2, 4.640e-2, 9.185e-1], peripheral_angio: [1.747e-2, 6.422e-2, 7.299e-1],
    },
  };

  // NCRP 147 Fig. A.2（鉛）・A.3（コンクリート）: CT の二次線
  const ARCHER_CT = {
    lead: { '120': [2.246, 5.73, 0.547], '140': [2.009, 3.99, 0.342] },
    concrete: { '120': [0.0383, 0.0142, 0.658], '140': [0.0336, 0.0122, 0.519] },
  };

  // NCRP 147 Eq. 5.5・5.10。κ は cm^-1（DLP は mGy·cm）
  const CT = { kappaHead: 9e-5, kappaBody: 3e-4, bodyFactor: 1.2 };

  // 空気カーマ → 実効線量（Sv/Gy）。医薬発第188号（医政発0331第16号で改正）: 80 kV を超える装置は最大値 1.433
  const E_OVER_KA = 1.433;

  // 漏れ線の上限（mGy/h、焦点から1 m）。Table 4.7 は NCRP の 0.876 が前提。日本は医療法施行規則 第30条第1項第1号ホで 1.0
  const LEAKAGE_LIMIT = { ncrp: 0.876, japan: 1.0 };

  // 医療法施行規則の限度（参考線。判定には使わない）
  const REFERENCE_LINES = {
    controlledAreaBoundary_mSv_per_3mo: 1.3, // 第30条の26第3項第1号
    siteBoundary_mSv_per_3mo: 0.25,          // 第30条の26第4項（250 µSv）
    inpatientRoom_mSv_per_3mo: 1.3,          // 第30条の19
    eyeLens_mSv_per_year: 50,                // 第30条の27第2項第1号（5年で100）
  };

  // Hulthén 2024: 心臓 IVR 術者の水晶体の吸収線量/KAP（µGy/(Gy·cm²)）。投影の使用割合で重み付け。
  // 天吊り防護板なし・下半身の防護のみでの測定。防護板は「少なくとも75%」、眼鏡は「少なくとも30%」減らす（原典）
  const IVR_EYE = { weightedLeft: 3.39, weightedRight: 2.32, ceilingShieldFactor: 0.25, glassesFactor: 0.7 };

  const WEEKS_PER_3_MONTHS = 13;
  const MIN_DISTANCE_M = 0.3;

  /** Archer の式（NCRP 147 Eq. A.2）。x は mm。厚さ0以下は透過1 */
  function archerTransmission(x, p) {
    const [a, b, g] = p;
    if (!(x > 0)) return 1;
    return Math.pow((1 + b / a) * Math.exp(a * g * x) - b / a, -1 / g);
  }

  /** 逆関数（Eq. A.3）: 透過 B に必要な厚さ（mm） */
  function archerThickness(B, p) {
    const [a, b, g] = p;
    if (!(B > 0) || B >= 1) return 0;
    return Math.log((Math.pow(B, -g) + b / a) / (1 + b / a)) / (a * g);
  }

  /** 散乱角 θ（度、0=前方、180=管球側）での 1 m・1患者あたりの散乱線。
   *  90° は表の側方、|θ−90| ≥ 45° は表の前後方。その間は線形につなぐ（不連続にしない、安全側） */
  function scatterPerPatientAt1m(room, thetaDeg) {
    const t = SECONDARY_PER_PATIENT[room];
    if (!t) throw new Error('部屋の種類が不明: ' + room);
    const w = Math.min(1, Math.abs(thetaDeg - 90) / 45);
    if (w === 0) return t.side;
    if (w === 1) return t.fb;
    return t.side + (t.fb - t.side) * w;
  }

  /** CT 1検査あたりの 1 m の二次線空気カーマ（mGy）。type: 'head' | 'body'、dlp: mGy·cm */
  function ctKermaPerProcedureAt1m({ type, dlp }) {
    if (!(dlp >= 0)) throw new Error('DLP が不正: ' + dlp);
    if (type === 'head') return CT.kappaHead * dlp;
    if (type === 'body') return CT.bodyFactor * CT.kappaBody * dlp;
    throw new Error('CT の検査の種類が不明: ' + type);
  }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) }; }
  function norm(v) { return Math.hypot(v.x, v.y, v.z); }

  /** 線源 s から点 p への直線が横切る壁の層を集め、透過を掛け合わせる。
   *  壁は床から天井までの垂直な面（平面図上の線分）。斜めに通ると実効の厚さは 厚さ/|cos| */
  function wallTransmission(s, p, walls, paramsFor) {
    let B = 1;
    const d = sub(p, s), L = norm(d);
    if (L === 0) return 1;
    for (const w of walls || []) {
      const ex = w.x2 - w.x1, ey = w.y2 - w.y1;
      const den = d.x * ey - d.y * ex;
      if (den === 0) continue; // 平行
      const t = ((w.x1 - s.x) * ey - (w.y1 - s.y) * ex) / den; // 線源→点の上の位置
      const u = ((w.x1 - s.x) * d.y - (w.y1 - s.y) * d.x) / den; // 壁の上の位置
      if (!(t > 0 && t < 1 && u >= 0 && u <= 1)) continue;
      const wl = Math.hypot(ex, ey);
      const cos = Math.abs((d.x * ey - d.y * ex) / wl) / L; // 壁の法線（水平）と光線のなす角
      for (const layer of w.layers || []) {
        const params = paramsFor(layer.material);
        if (!params) throw new Error('この線源に使える透過の係数が無い材質: ' + layer.material);
        if (!(layer.mm >= 0)) throw new Error('壁の厚さが不正: ' + layer.mm);
        B *= archerTransmission(layer.mm / Math.max(cos, 1e-3), params);
      }
    }
    return B;
  }

  function distanceClamped(a, b, flags) {
    const d = norm(sub(a, b));
    if (d < MIN_DISTANCE_M) { if (!flags.includes('near')) flags.push('near'); return MIN_DISTANCE_M; }
    return d;
  }

  /**
   * 点 p の週あたりの空気カーマ（mGy/週）。
   * setup（一般撮影・透視・血管撮影）:
   *   { room, patientsPerWeek, leakageLimit: 'japan'|'ncrp', patient:{x,y,z}, tube:{x,y,z} }
   * setup（CT）:
   *   { modality:'ct', iso:{x,y,z}, kvp:'120'|'140', headPerWeek, bodyPerWeek, dlpHead, dlpBody }
   * walls: [{ x1, y1, x2, y2, layers:[{ material:'lead'|'concrete'|'gypsum', mm }] }]（座標は m）
   * 返り値: { total, scatter, leakage, flags }（flags: 'near' = 0.3 m 未満を 0.3 m に丸めた）
   */
  function doseAtPoint(p, setup, walls) {
    const flags = [];
    if (setup.modality === 'ct') {
      const kv = String(setup.kvp || '120');
      if (!ARCHER_CT.lead[kv]) throw new Error('CT の管電圧は 120 か 140: ' + kv);
      for (const k of ['headPerWeek', 'bodyPerWeek']) if (!(setup[k] >= 0)) throw new Error(k + ' が不正: ' + setup[k]);
      const k1 = setup.headPerWeek * ctKermaPerProcedureAt1m({ type: 'head', dlp: setup.dlpHead || 0 }) +
                 setup.bodyPerWeek * ctKermaPerProcedureAt1m({ type: 'body', dlp: setup.dlpBody || 0 });
      const d = distanceClamped(p, setup.iso, flags);
      const B = wallTransmission(setup.iso, p, walls, m => ARCHER_CT[m] && ARCHER_CT[m][kv]);
      const total = k1 / (d * d) * B; // κ は小さな漏れ線を含む（NCRP 147）
      return { total, scatter: total, leakage: 0, flags };
    }

    const room = setup.room;
    const t = SECONDARY_PER_PATIENT[room];
    if (!t) throw new Error('部屋の種類が不明: ' + room);
    const N = setup.patientsPerWeek;
    if (!(N >= 0)) throw new Error('患者数が不正: ' + N);
    const limit = LEAKAGE_LIMIT[setup.leakageLimit || 'japan'];
    if (!limit) throw new Error('漏れ線の上限の指定が不明: ' + setup.leakageLimit);
    const paramsFor = m => ARCHER_SECONDARY[m] && ARCHER_SECONDARY[m][room];

    // 散乱角: 管球→患者（一次線の向き）と 患者→点 のなす角
    const beam = sub(setup.patient, setup.tube), toP = sub(p, setup.patient);
    const nb = norm(beam), np = norm(toP);
    let theta = 90;
    if (nb > 0 && np > 0) {
      const c = (beam.x * toP.x + beam.y * toP.y + beam.z * toP.z) / (nb * np);
      theta = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
    }
    const dS = distanceClamped(p, setup.patient, flags);
    const dL = distanceClamped(p, setup.tube, flags);
    const scatter = N * scatterPerPatientAt1m(room, theta) / (dS * dS) * wallTransmission(setup.patient, p, walls, paramsFor);
    const leakage = N * t.leak * (limit / LEAKAGE_LIMIT.ncrp) / (dL * dL) * wallTransmission(setup.tube, p, walls, paramsFor);
    return { total: scatter + leakage, scatter, leakage, flags };
  }

  /** 空気カーマ（mGy）→ 実効線量（mSv）。管電圧によらず最大値 1.433 を使う（80 kV 以下では安全側） */
  function toEffectiveDose_mSv(kerma_mGy) { return kerma_mGy * E_OVER_KA; }

  /** 法令の参考線と並べるための換算。合否は返さない（判定はしない） */
  function compareWithReference({ weekly_mGy, occupancy = 1 }) {
    if (!(weekly_mGy >= 0) || !(occupancy >= 0 && occupancy <= 1)) throw new Error('入力が不正');
    const weekly_mSv = toEffectiveDose_mSv(weekly_mGy) * occupancy;
    return {
      weekly_mSv,
      per3months_mSv: weekly_mSv * WEEKS_PER_3_MONTHS,
      perYear_mSv: weekly_mSv * 52,
      lines: Object.assign({}, REFERENCE_LINES),
    };
  }

  /** IVR 術者の水晶体の吸収線量（µGy）。防護は原典の「少なくとも」の減り方なので、結果は上限側の見積もり */
  function ivrEyeDose_uGy({ kap_Gycm2, eye = 'left', ceilingShield = false, glasses = false }) {
    if (!(kap_Gycm2 >= 0)) throw new Error('KAP が不正: ' + kap_Gycm2);
    const cc = eye === 'right' ? IVR_EYE.weightedRight : IVR_EYE.weightedLeft;
    return cc * kap_Gycm2 * (ceilingShield ? IVR_EYE.ceilingShieldFactor : 1) * (glasses ? IVR_EYE.glassesFactor : 1);
  }

  return {
    SECONDARY_PER_PATIENT, ARCHER_SECONDARY, ARCHER_CT, CT, E_OVER_KA, LEAKAGE_LIMIT, REFERENCE_LINES, IVR_EYE,
    WEEKS_PER_3_MONTHS, MIN_DISTANCE_M,
    archerTransmission, archerThickness, scatterPerPatientAt1m, ctKermaPerProcedureAt1m,
    wallTransmission, doseAtPoint, toEffectiveDose_mSv, compareWithReference, ivrEyeDose_uGy,
  };
});
