/**
 * 散乱線シミュレータの「部屋の形」の部品（画面から使う。計算の物理は scatter-core.js）。
 *
 * 部屋は壁の線分の一覧で持つ:
 *   { x1, y1, x2, y2, material: 'concrete'|'gypsum'|'lead', mm, lead, label, side? }
 *   座標は m（左上が原点、y は下向き）。lead は鉛の内張り（mm、0 なら無し）。
 *   side は長方形のひな形の外壁（'N'|'S'|'W'|'E'）にだけ付く。
 * ここにある関数は DOM を使わない（node のテストで確かめられるように）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ScatterRoom = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIDE_LABELS = { N: '上の壁', S: '下の壁', W: '左の壁', E: '右の壁' };

  /** 長方形（幅 W × 奥行き D）の外壁4本と、あれば仕切り（鉛の壁）1本を作る。
   *  順番は 上・下・左・右・仕切り（旧版の buildWalls と同じ） */
  function rectWalls(W, D, sides, partition) {
    function outer(side, x1, y1, x2, y2) {
      var s = sides[side];
      return { x1: x1, y1: y1, x2: x2, y2: y2, material: s.material, mm: s.mm, lead: s.lead, label: SIDE_LABELS[side], side: side };
    }
    var walls = [
      outer('N', 0, 0, W, 0),
      outer('S', 0, D, W, D),
      outer('W', 0, 0, 0, D),
      outer('E', W, 0, W, D)
    ];
    if (partition && partition.on) {
      walls.push({ x1: partition.x1, y1: partition.y1, x2: partition.x2, y2: partition.y2, material: 'lead', mm: partition.mm, lead: 0, label: '仕切り壁' });
    }
    return walls;
  }

  /** 長方形のまま幅・奥行きを変える（外壁の端だけ動かす。仕切りなどほかの壁はそのまま） */
  function resizeRect(walls, W, D) {
    var pos = { N: [0, 0, W, 0], S: [0, D, W, D], W: [0, 0, 0, D], E: [W, 0, W, D] };
    return walls.map(function (w) {
      if (!w.side) return w;
      var p = pos[w.side], c = Object.assign({}, w);
      c.x1 = p[0]; c.y1 = p[1]; c.x2 = p[2]; c.y2 = p[3];
      return c;
    });
  }

  /** scatter-core の doseAtPoint に渡す形へ（材質の層＋鉛の内張り）。
   *  鉛の内張りが 0 以外なら層を足す（NaN も渡して計算側で検査させる。黙って捨てない） */
  function toCoreWalls(walls) {
    return walls.map(function (w) {
      var layers = [{ material: w.material, mm: w.mm }];
      if (w.lead !== 0) layers.push({ material: 'lead', mm: w.lead });
      return { x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, layers: layers };
    });
  }

  // 線分 ab と cd が（端を除いて）交わるか
  function segCross(a, b, c, d) {
    function o(p, q, r) { return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x); }
    return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
  }

  /** 線源 src から点 p まで、どの壁も通らずに届くか（＝遮へいの無い「部屋の中」） */
  function reachesWithoutWall(src, p, walls) {
    for (var i = 0; i < walls.length; i++) {
      var w = walls[i];
      if (segCross(src, p, { x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 })) return false;
    }
    return true;
  }

  /** 壁と点を囲む範囲（m）。margin を四方に足す。何も無ければ null */
  function extent(walls, points, margin) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    function add(x, y) {
      if (!isFinite(x) || !isFinite(y)) return;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    walls.forEach(function (w) { add(w.x1, w.y1); add(w.x2, w.y2); });
    (points || []).forEach(function (p) { if (p) add(p.x, p.y); });
    if (!isFinite(x0)) return null;
    return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
  }

  /** 点 p から上下左右へ伸ばした線が最初に当たる壁までの距離。一番遠い向き [ux, uy] を返す。
   *  どの壁にも当たらない向きは cap（m）とみなす。同じ距離なら 下・上・右・左 の順（旧版の並び） */
  function farthestDirection(p, walls, cap) {
    var dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    var best = null, bestD = -1;
    dirs.forEach(function (d) {
      var dist = cap;
      walls.forEach(function (w) {
        var ex = w.x2 - w.x1, ey = w.y2 - w.y1;
        var den = d[0] * ey - d[1] * ex;
        if (den === 0) return;
        var t = ((w.x1 - p.x) * ey - (w.y1 - p.y) * ex) / den;
        var u = ((w.x1 - p.x) * d[1] - (w.y1 - p.y) * d[0]) / den;
        if (t > 1e-9 && u >= 0 && u <= 1 && t < dist) dist = t;
      });
      if (dist > bestD) { bestD = dist; best = d; }
    });
    return best;
  }

  /** 壁の端（重なる端はまとめる）。{ x, y, ends: [[壁の番号, 1|2], ...] } の一覧 */
  function vertices(walls) {
    var out = [];
    walls.forEach(function (w, i) {
      [[w.x1, w.y1, 1], [w.x2, w.y2, 2]].forEach(function (e) {
        if (!isFinite(e[0]) || !isFinite(e[1])) return;
        for (var k = 0; k < out.length; k++) {
          if (Math.abs(out[k].x - e[0]) < 1e-6 && Math.abs(out[k].y - e[1]) < 1e-6) { out[k].ends.push([i, e[2]]); return; }
        }
        out.push({ x: e[0], y: e[1], ends: [[i, e[2]]] });
      });
    });
    return out;
  }

  function nearestOnSegment(p, w) {
    var vx = w.x2 - w.x1, vy = w.y2 - w.y1, L2 = vx * vx + vy * vy;
    var t = L2 ? Math.max(0, Math.min(1, ((p.x - w.x1) * vx + (p.y - w.y1) * vy) / L2)) : 0;
    return { x: w.x1 + t * vx, y: w.y1 + t * vy };
  }
  function round(v, step) { return Math.round(v / step) * step; }
  function clean(v) { return Math.round(v * 1e6) / 1e6; }

  /**
   * 壁を描く・端を動かすときの吸着。p は生の位置（m）。
   * opts: { tol（m。画面の約10px）, start（描いている壁の始点。あれば水平・垂直にそろえる）,
   *         walls（吸着先の壁）, exclude（吸着先から外す壁の番号の一覧。動かしている壁）, extra（追加の吸着点。図面の線の端など）,
   *         grid（m、既定 0.05）, axisDeg（既定 5） }
   * 優先: 壁の端・追加の点 → 壁の線の上 → 格子。始点があってほぼ水平・垂直なら、そろえた線の上で探す。
   * 返り値: { x, y, snap: 'vertex'|'wall'|'grid' }
   */
  function snapPoint(p, opts) {
    var tol = opts.tol, grid = opts.grid || 0.05, walls = opts.walls || [], ex = opts.exclude || [];
    var axisDeg = opts.axisDeg === undefined ? 5 : opts.axisDeg;
    var cands = [];
    walls.forEach(function (w, i) { if (ex.indexOf(i) < 0) { cands.push({ x: w.x1, y: w.y1 }); cands.push({ x: w.x2, y: w.y2 }); } });
    (opts.extra || []).forEach(function (q) { cands.push(q); });
    var best = null, bd = tol;
    cands.forEach(function (q) {
      if (!isFinite(q.x) || !isFinite(q.y)) return;
      var d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bd) { bd = d; best = q; }
    });
    if (best) return { x: best.x, y: best.y, snap: 'vertex' };

    // 水平・垂直にそろえる
    var axis = null, s = opts.start;
    if (s) {
      var ang = Math.atan2(p.y - s.y, p.x - s.x) * 180 / Math.PI, a = Math.abs(ang);
      if (a <= axisDeg || a >= 180 - axisDeg) axis = 'h';
      else if (Math.abs(a - 90) <= axisDeg) axis = 'v';
    }
    var q = { x: p.x, y: p.y };
    if (axis === 'h') q.y = s.y; else if (axis === 'v') q.x = s.x;

    // 壁の線の上（T 字につなぐ）
    var bw = null; bd = tol;
    walls.forEach(function (w, i) {
      if (ex.indexOf(i) >= 0) return;
      var r;
      if (axis) {
        // そろえた線と壁の交点
        var wx = w.x2 - w.x1, wy = w.y2 - w.y1;
        if (axis === 'h') { if (wy === 0) return; var t = (q.y - w.y1) / wy; if (t < 0 || t > 1) return; r = { x: w.x1 + t * wx, y: q.y }; }
        else { if (wx === 0) return; var t2 = (q.x - w.x1) / wx; if (t2 < 0 || t2 > 1) return; r = { x: q.x, y: w.y1 + t2 * wy }; }
      } else {
        r = nearestOnSegment(q, w);
        // 水平・垂直な壁の上では、壁に沿う向きも格子にそろえる（壁の端からはみ出さない範囲で）
        if (w.y1 === w.y2) r.x = Math.max(Math.min(w.x1, w.x2), Math.min(Math.max(w.x1, w.x2), round(r.x, grid)));
        else if (w.x1 === w.x2) r.y = Math.max(Math.min(w.y1, w.y2), Math.min(Math.max(w.y1, w.y2), round(r.y, grid)));
      }
      var d = Math.hypot(r.x - q.x, r.y - q.y);
      if (d <= bd) { bd = d; bw = r; }
    });
    if (bw) return { x: clean(bw.x), y: clean(bw.y), snap: 'wall' };

    if (axis === 'h') return { x: clean(round(q.x, grid)), y: q.y, snap: 'grid' };
    if (axis === 'v') return { x: q.x, y: clean(round(q.y, grid)), snap: 'grid' };
    return { x: clean(round(q.x, grid)), y: clean(round(q.y, grid)), snap: 'grid' };
  }

  return {
    SIDE_LABELS: SIDE_LABELS,
    rectWalls: rectWalls,
    resizeRect: resizeRect,
    toCoreWalls: toCoreWalls,
    segCross: segCross,
    reachesWithoutWall: reachesWithoutWall,
    extent: extent,
    farthestDirection: farthestDirection,
    vertices: vertices,
    snapPoint: snapPoint
  };
});
