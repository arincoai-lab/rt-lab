/**
 * 散乱線シミュレータ（教育用）の計算の中身。画面は持たない純粋な関数だけ。
 * ブラウザでは window.ScatterCore、Node では require() で使う。
 *
 * 考え方は NCRP Report No. 147（2004）と同じ:
 *   - 患者を散乱線の点線源、管球を漏れ線の点線源とみなし、距離の2乗で弱める
 *   - 1 m・1患者あたりの値は NCRP 147 Table 4.7（部屋の種類ごとの平均的な撮影条件込み）
 *   - 壁の透過は Archer の式（Table C.1。二次線＝漏れ線＋散乱線の全体に使う）。NCRP と同じく垂直入射とみなす
 *   - 一次線（利用線錐）は扱わない。一般撮影で線錐の方向の点には 'primary-direction' の印を付ける
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
  };
  // 従事者の水晶体の等価線量限度（点の実効線量とは量が違うので別に持つ）。第30条の27第2項第1号
  const EYE_LENS_LIMIT = { mSv_per_year: 50, mSv_per_5yr: 100 };

  // Hulthén 2024: 心臓 IVR 術者の水晶体の吸収線量/KAP（µGy/(Gy·cm²)）。投影の使用割合で重み付け。
  // 天吊り防護板なし・下半身の防護のみでの測定。防護板は「少なくとも75%」、眼鏡は「少なくとも30%」減らす（原典）
  const IVR_EYE = { weightedLeft: 3.39, weightedRight: 2.32, ceilingShieldFactor: 0.25, glassesFactor: 0.7 };

  const WEEKS_PER_3_MONTHS = 13;
  const MIN_DISTANCE_M = 0.3;
  const DEFAULT_CEILING_M = 3.0;
  // 一次線が当たりうる一般撮影系（透視・血管撮影は受像器が一次線を遮る前提）
  const RADIOGRAPHIC_ROOMS = ['rad_room_all', 'rad_room_chest_bucky', 'rad_room_floor', 'rad_tube_rf', 'chest_room'];
  const PRIMARY_DIRECTION_DEG = 30; // NCRP が前方散乱とする角度より内側
  const OBLIQUITY_MAX_FACTOR = 2;   // 斜め補正を選んだときの上限（cos ≥ 0.5）

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

  /** 入力の数値を厳しく検査する（空欄・null・文字列・NaN を黙って0にしない） */
  function num(v, name, min = -Infinity) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min) throw new Error(name + ' が不正: ' + v);
    return v;
  }
  function pt(v, name) {
    if (!v || typeof v !== 'object') throw new Error(name + ' が不正');
    return { x: num(v.x, name + '.x'), y: num(v.y, name + '.y'), z: v.z === undefined ? 0 : num(v.z, name + '.z') };
  }

  /** CT 1検査あたりの 1 m の二次線空気カーマ（mGy）。type: 'head' | 'body'、dlp: mGy·cm（その管電圧での値） */
  function ctKermaPerProcedureAt1m({ type, dlp }) {
    num(dlp, 'DLP', 0);
    if (type === 'head') return CT.kappaHead * dlp;
    if (type === 'body') return CT.bodyFactor * CT.kappaBody * dlp;
    throw new Error('CT の検査の種類が不明: ' + type);
  }

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
  function norm(v) { return Math.hypot(v.x, v.y, v.z); }

  /** 線源 s から点 p への直線が横切る壁の層の透過を掛け合わせる。
   *  壁は床（z=0）から天井（ceiling）までの垂直な面（平面図上の線分）。天井より上・床より下で交わる壁は無視し 'beyond-ceiling' の印。
   *  既定は垂直入射（NCRP 147: 常に垂直入射を仮定）。opts.obliquity=true なら 厚さ/|cos|（上限2倍）。
   *  同じ位置（t がほぼ同じ）で複数の壁に当たるとき（壁の継ぎ目・角）は、透過の最も大きい1つだけを掛ける（二重に数えない、安全側）。
   *  当てはめの厚さの範囲（ranges）を超えたら 'extrapolated' の印。 */
  function wallTransmission(s, p, walls, paramsFor, opts = {}, flags = []) {
    const d = sub(p, s), L = norm(d);
    if (L === 0) return 1;
    const ceiling = opts.ceiling === undefined ? DEFAULT_CEILING_M : num(opts.ceiling, 'ceiling', 0);
    const hits = [];
    for (const w of walls || []) {
      const x1 = num(w.x1, 'wall.x1'), y1 = num(w.y1, 'wall.y1'), x2 = num(w.x2, 'wall.x2'), y2 = num(w.y2, 'wall.y2');
      const ex = x2 - x1, ey = y2 - y1;
      const wl = Math.hypot(ex, ey);
      if (wl === 0) continue; // 長さ0の壁
      const den = d.x * ey - d.y * ex;
      if (den === 0) continue; // 平行
      const t = ((x1 - s.x) * ey - (y1 - s.y) * ex) / den; // 線源→点の上の位置
      const u = ((x1 - s.x) * d.y - (y1 - s.y) * d.x) / den; // 壁の上の位置
      if (!(t > 0 && t < 1 && u >= 0 && u <= 1)) continue;
      const zi = s.z + t * d.z;
      if (zi < 0 || zi > ceiling) { if (!flags.includes('beyond-ceiling')) flags.push('beyond-ceiling'); continue; }
      let factor = 1;
      if (opts.obliquity) {
        const cos = Math.abs(den / wl) / L; // 壁の法線（水平）と光線（3D）のなす角
        factor = Math.min(OBLIQUITY_MAX_FACTOR, 1 / Math.max(cos, 1e-12));
      }
      let Bw = 1;
      for (const layer of w.layers || []) {
        const params = paramsFor(layer.material);
        if (!params) throw new Error('この線源に使える透過の係数が無い材質: ' + layer.material);
        const x = num(layer.mm, '壁の厚さ', 0) * factor;
        const r = opts.ranges && opts.ranges[layer.material];
        if (r && x > r[1] && !flags.includes('extrapolated')) flags.push('extrapolated');
        Bw *= archerTransmission(x, params);
      }
      hits.push({ t, B: Bw });
    }
    hits.sort((a, b) => a.t - b.t);
    let B = 1;
    for (let i = 0; i < hits.length;) {
      let j = i, Bmax = hits[i].B;
      while (j + 1 < hits.length && hits[j + 1].t - hits[i].t < 1e-9) Bmax = Math.max(Bmax, hits[++j].B);
      B *= Bmax;
      i = j + 1;
    }
    return B;
  }

  function distanceClamped(a, b, flags) {
    const d = norm(sub(a, b));
    if (d < MIN_DISTANCE_M) { if (!flags.includes('near')) flags.push('near'); return MIN_DISTANCE_M; }
    return d;
  }

  /**
   * 点 p の週あたりの空気カーマ（mGy/週）。座標は m（z は床からの高さ、省略時0）。
   * setup（一般撮影・透視・血管撮影）:
   *   { room, patientsPerWeek, leakageLimit: 'japan'|'ncrp', patient:{x,y,z}, tube:{x,y,z},
   *     distanceMode: 'ncrp'（既定。散乱線と漏れ線の距離を短いほうにそろえる、NCRP の安全側の簡略化）| 'separate',
   *     ceiling（m、既定 3.0）, obliquity（既定 false） }
   * setup（CT）:
   *   { modality:'ct', iso:{x,y,z}, kvp:'120'|'140'（必須）, headPerWeek, bodyPerWeek, dlpHead, dlpBody（その kVp での DLP） }
   * walls: [{ x1, y1, x2, y2, layers:[{ material:'lead'|'concrete'|'gypsum', mm }] }]
   * 返り値: { total, scatter, leakage, flags }
   *   flags: 'near'（0.3 m 未満を 0.3 m に丸めた）、'primary-direction'（一般撮影で一次線の方向。一次線は含まない）、
   *          'beyond-ceiling'（天井より上・床より下を通る線。スラブは計算に入れていない）、'extrapolated'（当てはめの範囲外の厚さ）
   */
  function doseAtPoint(pIn, setup, walls) {
    const flags = [];
    const p = pt(pIn, '点');
    const opts = { ceiling: setup.ceiling, obliquity: !!setup.obliquity };
    if (setup.modality === 'ct') {
      const kv = setup.kvp === undefined ? undefined : String(setup.kvp);
      if (!ARCHER_CT.lead[kv]) throw new Error('CT の管電圧は 120 か 140 を指定: ' + setup.kvp);
      const iso = pt(setup.iso, 'アイソセンタ');
      const nh = num(setup.headPerWeek, '頭部の件数', 0), nb = num(setup.bodyPerWeek, '体幹の件数', 0);
      const k1 = (nh > 0 ? nh * ctKermaPerProcedureAt1m({ type: 'head', dlp: setup.dlpHead }) : 0) +
                 (nb > 0 ? nb * ctKermaPerProcedureAt1m({ type: 'body', dlp: setup.dlpBody }) : 0);
      const d = distanceClamped(p, iso, flags);
      const B = wallTransmission(iso, p, walls, m => ARCHER_CT[m] && ARCHER_CT[m][kv],
        Object.assign({ ranges: { lead: [0, 3], concrete: [0, 300] } }, opts), flags);
      const total = k1 / (d * d) * B; // κ は小さな漏れ線を含む（NCRP 147）。等方（NCRP の仮定）
      return { total, scatter: total, leakage: 0, flags };
    }

    const room = setup.room;
    const t = SECONDARY_PER_PATIENT[room];
    if (!t) throw new Error('部屋の種類が不明: ' + room);
    const N = num(setup.patientsPerWeek, '患者数', 0);
    const limit = LEAKAGE_LIMIT[setup.leakageLimit === undefined ? 'japan' : setup.leakageLimit];
    if (!limit) throw new Error('漏れ線の上限の指定が不明: ' + setup.leakageLimit);
    const mode = setup.distanceMode === undefined ? 'ncrp' : setup.distanceMode;
    if (mode !== 'ncrp' && mode !== 'separate') throw new Error('distanceMode が不明: ' + mode);
    const patient = pt(setup.patient, '患者'), tube = pt(setup.tube, '管球');
    const paramsFor = m => ARCHER_SECONDARY[m] && ARCHER_SECONDARY[m][room];

    // 散乱角: 管球→患者（一次線の向き）と 患者→点 のなす角
    const beam = sub(patient, tube), toP = sub(p, patient);
    const nbm = norm(beam), np = norm(toP);
    if (nbm === 0) throw new Error('管球と患者が同じ位置');
    let theta = 90;
    if (np > 0) {
      const c = (beam.x * toP.x + beam.y * toP.y + beam.z * toP.z) / (nbm * np);
      theta = Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
    }
    if (RADIOGRAPHIC_ROOMS.includes(room) && np > 0 && theta < PRIMARY_DIRECTION_DEG) flags.push('primary-direction');
    let dS = distanceClamped(p, patient, flags);
    let dL = distanceClamped(p, tube, flags);
    if (mode === 'ncrp') dS = dL = Math.min(dS, dL);
    const scatter = N * scatterPerPatientAt1m(room, theta) / (dS * dS) * wallTransmission(patient, p, walls, paramsFor, opts, flags);
    const leakage = N * t.leak * (limit / LEAKAGE_LIMIT.ncrp) / (dL * dL) * wallTransmission(tube, p, walls, paramsFor, opts, flags);
    return { total: scatter + leakage, scatter, leakage, flags };
  }

  /** 空気カーマ（mGy）→ 実効線量（mSv）。管電圧によらず最大値 1.433 を使う（80 kV 以下では安全側） */
  function toEffectiveDose_mSv(kerma_mGy) { return num(kerma_mGy, '空気カーマ', 0) * E_OVER_KA; }

  /** 法令の参考線と並べるための換算。合否は返さない（判定はしない）。
   *  滞在係数を掛けた値と、掛けない値（T=1）の両方を返す。どの線に滞在係数を使ってよいかは未確認なので、画面で両方を示す */
  function compareWithReference({ weekly_mGy, occupancy }) {
    num(weekly_mGy, '週あたりの空気カーマ', 0);
    const T = occupancy === undefined ? 1 : num(occupancy, '滞在係数', 0);
    if (T > 1) throw new Error('滞在係数は 0〜1: ' + T);
    const weeklyT1 = toEffectiveDose_mSv(weekly_mGy);
    return {
      weekly_mSv: weeklyT1 * T,
      per3months_mSv: weeklyT1 * T * WEEKS_PER_3_MONTHS,
      perYear_mSv: weeklyT1 * T * 52,
      per3months_mSv_T1: weeklyT1 * WEEKS_PER_3_MONTHS,
      lines: Object.assign({}, REFERENCE_LINES),
    };
  }

  /** IVR 術者の水晶体の吸収線量（µGy）。防護は原典の「少なくとも」の減り方（正しく使った場合）なので、結果は上限側の見積もり */
  function ivrEyeDose_uGy({ kap_Gycm2, eye = 'left', ceilingShield = false, glasses = false }) {
    num(kap_Gycm2, 'KAP', 0);
    const cc = eye === 'right' ? IVR_EYE.weightedRight : IVR_EYE.weightedLeft;
    return cc * kap_Gycm2 * (ceilingShield ? IVR_EYE.ceilingShieldFactor : 1) * (glasses ? IVR_EYE.glassesFactor : 1);
  }

  return {
    SECONDARY_PER_PATIENT, ARCHER_SECONDARY, ARCHER_CT, CT, E_OVER_KA, LEAKAGE_LIMIT, REFERENCE_LINES, EYE_LENS_LIMIT, IVR_EYE,
    WEEKS_PER_3_MONTHS, MIN_DISTANCE_M, DEFAULT_CEILING_M, RADIOGRAPHIC_ROOMS,
    archerTransmission, archerThickness, scatterPerPatientAt1m, ctKermaPerProcedureAt1m,
    wallTransmission, doseAtPoint, toEffectiveDose_mSv, compareWithReference, ivrEyeDose_uGy,
  };
});
