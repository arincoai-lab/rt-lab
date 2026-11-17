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

  // ---- 文言（日本語。英語は段階②で足す）----
  const I18N = {
    ja: {
      title: '息を吸って止めてください！',
      titleSub: '胸部X線写真の匠',
      lead: '検診の胸部X線。患者さんの立ち方と呼吸を整えて、きれいな1枚を素早く撮る。',
      start: '撮影をはじめる',
      disclaimer: '教育・娯楽用のゲームです。実際の撮影手順や画質評価の基準ではありません。点数や操作はどこにも送信しません。',
      breathe: '大きく吸って、止めてください',
      shoot: '曝射',
      hint: '患者さんの体・肩・肘、パネルの取っ手をつかんで動かせます',
      grabTorso: '立ち位置 ↔', grabShoulder: '体のひねり ↔', grabElbow: '肘を前へ', grabPanel: 'パネル ↕',
      sayTidal: 'ふつうに呼吸しています', sayInhale: 'すぅーっ……', sayHold: '（息を止めています）',
      sayHoldEnd: '（そろそろ苦しい……）', sayRelease: 'ぷはっ',
      patient_office: '30代・会社員', patient_stiff: '50代・肩こりがひどい', patient_large: '40代・体格が大きい',
      patient_elderly: '80代・背中が丸い', patient_nervous: '20代・緊張している',
      time: '撮影まで', points: '点',
      again: '次の患者さん',
      item_rot: '体のねじれ', item_center: '中心', item_coverage: '肺が全部入っているか',
      item_scapula: '肩甲骨', item_inspiration: '吸気の深さ', item_motion: 'ブレ',
      d_rot_ok: '左右の鎖骨の内側の端が、背骨から等距離です',
      d_rot_ng: '約{deg}°ねじれています。鎖骨の内側の端と背骨の距離が左右で違います',
      d_center_ok: '背骨がパネルの中心です', d_center_ng: '背骨が中心から{cm}cmずれています',
      d_coverage_ok: '肺尖から肋横角まで入っています', d_coverage_ng: '{where}が欠けています（{cm}cm）',
      cut_top: '肺尖', cut_bottom: '肋横角', cut_left: '患者の左側', cut_right: '患者の右側', sep: '・',
      d_scapula_ok: '肩甲骨が肺の外に出ています', d_scapula_ng: '肩甲骨が肺に{cm}cmかぶっています。肘をもっと前へ',
      d_inspiration_ok: '横隔膜の上に後ろの肋骨が{ribs}本。十分に吸えています',
      d_inspiration_ng: '横隔膜の上に後ろの肋骨が{ribs}本（目標は10本）',
      d_motion_ok: '止まっています', d_motion_ng: '胸が動いている最中に撮りました',
    },
  };
  function t(lang, key, vars) {
    const d = I18N[lang] || I18N.ja;
    let s = key in d ? d[key] : (key in I18N.ja ? I18N.ja[key] : key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
    return s;
  }
  // 採点の一言（項目ごと）
  function detail(lang, item) {
    const ok = item.pt === item.max, i = item.info, f1 = v => (Math.round(v * 10) / 10).toFixed(1);
    switch (item.key) {
      case 'rot': return ok ? t(lang, 'd_rot_ok') : t(lang, 'd_rot_ng', { deg: f1(i.deg) });
      case 'center': return ok ? t(lang, 'd_center_ok') : t(lang, 'd_center_ng', { cm: f1(i.cm) });
      case 'coverage': {
        if (ok) return t(lang, 'd_coverage_ok');
        const where = ['top', 'bottom', 'left', 'right'].filter(k => i.cut[k] > 0).map(k => t(lang, 'cut_' + k)).join(t(lang, 'sep'));
        return t(lang, 'd_coverage_ng', { where, cm: f1(i.cm) });
      }
      case 'scapula': return ok ? t(lang, 'd_scapula_ok') : t(lang, 'd_scapula_ng', { cm: f1(i.cm) });
      case 'inspiration': return t(lang, ok ? 'd_inspiration_ok' : 'd_inspiration_ng', { ribs: i.ribs });
      case 'motion': return ok ? t(lang, 'd_motion_ok') : t(lang, 'd_motion_ng');
    }
    return '';
  }

  return {
    I18N, t, detail,
    PANEL, POSTERIOR_RIBS_FULL, CONTROL_RANGE, PATIENT_TYPES,
    makeRng, makePatient, geom, ribLevel,
    newBreath, startInhale, breathStep,
    clampControls, defaultControls, ideal, score,
  };
});
