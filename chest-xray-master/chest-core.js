/**
 * 胸部X線写真の匠（教育・娯楽用ゲーム）の計算の中身。画面は持たない純粋な関数だけ。
 * ブラウザでは window.ChestCore、Node では require() で使う。
 *
 * 座標は cm。x の正の向き = 患者の左、y は下向きが正（首の付け根付近が 0）。
 * パネルは 43×43 cm で、左右の中心は x = 0 に固定。上下の中心が controls.panelY。
 *
 * 採点の項目と点は scripts/chest-xray-provenance.json（EUR 16260 の Chest PA 画質基準との照合表）
 * と一致していなければならない（scripts/test-chest-xray.js が検査する）。
 * これはゲームのための単純化した模型で、実際の撮影手順や画質評価の基準ではない。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChestCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PANEL = 43;
  const POSTERIOR_RIBS_FULL = 10;     // EUR 16260 1.1.1: 横隔膜の上に後ろの肋骨10本
  const RIB_PITCH = 2.7;              // 後ろの肋骨の間隔（cm、体格 s=1 のとき）
  const CONTROL_RANGE = { x: [-8, 8], rot: [-8, 8], roll: [0, 1], panelY: [-5, 40] };

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const half = v => Math.round(v * 2) / 2;   // 0.5 刻み（操作で必ず満点の位置に届くように）

  // mulberry32: 種から決まる乱数（テストで同じ患者を再現するため）
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 難しさは「人」で変える。易しい順。
  //   s: 体格、hold: 息を止めていられる秒数、scapBase: 肩を前に出していないときの肩甲骨の内側の縁（小さいほど肩が硬い）
  //   apexUp: 肺尖が高い分（cm）、drift: 落ち着かず立ち位置がずれる速さ（cm/秒、画面側で使う）
  const PATIENT_TYPES = [
    { id: 'office',  s: [0.95, 1.02], hold: [6, 8],     scapBase: 6.0, apexUp: 0, drift: 0 },
    { id: 'stiff',   s: [0.97, 1.05], hold: [5, 7],     scapBase: 4.6, apexUp: 0, drift: 0 },
    { id: 'large',   s: [1.08, 1.12], hold: [4.5, 6],   scapBase: 6.0, apexUp: 0, drift: 0 },
    { id: 'elderly', s: [0.92, 0.98], hold: [2.5, 2.5], scapBase: 5.5, apexUp: 1, drift: 0 },
    { id: 'nervous', s: [0.95, 1.03], hold: [4, 6],     scapBase: 6.0, apexUp: 0, drift: 0.25 },
  ];

  function makePatient(typeId, rng) {
    const T = PATIENT_TYPES.find(t => t.id === typeId);
    if (!T) throw new Error('unknown patient type: ' + typeId);
    const r = (a, b) => a + rng() * (b - a);
    const sign = () => (rng() < 0.5 ? -1 : 1);
    return {
      type: T.id,
      s: r(T.s[0], T.s[1]),
      c7: half(r(-3, 3)),                      // 首の付け根の高さ（身長の差）
      baseRot: sign() * half(r(2.5, 6)),       // 立ったときの体のねじれ（度）
      baseX: sign() * half(r(2, 5)),           // 立ち位置のずれ（cm）
      hold: r(T.hold[0], T.hold[1]),
      scapBase: T.scapBase,
      apexUp: T.apexUp,
      drift: T.drift,
      panelStart: sign() * half(r(10, 14)),    // 最初のパネルの高さのずれ（cm）
    };
  }

  // ---- 解剖の位置 ----
  function geom(p, c, lvl) {
    const s = p.s, th = (p.baseRot + c.rot) * Math.PI / 180, sn = Math.sin(th), cs = Math.cos(th);
    const X = p.baseX - c.x;                           // 背骨の左右位置（パネル中心が 0）
    const rx = (lx, z) => X + s * (lx * cs + z * sn);  // 体をひねったときの見かけの x（z: 背中側が正）
    const wy = ly => p.c7 + s * ly;
    const W = 12.5, L = 19 + 8 * lvl;                  // 肺の半幅と、肺尖から横隔膜までの長さ
    const wL = W * (1 + 0.8 * sn), wR = W * (1 - 0.8 * sn);
    const scapM = p.scapBase + 8.5 * c.roll;           // 肩甲骨の内側の縁（背骨から）
    return {
      s, th, sn, X, rx, wy, W, L, wL, wR, scapM,
      apexY: wy(2) - p.apexUp,
      botL: wy(2 + L), botR: wy(2 + L - 1.2),          // 右の横隔膜は少し高い
      lungL: X + s * wL, lungR: X - s * wR,            // 肺の外側の端
      scapL: rx(scapM, 7), scapR: rx(-scapM, 7),
      panel: { l: -PANEL / 2, r: PANEL / 2, t: c.panelY - PANEL / 2, b: c.panelY + PANEL / 2 },
    };
  }

  // 横隔膜（右）の上に見える後ろの肋骨の本数（連続値）
  function ribLevel(p, g) {
    return ((g.botR - p.c7) / p.s - 0.3) / RIB_PITCH;
  }

  // ---- 呼吸 ----
  // mode: tidal（普通の呼吸）→ inhale（吸っている）→ hold（止めている。少しずつ戻る）→ release（吐く）→ tidal
  function newBreath() { return { mode: 'tidal', t: 0, lvl: 0.35, v: 0, from: 0.35 }; }
  function startInhale(b) {
    return b.mode === 'tidal' ? { ...b, mode: 'inhale', t: 0, from: b.lvl } : b;
  }
  function breathStep(b, p, dt) {
    const n = { ...b, t: b.t + dt };
    if (n.mode === 'tidal') n.lvl = 0.35 + 0.1 * Math.sin(n.t * Math.PI / 2);
    else if (n.mode === 'inhale') {
      n.lvl = n.from + (1 - n.from) * clamp(n.t / 1.6);
      if (n.t >= 1.6) { n.mode = 'hold'; n.t = 0; n.lvl = 1; }
    } else if (n.mode === 'hold') {
      n.lvl = 1 - 0.02 * n.t;
      if (n.t >= p.hold) { n.mode = 'release'; n.t = 0; n.from = n.lvl; }
    } else if (n.mode === 'release') {
      n.lvl = n.from + (0.3 - n.from) * clamp(n.t / 0.9);
      if (n.t >= 0.9) { n.mode = 'tidal'; n.t = -1 / 3; n.lvl = 0.3; }
    }
    n.lvl = clamp(n.lvl);
    n.v = dt > 0 ? (n.lvl - b.lvl) / dt : 0;
    return n;
  }

  // ---- 操作 ----
  function clampControls(c) {
    const o = {};
    for (const k of Object.keys(CONTROL_RANGE)) {
      const v = Number.isFinite(c[k]) ? c[k] : 0;
      o[k] = clamp(v, CONTROL_RANGE[k][0], CONTROL_RANGE[k][1]);
    }
    return o;
  }
  function idealPanelY(p) {
    const g = geom(p, { x: p.baseX, rot: -p.baseRot, roll: 1, panelY: 0 }, 1);
    return half((g.apexY + Math.max(g.botL, g.botR)) / 2);
  }
  function defaultControls(p) {
    return clampControls({ x: 0, rot: 0, roll: 0.1, panelY: idealPanelY(p) + p.panelStart });
  }
  // 満点になる撮り方（テストと練習モードの答え合わせ用）
  function ideal(p) {
    return { controls: { x: p.baseX, rot: -p.baseRot, roll: 1, panelY: idealPanelY(p) }, lvl: 1, v: 0 };
  }

  // ---- 採点（1人100点）----
  function score(p, shot) {
    const c = clampControls(shot.controls), g = geom(p, c, clamp(shot.lvl)), s = g.s;
    const v = Number.isFinite(shot.v) ? Math.abs(shot.v) : 1;
    const items = [];
    const add = (key, max, ratio, info) => items.push({ key, max, pt: Math.round(max * clamp(ratio)), info });

    // 1.1.2 左右の鎖骨の内側の端の真ん中に棘突起（＝体がねじれていない）
    const deg = Math.abs(p.baseRot + c.rot);
    add('rot', 25, deg <= 0.5 ? 1 : 1 - deg / 5, { deg });

    // （原典になし）背骨がパネルの左右中心
    const off = Math.abs(g.X);
    add('center', 10, off <= 0.5 ? 1 : 1 - off / 5, { cm: off });

    // 1.1.4 / 1.1.6(c) 肺尖から肋横角まで入っている
    const cut = {
      top: Math.max(0, g.panel.t - g.apexY),
      bottom: Math.max(0, Math.max(g.botL, g.botR) - g.panel.b),
      left: Math.max(0, g.lungL - g.panel.r),
      right: Math.max(0, g.panel.l - g.lungR),
    };
    const cutSum = cut.top + cut.bottom + cut.left + cut.right;
    add('coverage', 20, 1 - cutSum / 3, { cut, cm: cutSum });

    // 1.1.3 肩甲骨の内側の縁が肺野の外
    const ov = (Math.max(0, g.lungL - g.scapL) + Math.max(0, g.scapR - g.lungR)) / 2 / s;
    add('scapula', 15, ov === 0 ? 1 : 1 - ov / 6.5, { cm: ov });

    // 1.1.1 深吸気（横隔膜の上に後ろの肋骨10本）
    const lv = ribLevel(p, g), ribs = Math.floor(lv + 1e-9);
    add('inspiration', 20, ribs >= POSTERIOR_RIBS_FULL ? 1 : (lv - 7) / (POSTERIOR_RIBS_FULL - 7), { ribs });

    // 1.1.1 息を止めて / 1.1.5 鮮明に（胸が動いている最中に撮るとブレる）
    add('motion', 10, v < 0.03 ? 1 : 1 - v / 0.12, { moving: v >= 0.03 });

    return { total: items.reduce((a, b) => a + b.pt, 0), items };
  }

  return {
    PANEL, POSTERIOR_RIBS_FULL, CONTROL_RANGE, PATIENT_TYPES,
    makeRng, makePatient, geom, ribLevel,
    newBreath, startInhale, breathStep,
    clampControls, defaultControls, ideal, score,
  };
});
