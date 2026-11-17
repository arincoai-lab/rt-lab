/**
 * 散乱線シミュレータ: 施設の図面（PDF・PNG・JPG）を読み込む部品。
 *
 * ファイルはこの端末のブラウザの中だけで読み、外部に送らない。保存もしない。
 * 外部から取るのは PDF を読むための部品だけ（pdf.js 本体と worker は cdnjs から SRI で検査して読む。
 * 日本語の文字の対応表 cMap は cdnjs に無いため jsDelivr の同じ版から読む。どちらも図面の中身は送らない）。
 *
 * 純粋な関数（node でテストする）: scaleHints, segmentsFromOperators, applyTransform
 * ブラウザだけで使う関数: loadFile（File → { canvas, pages, segs, hints, ... }）, renderPdfPage
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FloorPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PDFJS_VER = '3.11.174';
  var PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/pdf.min.js';
  var PDFJS_SRI = 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==';
  var WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + PDFJS_VER + '/pdf.worker.min.js';
  var WORKER_SRI = 'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==';
  var CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@' + PDFJS_VER + '/cmaps/';
  var MAX_SIDE_PX = 3000;     // 描画する図面の長辺（px）の上限
  var MAX_SEGS = 200000;               // 吸着に使う線分の上限（ハッチの多い図面で止まらないように）
  var MAX_FILE_BYTES = 60 * 1048576;   // 読み込むファイルの上限（巨大な画像の展開でタブが落ちないように）

  // 建築図面でよく使う縮尺。これ以外（日付の 1/20・時刻の 1:30・図番の 1/12 など）は候補にしない
  var COMMON_SCALES = [10, 20, 25, 30, 50, 60, 100, 150, 200, 250, 300, 400, 500, 600, 1000, 1200, 1500, 2000, 2500, 3000, 5000];
  /** 図面の文字から縮尺の候補（1:50 の 50 など）を拾う。小さい順（並び順で選ばせない。キープランの 1:500 が多く出ても本図が先とは限らない）。
   *  印刷の拡大縮小で崩れるので、候補を出すだけで確定はユーザー */
  function scaleHints(text) {
    var seen = {};
    var re = /(?:^|[^\d.\/／-])1\s*[:：/／]\s*(\d{1,4})(?![\d.\/:：／])/g, m;
    while ((m = re.exec(text))) {
      var n = Number(m[1]);
      if (COMMON_SCALES.indexOf(n) >= 0) seen[n] = true;
    }
    return Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
  }

  function mul(a, b) { // 2D アフィン行列 [a b c d e f] の積 a×b（pdf.js と同じ並び）
    return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  }
  function applyTransform(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  /**
   * pdf.js の operatorList から直線の線分を取り出す（図面の px 座標）。曲線（扉の開きの弧など）は拾わない。
   * 図面の中の部品（Form XObject）とグループは、その変換行列をかけて位置を合わせる。注釈の中の線は拾わない。
   * fnArray/argsArray: page.getOperatorList() の中身。OPS: pdfjsLib.OPS。base: viewport.transform。
   * 返り値: { segs: Float32Array [x1,y1,x2,y2, ...], n: 線分の数, truncated: 上限で打ち切ったか }
   */
  function segmentsFromOperators(fnArray, argsArray, OPS, base) {
    var out = [], ctm = base.slice(), stack = [], truncated = false;
    function push(a, b) {
      if (out.length / 4 >= MAX_SEGS) { truncated = true; return; }
      if (a[0] === b[0] && a[1] === b[1]) return;
      out.push(a[0], a[1], b[0], b[1]);
    }
    var annot = 0; // 注釈（beginAnnotation〜endAnnotation）の入れ子の深さ
    function isMatrix(a) { return Array.isArray(a) && a.length === 6 && a.every(function (v) { return typeof v === 'number' && isFinite(v); }); }
    for (var i = 0; i < fnArray.length && !truncated; i++) {
      var fn = fnArray[i], args = argsArray[i];
      if (fn === OPS.beginAnnotation) { annot++; continue; }
      if (fn === OPS.endAnnotation) { if (annot) annot--; continue; }
      if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (args && isMatrix(args[0])) ctm = mul(ctm, args[0]); continue; }
      if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); continue; }
      // グループの行列は、pdf.js が続けて出す paintFormXObjectBegin が同じものをかける（canvas の beginGroup は範囲の計算にしか使わない）。
      // ここでかけると2回かかって吸着点がずれる（独立レビュー 11/17 N1）。積むだけにする
      if (fn === OPS.beginGroup) { stack.push(ctm.slice()); continue; }
      if (fn === OPS.endGroup) { if (stack.length) ctm = stack.pop(); continue; }
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.constructPath && !annot) {
        var ops = args[0], co = args[1], k = 0, cur = null, start = null;
        for (var j = 0; j < ops.length; j++) {
          var op = ops[j];
          if (op === OPS.moveTo) { cur = start = applyTransform(ctm, co[k], co[k + 1]); k += 2; }
          else if (op === OPS.lineTo) { var p = applyTransform(ctm, co[k], co[k + 1]); k += 2; if (cur) push(cur, p); cur = p; }
          else if (op === OPS.curveTo) { cur = applyTransform(ctm, co[k + 4], co[k + 5]); k += 6; }
          else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cur = applyTransform(ctm, co[k + 2], co[k + 3]); k += 4; }
          else if (op === OPS.closePath) { if (cur && start) push(cur, start); cur = start; }
          else if (op === OPS.rectangle) {
            var x = co[k], y = co[k + 1], w = co[k + 2], h = co[k + 3]; k += 4;
            var r = [applyTransform(ctm, x, y), applyTransform(ctm, x + w, y), applyTransform(ctm, x + w, y + h), applyTransform(ctm, x, y + h)];
            push(r[0], r[1]); push(r[1], r[2]); push(r[2], r[3]); push(r[3], r[0]);
            cur = start = r[0];
          }
        }
      }
    }
    return { segs: new Float32Array(out), n: out.length / 4, truncated: truncated };
  }

  // 用紙の大きさ（短辺×長辺 mm）。表題欄の「A1:1/100 A3:1/200」のような、用紙と組の縮尺を選び分けるのに使う
  var PAPERS = { A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297] };
  /** 用紙の寸法（mm）から A0〜A4 のどれか（±2%）。合わなければ null */
  function paperName(wMm, hMm) {
    var a = Math.min(wMm, hMm), b = Math.max(wMm, hMm);
    for (var k in PAPERS) if (Math.abs(a - PAPERS[k][0]) <= PAPERS[k][0] * 0.02 && Math.abs(b - PAPERS[k][1]) <= PAPERS[k][1] * 0.02) return k;
    return null;
  }
  /** 「A1:1/100」のように用紙と組になった縮尺。{ A1: 100, A3: 200 } */
  function pairedHints(text) {
    var out = {}, re = /\b(A[0-4])\s*[:：]?\s*1\s*[:：/／]\s*(\d{1,4})(?![\d.\/:：／])/g, m;
    while ((m = re.exec(text))) { var n = Number(m[2]); if (COMMON_SCALES.indexOf(n) >= 0) out[m[1]] = n; }
    return out;
  }
  /** 候補の縮尺を選ぶ。用紙と組の表記があり、PDF の用紙がそのどれかなら、その組の縮尺だけを返す（ほかの用紙用の縮尺で合わせない） */
  function hintsForPaper(hints, paired, paper) {
    if (paper && paired[paper]) return [paired[paper]];
    return hints;
  }
  // 画像の図面で、用紙の横幅の代表値（mm）を m のつもりで入れていないか（PDF と違い用紙の大きさが分からないので、一致したら確かめる）
  var PAPER_SIDES_MM = [210, 297, 420, 594, 841, 1189];

  // ---------------------------------------------------------------- 縮尺・範囲・座標の換算（画面から使う。node でテストする）
  var MIN_PLAN_M = 2, MAX_PLAN_M = 1000; // 図面全体の長辺としてありえる範囲（m）
  var MAX_CROP_M = 100;                  // 計算する範囲の上限（m）。画面の座標の上限（100 m）に合わせる
  var MIN_CALIB_SCREEN_PX = 60;          // 縮尺合わせの2点の、画面の上での最小の距離（タップの ±1 px の誤差を 2% 以下に）

  /** 縮尺を決める前の検査。図面全体が建物としてありえない大きさなら理由を返す（mm と m の取り違えなど）。問題なければ '' */
  function checkPlanSize(wPx, hPx, mPerPx) {
    if (!(mPerPx > 0) || !isFinite(mPerPx)) return '縮尺を計算できません';
    var W = wPx * mPerPx, H = hPx * mPerPx, L = Math.max(W, H);
    if (L < MIN_PLAN_M || L > MAX_PLAN_M) return 'この縮尺だと図面全体が 横 ' + W.toFixed(1) + ' m × 縦 ' + H.toFixed(1) + ' m になり、建物としてありえません。長さの単位（m）か、2点の位置を確かめてください';
    return '';
  }
  /** 2点（図面の px）と実際の長さ（m）から mPerPx。screenPx は2点の画面の上の距離。問題があれば { err } */
  function scaleFromPoints(p0, p1, lengthM, screenPx) {
    if (!(lengthM >= 0.1 && lengthM <= 1000)) return { err: '長さは 0.1〜1000 m の範囲で入れてください（単位は m）' };
    var px = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (!(px > 0) || !(screenPx >= MIN_CALIB_SCREEN_PX)) return { err: '2点が近すぎます。画面の上で離れた2点（寸法線の両端など）をタップしてください' };
    return { mPerPx: lengthM / px, relErr: 1 / screenPx }; // relErr: タップの ±1 画面 px による縮尺の誤差の目安
  }
  /** 「図面全体の横幅（m）」の検査。用紙の横幅の mm 数（A3 なら 420）を m のつもりで入れたら止める（距離が10倍・線量が約1/100になる）。
   *  paperWidthMm は PDF のときだけ分かる（画像は null） */
  function checkPlanWidth(widthM, paperWidthMm) {
    if (!(widthM >= 2 && widthM <= 1000)) return '図面全体の横幅は 2〜1000 m の範囲で入れてください（単位は m）';
    if (paperWidthMm > 0 && Math.abs(widthM - paperWidthMm) <= paperWidthMm * 0.03)
      return '入れた ' + widthM + ' は、用紙の横幅（約 ' + Math.round(paperWidthMm) + ' mm）と同じです。用紙の寸法ではなく、図面に描かれた範囲の実際の横幅を m で入れてください';
    if (!(paperWidthMm > 0) && PAPER_SIDES_MM.indexOf(widthM) >= 0)
      return '入れた ' + widthM + ' は、用紙の寸法（mm）と同じ数です。用紙の寸法ではなく、図面に描かれた範囲の実際の横幅を m で入れてください（本当にその長さなら、2点の長さで合わせてください）';
    return '';
  }
  /** 範囲を選び直したとき、原点を (dx, dy) m 動かした分だけ、壁・管球・患者・アイソセンタ・測定点を逆にずらす（図面の上の位置は変えない） */
  function shiftScene(sc, dx, dy) {
    var r4 = function (v) { return Math.round(v * 1e4) / 1e4; };
    sc.walls.forEach(function (w) { w.x1 = r4(w.x1 - dx); w.x2 = r4(w.x2 - dx); w.y1 = r4(w.y1 - dy); w.y2 = r4(w.y2 - dy); });
    [sc.patient, sc.tube, sc.iso].concat(sc.probes).forEach(function (p) { p.x = r4(p.x - dx); p.y = r4(p.y - dy); });
  }

  /** 範囲（図面の px）の検査 */
  function checkCrop(c, mPerPx) {
    var w = (c.x1 - c.x0) * mPerPx, h = (c.y1 - c.y0) * mPerPx;
    if (w < 1 || h < 1) return '範囲が小さすぎます（1 m 以上）。もう一度、部屋のまわりの2つの角をタップしてください';
    if (w > MAX_CROP_M || h > MAX_CROP_M) return '範囲が大きすぎます（横 ' + w.toFixed(0) + ' m × 縦 ' + h.toFixed(0) + ' m。' + MAX_CROP_M + ' m まで）。部屋とそのまわりだけを囲んでください';
    return '';
  }
  /** 図面の px → 世界の m（origin は世界の (0, 0) にあたる図面の px。範囲の左上） */
  function pxToWorld(x, y, origin, mPerPx) { return { x: (x - origin.x) * mPerPx, y: (y - origin.y) * mPerPx }; }

  /** 縮尺を合わせ直したとき、壁・患者・アイソセンタ・測定点を k 倍する（原点は範囲の左上で固定）。
   *  管球は患者からのずれ（SID と向き）を保つ（ずれまで伸ばすと漏れ線の距離と一次線の向きが黙って変わる） */
  function rescaleScene(sc, k) {
    var dt = { x: sc.tube.x - sc.patient.x, y: sc.tube.y - sc.patient.y };
    var r4 = function (v) { return Math.round(v * 1e4) / 1e4; }; // 0.1 mm に丸める
    sc.walls.forEach(function (w) { w.x1 = r4(w.x1 * k); w.y1 = r4(w.y1 * k); w.x2 = r4(w.x2 * k); w.y2 = r4(w.y2 * k); });
    [sc.patient, sc.iso].concat(sc.probes).forEach(function (p) { p.x = r4(p.x * k); p.y = r4(p.y * k); });
    sc.tube.x = r4(sc.patient.x + dt.x); sc.tube.y = r4(sc.patient.y + dt.y);
  }
  /** 初めて範囲を決めたとき、患者・アイソセンタ・測定点を、元の並び（old の範囲の中の位置）のまま範囲 box（m）の内側 15% に写す。
   *  管球は患者からのずれを保つ。5 cm に丸める */
  function layoutIntoBox(sc, old, box) {
    var inset = 0.15, r2 = function (v) { return Math.round(v * 20) / 20; };
    var tx = function (x) { return box.x0 + (box.x1 - box.x0) * (inset + (1 - 2 * inset) * (x - old.x0) / Math.max(old.x1 - old.x0, 1e-9)); };
    var ty = function (y) { return box.y0 + (box.y1 - box.y0) * (inset + (1 - 2 * inset) * (y - old.y0) / Math.max(old.y1 - old.y0, 1e-9)); };
    var dt = { x: sc.tube.x - sc.patient.x, y: sc.tube.y - sc.patient.y };
    [sc.patient, sc.iso].concat(sc.probes).forEach(function (p) { p.x = r2(tx(p.x)); p.y = r2(ty(p.y)); });
    sc.tube.x = sc.patient.x + dt.x; sc.tube.y = sc.patient.y + dt.y;
  }

  // ---------------------------------------------------------------- ブラウザ
  var pdfjsPromise = null;
  function loadScript(url, sri) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = url; s.integrity = sri; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
      s.onload = resolve; s.onerror = function () { reject(new Error('PDF を読む部品（pdf.js）を読み込めませんでした。通信を確かめてください。PNG・JPG の図面は使えます')); };
      document.head.appendChild(s);
    });
  }
  function loadPdfJs() {
    if (!pdfjsPromise) {
      pdfjsPromise = loadScript(PDFJS_URL, PDFJS_SRI).then(function () {
        // worker も SRI で検査してから Blob にして使う（<script> 以外の読み込みにも改ざん検査をかけるため）
        return fetch(WORKER_URL, { integrity: WORKER_SRI, mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
      }).then(function (res) {
        if (!res.ok) throw new Error('PDF を読む部品（worker）を読み込めませんでした');
        return res.blob();
      }).then(function (blob) {
        var lib = window.pdfjsLib;
        if (!lib) throw new Error('PDF を読む部品（pdf.js）が使えません');
        lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([blob], { type: 'text/javascript' }));
        return lib;
      }).catch(function (e) { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }

  function fitScale(w, h) { return Math.min(1, MAX_SIDE_PX / Math.max(w, h)); }

  /** PDF の1ページを描き、線分と縮尺の候補を取り出す */
  function renderPdfPage(doc, pageNum) {
    var lib = window.pdfjsLib;
    return doc.getPage(pageNum).then(function (page) {
      var v1 = page.getViewport({ scale: 1 });
      var sc = Math.min(4, MAX_SIDE_PX / Math.max(v1.width, v1.height)); // 長辺 3000 px まで拡大して描く
      var vp = page.getViewport({ scale: sc });
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      var cx = canvas.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
      return page.render({ canvasContext: cx, viewport: vp }).promise.then(function () {
        return Promise.all([page.getOperatorList(), page.getTextContent().catch(function () { return { items: [] }; })]);
      }).then(function (r) {
        var ol = r[0], tc = r[1];
        var sg = segmentsFromOperators(ol.fnArray, ol.argsArray, lib.OPS, vp.transform);
        var text = tc.items.map(function (it) { return it.str; }).join(' ');
        return {
          canvas: canvas, wPx: canvas.width, hPx: canvas.height,
          // 用紙の 1 pt = 25.4/72 mm。描画の px あたりの用紙の長さ（m）。縮尺 1:N の候補の計算に使う
          paperMPerPx: 0.0254 / 72 / sc,
          segs: sg.segs, nSegs: sg.n, segsTruncated: sg.truncated,
          hints: hintsForPaper(scaleHints(text), pairedHints(text), paperName(v1.width * 25.4 / 72, v1.height * 25.4 / 72)),
          paper: paperName(v1.width * 25.4 / 72, v1.height * 25.4 / 72)
        };
      });
    });
  }

  /** ファイルを読む。PDF なら { doc, pages } も返す */
  function loadFile(file) {
    var name = (file.name || '').toLowerCase(), type = file.type || '';
    var isPdf = type === 'application/pdf' || /\.pdf$/.test(name);
    var isImg = /^image\/(png|jpeg)$/.test(type) || /\.(png|jpe?g)$/.test(name);
    if (file.size > MAX_FILE_BYTES) return Promise.reject(new Error('ファイルが大きすぎます（' + Math.round(MAX_FILE_BYTES / 1048576) + ' MB まで）'));
    if (isPdf) {
      return Promise.all([loadPdfJs(), file.arrayBuffer()]).then(function (r) {
        var lib = r[0];
        // isEvalSupported:false は、悪意のある PDF のフォントで任意のスクリプトが動く問題（CVE-2024-4367）を避ける設定
        return lib.getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false, cMapUrl: CMAP_URL, cMapPacked: true, disableFontFace: false }).promise;
      }).then(function (doc) {
        return renderPdfPage(doc, 1).then(function (pg) { pg.doc = doc; pg.pages = doc.numPages; pg.page = 1; pg.kind = 'pdf'; return pg; });
      });
    }
    if (isImg) {
      return createImageBitmap(file).then(function (bmp) {
        var sc = fitScale(bmp.width, bmp.height);
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(bmp.width * sc); canvas.height = Math.round(bmp.height * sc);
        var cx = canvas.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, canvas.width, canvas.height);
        cx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        if (bmp.close) bmp.close();
        return { canvas: canvas, wPx: canvas.width, hPx: canvas.height, paperMPerPx: null, segs: new Float32Array(0), nSegs: 0, segsTruncated: false, hints: [], pages: 1, page: 1, kind: 'image' };
      }, function () { throw new Error('画像を読み込めませんでした（PNG・JPG に対応）'); });
    }
    return Promise.reject(new Error('対応していない形式です。PDF・PNG・JPG の図面を選んでください'));
  }

  /** 線分の端点を格子（cell px）で引けるようにする。near(x, y, r) は r px 以内の端点の配列 [x, y, ...] */
  function endpointIndex(segs, cell) {
    var grid = new Map();
    function key(i, j) { return i * 100003 + j; }
    for (var k = 0; k < segs.length; k += 2) {
      var x = segs[k], y = segs[k + 1], kk = key(Math.floor(x / cell), Math.floor(y / cell));
      var b = grid.get(kk); if (!b) grid.set(kk, b = []); b.push(x, y);
    }
    return {
      near: function (x, y, r) {
        var out = [], i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((y - r) / cell), j1 = Math.floor((y + r) / cell);
        for (var i = i0; i <= i1; i++) for (var j = j0; j <= j1; j++) {
          var b = grid.get(key(i, j)); if (!b) continue;
          for (var t = 0; t < b.length; t += 2) if (Math.abs(b[t] - x) <= r && Math.abs(b[t + 1] - y) <= r) out.push(b[t], b[t + 1]);
        }
        return out;
      }
    };
  }

  return {
    PDFJS_URL: PDFJS_URL, PDFJS_SRI: PDFJS_SRI, WORKER_URL: WORKER_URL, WORKER_SRI: WORKER_SRI, CMAP_URL: CMAP_URL,
    scaleHints: scaleHints, segmentsFromOperators: segmentsFromOperators, applyTransform: applyTransform, endpointIndex: endpointIndex,
    paperName: paperName, pairedHints: pairedHints, hintsForPaper: hintsForPaper,
    checkPlanSize: checkPlanSize, scaleFromPoints: scaleFromPoints, checkCrop: checkCrop, pxToWorld: pxToWorld,
    rescaleScene: rescaleScene, layoutIntoBox: layoutIntoBox, checkPlanWidth: checkPlanWidth, shiftScene: shiftScene, MAX_CROP_M: MAX_CROP_M, MIN_CALIB_SCREEN_PX: MIN_CALIB_SCREEN_PX,
    loadFile: loadFile, renderPdfPage: renderPdfPage
  };
});
