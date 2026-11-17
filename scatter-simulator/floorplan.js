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
  var MAX_SEGS = 200000;      // 吸着に使う線分の上限（ハッチの多い図面で止まらないように）

  /** 図面の文字から縮尺の候補（1:50 の 50 など）を拾う。多い順。印刷の拡大縮小で崩れるので候補を出すだけ */
  function scaleHints(text) {
    var count = {};
    var re = /(?:^|[^\d.])1\s*[:：/／]\s*(\d{1,4})(?![\d.])/g, m;
    while ((m = re.exec(text))) {
      var n = Number(m[1]);
      if (n >= 10 && n <= 5000) count[n] = (count[n] || 0) + 1;
    }
    return Object.keys(count).map(Number).sort(function (a, b) { return count[b] - count[a] || a - b; });
  }

  function mul(a, b) { // 2D アフィン行列 [a b c d e f] の積 a×b（pdf.js と同じ並び）
    return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  }
  function applyTransform(m, x, y) { return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }

  /**
   * pdf.js の operatorList から直線の線分を取り出す（図面の px 座標）。曲線は端点だけを点として拾う。
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
    for (var i = 0; i < fnArray.length && !truncated; i++) {
      var fn = fnArray[i], args = argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, args);
      else if (fn === OPS.constructPath) {
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
          hints: scaleHints(text)
        };
      });
    });
  }

  /** ファイルを読む。PDF なら { doc, pages } も返す */
  function loadFile(file) {
    var name = (file.name || '').toLowerCase(), type = file.type || '';
    var isPdf = type === 'application/pdf' || /\.pdf$/.test(name);
    var isImg = /^image\/(png|jpeg)$/.test(type) || /\.(png|jpe?g)$/.test(name);
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
    loadFile: loadFile, renderPdfPage: renderPdfPage
  };
});
