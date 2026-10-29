/**
 * おきばメモ — 画面と保存（IndexedDB）。中核ロジックは core.js（window.OkibaCore）。
 * 外部への通信は一切しない（index.html の CSP で connect-src 'self' に限定している）。
 */
(() => {
  'use strict';
  const C = window.OkibaCore;
  const view = document.getElementById('view');
  const titleEl = document.getElementById('title');
  const backBtn = document.querySelector('[data-act="back"]');
  const bannerEl = document.getElementById('banner');
  const toastEl = document.getElementById('toast');

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC[c]);
  const svg = d => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>'),
    chev: svg('<path d="M9 5l7 7-7 7"/>'),
    box: svg('<path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5L12 12l8.5-4.5M12 12v9"/>'),
    place: svg('<path d="M4 10l8-6 8 6v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    camera: svg('<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
    image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/>'),
    move: svg('<path d="M5 12h13M14 7l5 5-5 5"/>'),
    lend: svg('<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6M15 14h6M18 11l3 3-3 3"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
    home: svg('<path d="M4 11l8-7 8 7"/><path d="M6 9.5V20h12V9.5"/>'),
  };

  // ---------------------------------------------------------------------------
  // IndexedDB
  // ---------------------------------------------------------------------------
  const DB_NAME = 'okiba';
  const DB_VERSION = 1;
  let db = null;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of ['places', 'items', 'photos']) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('別のタブでこのアプリが開いています。閉じてから再読み込みしてください'));
    });
  }
  const reqP = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  const txDone = t => new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('保存が中断されました'));
  });
  const getAll = store => reqP(db.transaction(store).objectStore(store).getAll());
  const getAllKeys = store => reqP(db.transaction(store).objectStore(store).getAllKeys());
  const getOne = (store, key) => reqP(db.transaction(store).objectStore(store).get(key));
  function putMany(store, values) {
    const t = db.transaction(store, 'readwrite');
    for (const v of values) t.objectStore(store).put(v);
    return txDone(t);
  }
  function deleteOne(store, key) {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    return txDone(t);
  }

  // ---------------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------------
  const state = {
    places: [],
    items: [],
    placesById: new Map(),
    meta: { lastBackupAt: null, changesSinceBackup: 0, misses: [], persistAsked: false },
    query: '',
    form: null,
    prepared: null,
    importPending: null,
    swWaiting: null,
  };

  function reindex() { state.placesById = C.indexById(state.places); }
  const findItem = id => state.items.find(i => i.id === id) || null;
  const pathOf = id => (id ? C.placePathText(state.placesById, id) || '（削除した場所）' : '場所未設定');

  async function loadAll() {
    const [places, items, metaRows] = await Promise.all([getAll('places'), getAll('items'), getAll('meta')]);
    const now = Date.now();
    state.places = places.map(p => C.sanitizePlace(p, now)).filter(Boolean);
    state.items = items.map(i => C.sanitizeItem(i, now)).filter(Boolean);
    for (const r of metaRows) state.meta[r.key] = r.value;
    reindex();
  }

  async function setMeta(key, value) {
    state.meta[key] = value;
    await putMany('meta', [{ key, value }]);
  }

  async function markChanged() {
    await setMeta('changesSinceBackup', (state.meta.changesSinceBackup || 0) + 1);
    if (!state.meta.persistAsked && navigator.storage && navigator.storage.persist) {
      await setMeta('persistAsked', true);
      navigator.storage.persist().catch(() => {});
    }
  }

  async function saveItem(item) {
    await putMany('items', [item]);
    const i = state.items.findIndex(x => x.id === item.id);
    if (i >= 0) state.items[i] = item; else state.items.push(item);
    await markChanged();
  }

  async function savePlace(place) {
    await putMany('places', [place]);
    const i = state.places.findIndex(x => x.id === place.id);
    if (i >= 0) state.places[i] = place; else state.places.push(place);
    reindex();
    await markChanged();
  }

  async function addPlace(name, parentId) {
    const now = Date.now();
    const place = { id: C.makeId(), name: name.trim().slice(0, C.LIMITS.name), parentId: parentId || null, note: '', photoId: null, createdAt: now, updatedAt: now };
    await savePlace(place);
    return place;
  }

  async function deletePhoto(id) {
    if (!id) return;
    await deleteOne('photos', id);
    const url = thumbCache.get(id);
    if (url) { URL.revokeObjectURL(url); thumbCache.delete(id); }
  }

  // ---------------------------------------------------------------------------
  // 写真（縮小して保存。再エンコードで位置情報などの EXIF も落ちる）
  // ---------------------------------------------------------------------------
  const thumbCache = new Map();
  let fullUrls = [];

  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('画像を読み込めませんでした'));
      img.src = url;
    });
  }

  function drawScaled(img, max, quality) {
    const w0 = img.naturalWidth, h0 = img.naturalHeight;
    const s = Math.min(1, max / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * s)), h = Math.max(1, Math.round(h0 * s));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise((res, rej) => canvas.toBlob(b => {
      if (!b) return rej(new Error('画像の変換に失敗しました'));
      b.arrayBuffer().then(buf => res({ buf, w, h }), rej);
    }, 'image/jpeg', quality));
  }

  async function processImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const full = await drawScaled(img, 1280, 0.78);
      const thumb = await drawScaled(img, 320, 0.7);
      return { type: 'image/jpeg', full: full.buf, thumb: thumb.buf, w: full.w, h: full.h };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function photoUrl(id, kind) {
    if (kind !== 'full' && thumbCache.has(id)) return thumbCache.get(id);
    const ph = await getOne('photos', id);
    if (!ph) return null;
    const buf = kind === 'full' ? ph.full : (ph.thumb || ph.full);
    const url = URL.createObjectURL(new Blob([buf], { type: ph.type }));
    if (kind === 'full') fullUrls.push(url); else thumbCache.set(id, url);
    return url;
  }

  async function hydrate(root) {
    for (const img of root.querySelectorAll('img[data-photo]')) {
      const url = await photoUrl(img.dataset.photo, img.dataset.kind).catch(() => null);
      if (url) img.src = url;
    }
  }

  function revokeFull() {
    fullUrls.forEach(u => URL.revokeObjectURL(u));
    fullUrls = [];
  }

  // ---------------------------------------------------------------------------
  // 表示の部品
  // ---------------------------------------------------------------------------
  function fmtDate(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    const md = (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    return d.getFullYear() === new Date().getFullYear() ? md : d.getFullYear() + '/' + md;
  }

  let toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2600);
  }

  const section = (title, html) => '<h2 class="section-title">' + esc(title) + '</h2>' + html;

  function thumbHtml(photoId, fallback) {
    return photoId
      ? '<img class="thumb" data-photo="' + esc(photoId) + '" alt="">'
      : '<span class="thumb">' + (fallback || ICON.box) + '</span>';
  }

  function entryHtml(it, opts) {
    const badges = it.status === 'lent' ? ' <span class="badge lent">貸出中</span>'
      : C.isMisplaced(it) ? ' <span class="badge warn">定位置外</span>' : '';
    const where = it.status === 'lent'
      ? esc(it.lentTo || '相手未記入') + ' に貸している'
      : '<strong>' + esc(pathOf(it.placeId)) + '</strong>' + (it.detail ? ' ・ ' + esc(it.detail) : '');
    const act = opts.fromSearch ? ' data-act="open-result" data-id="' + esc(it.id) + '"' : '';
    let html = '<a class="entry" href="#/item/' + esc(it.id) + '"' + act + '>' + thumbHtml(it.photoId) +
      '<span class="body"><span class="name">' + esc(it.name) + badges + '</span>' +
      '<span class="where">' + where + '</span>' +
      '<span class="meta">確認: ' + C.relativeTime(it.lastSeenAt, Date.now()) + '</span></span>' +
      '<span class="chev">' + ICON.chev + '</span></a>';
    if (opts.returnBtn) {
      html += '<div class="entry-actions"><button type="button" class="btn small" data-act="return-home" data-id="' + esc(it.id) + '">' +
        ICON.home + ' 定位置に戻した</button><span class="small muted">定位置: ' + esc(pathOf(it.homePlaceId)) + '</span></div>';
    }
    return html;
  }

  const listHtml = (items, opts) =>
    '<ul class="list list-card">' + items.map(it => '<li>' + entryHtml(it, opts || {}) + '</li>').join('') + '</ul>';

  function countIn(placeId) {
    const ids = C.descendantIds(state.places, placeId);
    return state.items.filter(i => ids.has(i.placeId)).length;
  }

  function placeEntryHtml(p, href, showParent) {
    const parent = showParent && p.parentId ? pathOf(p.parentId) : '';
    return '<a class="entry" href="' + esc(href) + '">' + thumbHtml(p.photoId, ICON.place) +
      '<span class="body"><span class="name">' + esc(p.name) + '</span>' +
      (parent ? '<span class="where">' + esc(parent) + '</span>' : '') +
      '<span class="meta">' + countIn(p.id) + '件</span></span><span class="chev">' + ICON.chev + '</span></a>';
  }

  const ROOM_SUGGESTIONS = ['玄関', 'リビング', 'キッチン', '寝室', '洗面所', 'クローゼット', '書斎', '車', 'カバン', '職場'];
  const ITEM_SUGGESTIONS = ['鍵', '財布', '眼鏡', '印鑑', '保険証', '通帳', '充電器', '爪切り', '説明書', 'リモコン'];

  function setView(title, html, opts) {
    revokeFull();
    titleEl.textContent = title;
    document.title = title === 'おきばメモ' ? 'おきばメモ' : title + ' | おきばメモ';
    view.innerHTML = html;
    backBtn.hidden = !(opts && opts.back);
    hydrate(view);
  }

  // ---------------------------------------------------------------------------
  // ルーティング（#/... の履歴を自前で積み、戻るボタンで1つ戻る）
  // ---------------------------------------------------------------------------
  function parseHash() {
    const h = location.hash.replace(/^#/, '') || '/';
    const qi = h.indexOf('?');
    const path = qi >= 0 ? h.slice(0, qi) : h;
    return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qi >= 0 ? h.slice(qi + 1) : '') };
  }

  let lastHash = null;
  function navigate(hash, opts) {
    const depth = (history.state && history.state.depth) || 0;
    if (opts && opts.replace) history.replaceState({ depth }, '', hash);
    else history.pushState({ depth: depth + 1 }, '', hash);
    render(true);
  }

  function goBack() {
    if (history.state && history.state.depth > 0) history.back();
    else navigate('#/', { replace: true });
  }

  function showRenderError(err) {
    console.error(err);
    setView('エラー', '<div class="card warn"><p>表示中にエラーが起きました。</p><p class="small">' + esc(err && err.message) + '</p></div>', { back: true });
  }

  function render(force) {
    const h = location.hash || '#/';
    if (h === lastHash && force !== true) return;
    const changed = h !== lastHash;
    lastHash = h;
    const { parts, params } = parseHash();
    const route = parts[0] || '';
    let tab = null;
    try {
      switch (route) {
        case '': tab = 'home'; renderHome(); break;
        case 'all': renderAll(); break;
        case 'item': renderItem(parts[1]); break;
        case 'new': tab = 'new'; renderItemForm(null, params); break;
        case 'edit': renderItemForm(parts[1], params); break;
        case 'move': renderMove(parts[1]); break;
        case 'places': tab = 'places'; renderPlaces(parts[1] || null); break;
        case 'place-edit': tab = 'places'; renderPlaceEdit(parts[1]); break;
        case 'data': tab = 'data'; renderData().catch(showRenderError); break;
        default: renderNotFound();
      }
    } catch (err) {
      showRenderError(err);
    }
    document.querySelectorAll('.tabbar a').forEach(a => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (changed) window.scrollTo(0, 0);
  }

  function renderNotFound() {
    setView('見つかりません', '<div class="card empty"><p>このページは見つかりませんでした（削除済みの可能性があります）。</p><p><a class="btn" href="#/">ホームへ</a></p></div>', { back: true });
  }

  // ---------------------------------------------------------------------------
  // ホーム（さがす）
  // ---------------------------------------------------------------------------
  function renderHome() {
    setView('おきばメモ',
      '<form class="search" role="search" data-form="search">' +
      '<span class="search-icon">' + ICON.search + '</span>' +
      '<input id="q" type="search" value="' + esc(state.query) + '" placeholder="何を探していますか？（例: 鍵）" aria-label="探しているもの" enterkeyhint="search" autocomplete="off" maxlength="100">' +
      '</form><div id="home-body"></div>', { back: false });
    renderHomeBody();
  }

  function renderHomeBody() {
    const body = document.getElementById('home-body');
    if (!body) return;
    body.innerHTML = state.query.trim() ? resultsHtml(state.query) : dashboardHtml();
    hydrate(body);
  }

  function resultsHtml(q) {
    const items = C.searchItems(state.items, state.places, q);
    const places = C.searchPlaces(state.places, q).slice(0, 5);
    if (!items.length && !places.length) {
      const t = q.trim();
      return '<div class="card empty"><p><strong>「' + esc(t) + '」</strong>はまだ登録されていません。</p>' +
        '<p><a class="btn primary block" href="#/new?name=' + esc(encodeURIComponent(t)) + '&amp;miss=1">いま置き場所を登録する</a></p>' +
        '<p><button type="button" class="btn block" data-act="miss-add" data-q="' + esc(t) + '">見つけたら登録する（メモしておく）</button></p>' +
        '<p class="hint">メモした語はホームの「探したけど未登録」に残ります。漢字で登録したものは、読み（かな）でも探せるよう「別名・よみ」を入れておくと確実です。</p></div>';
    }
    let html = '';
    if (items.length) html += section('見つかったもの（' + items.length + '）', listHtml(items.map(r => r.item), { fromSearch: true }));
    if (places.length) {
      html += section('場所', '<ul class="list list-card">' + places.map(r => '<li>' + placeEntryHtml(r.place, '#/places/' + r.place.id, true) + '</li>').join('') + '</ul>');
    }
    return html;
  }

  function dashboardHtml() {
    const now = Date.now();
    const out = [];
    const oldest = state.items.reduce((m, i) => Math.min(m, i.createdAt || now), now);
    const rem = C.backupReminder(state.meta, state.items.length, now, oldest);
    if (rem.show) {
      out.push('<div class="card warn"><h2>バックアップをおすすめします</h2><p class="small">' +
        (rem.days == null ? 'まだ一度も書き出していません' : rem.days + '日間書き出していません') +
        '（変更 ' + rem.changes + ' 件）。ブラウザに保存したデータは、端末の空き容量不足などで消えることがあります。</p>' +
        '<a class="btn small" href="#/data">書き出す</a></div>');
    }
    if (!state.items.length) {
      out.push('<div class="card info prose"><h2>はじめに</h2>' +
        '<p>よく探すものから、<b>置いた場所を写真つきで</b>登録しましょう。探すときは上の欄に名前を入れるだけです。</p>' +
        '<ol><li>下の「置いた」から、ものの名前・場所・写真を登録</li><li>使ったら元の場所へ（「定位置」から外れたものはホームに出ます）</li><li>見つからなかったときは「メモしておく」→ 見つけたら登録</li></ol>' +
        '<p class="small">よく探すもの:</p><div class="chips">' +
        ITEM_SUGGESTIONS.map(n => '<a class="chip" href="#/new?name=' + esc(encodeURIComponent(n)) + '">' + esc(n) + '</a>').join('') +
        '</div></div>');
    }
    const misses = state.meta.misses || [];
    if (misses.length) {
      out.push(section('探したけど未登録', '<div class="chips">' + misses.map(m =>
        '<span class="chip"><a href="#/new?name=' + esc(encodeURIComponent(m.q)) + '&amp;miss=1">' + esc(m.q) +
        (m.count > 1 ? '（' + m.count + '回）' : '') + '</a>' +
        '<button type="button" class="x" data-act="miss-del" data-q="' + esc(m.q) + '" aria-label="' + esc(m.q) + ' をメモから消す">×</button></span>').join('') +
        '</div><p class="hint">見つかったらタップして置き場所を登録しましょう。</p>'));
    }
    const lent = state.items.filter(i => i.status === 'lent');
    if (lent.length) out.push(section('貸しているもの', listHtml(lent)));
    const misplaced = state.items.filter(C.isMisplaced);
    if (misplaced.length) out.push(section('定位置に戻していないもの', listHtml(misplaced, { returnBtn: true })));
    const freq = C.frequentlySearched(state.items, 5);
    if (freq.length) {
      out.push(section('よく探すもの', listHtml(freq) +
        '<p class="hint">よく探すものほど、定位置を決めて写真を残しておくと探す時間が減ります。</p>'));
    }
    const recent = state.items.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10);
    if (recent.length) {
      out.push(section('最近置いたもの', listHtml(recent) +
        (state.items.length > recent.length ? '<p><a class="btn block" href="#/all">すべてのもの（' + state.items.length + '件）</a></p>' : '')));
    }
    return out.join('');
  }

  function renderAll() {
    const items = state.items.slice().sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    setView('すべてのもの', items.length ? listHtml(items) : '<div class="card empty">まだ登録がありません。</div>', { back: true });
  }

  // ---------------------------------------------------------------------------
  // もの の詳細
  // ---------------------------------------------------------------------------
  function historyText(h) {
    const where = esc(pathOf(h.placeId)) + (h.detail ? '（' + esc(h.detail) + '）' : '');
    switch (h.kind) {
      case 'created': return '登録: ' + where;
      case 'moved': return '移動: ' + where;
      case 'found': return 'ここにあった: ' + where;
      case 'returned': return '返ってきた';
      case 'lent': return esc(h.lentTo || '相手未記入') + ' に貸した';
      case 'home': return '定位置に戻した: ' + where;
      default: return '';
    }
  }

  function renderItem(id) {
    const it = findItem(id);
    if (!it) return renderNotFound();
    const now = Date.now();
    const lent = it.status === 'lent';
    const misplaced = C.isMisplaced(it);
    const idA = ' data-id="' + esc(it.id) + '"';
    let html = '';
    if (it.photoId) {
      html += '<div class="photo-wrap"><img data-photo="' + esc(it.photoId) + '" data-kind="full" data-act="zoom" alt="' + esc(it.name) + 'の写真"></div>';
    }
    html += '<h2 class="item-name">' + esc(it.name) + '</h2>';
    if (it.aliases) html += '<p class="muted small">別名・よみ: ' + esc(it.aliases) + '</p>';
    if (lent) {
      html += '<div class="card lent"><div class="small muted">貸している</div><p><strong>' + esc(it.lentTo || '相手未記入') + '</strong>（' + fmtDate(it.lentAt) + ' から）</p>' +
        '<button type="button" class="btn primary block" data-act="returned"' + idA + '>' + ICON.check + ' 返ってきた</button></div>';
    }
    html += '<div class="card where-card"><div class="label">' + (lent ? '返ってきたら置く場所' : 'ここにある') + '</div>' +
      '<div class="path">' + esc(pathOf(it.placeId)) + '</div>' +
      (it.detail ? '<div class="detail">' + esc(it.detail) + '</div>' : '') +
      '<div class="seen">最後に確認: ' + C.relativeTime(it.lastSeenAt, now) + (it.lastSeenAt ? '（' + fmtDate(it.lastSeenAt) + '）' : '') + '</div></div>';
    if (misplaced) {
      html += '<div class="card warn"><div class="small">定位置</div><p><strong>' + esc(pathOf(it.homePlaceId)) + '</strong>' +
        (it.homeDetail ? ' ・ ' + esc(it.homeDetail) : '') + '</p>' +
        '<button type="button" class="btn block" data-act="return-home"' + idA + '>' + ICON.home + ' 定位置に戻した</button></div>';
    } else if (it.homePlaceId) {
      html += '<p class="muted small">' + (it.homePlaceId === it.placeId ? 'ここが定位置です' : '定位置: ' + esc(pathOf(it.homePlaceId))) + '</p>';
    }
    html += '<div class="actions">' +
      (lent ? '' : '<button type="button" class="btn primary" data-act="found"' + idA + '>' + ICON.check + ' ここにあった</button>') +
      '<a class="btn" href="#/move/' + esc(it.id) + '">' + ICON.move + ' 場所を移した</a>' +
      (lent ? '' : '<button type="button" class="btn" data-act="lend-toggle">' + ICON.lend + ' 貸した</button>') +
      '<a class="btn" href="#/edit/' + esc(it.id) + '">' + ICON.edit + ' 編集</a></div>';
    html += '<form class="card" data-form="lend"' + idA + ' hidden><div class="field"><label for="lend-to">誰に貸した？</label>' +
      '<input id="lend-to" name="to" type="text" maxlength="100" placeholder="例: 田中さん" autocomplete="off"></div>' +
      '<button type="submit" class="btn primary block">貸したことを記録</button></form>';
    html += section('履歴', '<ul class="timeline">' + (it.history.length
      ? it.history.map(h => '<li><time>' + fmtDate(h.at) + '</time><span>' + historyText(h) + '</span></li>').join('')
      : '<li>なし</li>') + '</ul>');
    html += '<p class="muted small">探した回数 ' + it.searchCount + ' ・ 「ここにあった」の回数 ' + it.foundCount + '</p>';
    html += '<p><button type="button" class="btn danger block" data-act="delete-item"' + idA + '>このものを削除</button></p>';
    setView(it.name, html, { back: true });
  }

  async function updateItem(id, fn, msg, opts) {
    const it = findItem(id);
    if (!it) return;
    const now = Date.now();
    const next = Object.assign({}, it, { updatedAt: now });
    fn(next, now);
    await saveItem(next);
    if (msg) toast(msg);
    if (!(opts && opts.noRender)) render(true);
  }

  const actFound = id => updateItem(id, (it, now) => {
    it.lastSeenAt = now;
    it.foundCount += 1;
    it.history = C.pushHistory(it.history, { at: now, kind: 'found', placeId: it.placeId, detail: it.detail, lentTo: '' });
  }, 'ここにあったことを記録しました');

  const actReturnHome = id => updateItem(id, (it, now) => {
    it.placeId = it.homePlaceId;
    it.detail = it.homeDetail || '';
    it.lastSeenAt = now;
    it.history = C.pushHistory(it.history, { at: now, kind: 'home', placeId: it.placeId, detail: it.detail, lentTo: '' });
  }, '定位置に戻しました');

  const actReturned = id => updateItem(id, (it, now) => {
    it.status = 'placed';
    it.lentTo = '';
    it.lentAt = null;
    it.lastSeenAt = now;
    it.history = C.pushHistory(it.history, { at: now, kind: 'returned', placeId: it.placeId, detail: it.detail, lentTo: '' });
  }, '返ってきたことを記録しました。置いた場所が違えば「場所を移した」で直せます');

  const actLend = (id, to) => updateItem(id, (it, now) => {
    it.status = 'lent';
    it.lentTo = to.slice(0, C.LIMITS.lentTo);
    it.lentAt = now;
    it.history = C.pushHistory(it.history, { at: now, kind: 'lent', placeId: it.placeId, detail: '', lentTo: it.lentTo });
  }, '貸したことを記録しました');

  async function actDeleteItem(id) {
    const it = findItem(id);
    if (!it) return;
    if (!confirm('「' + it.name + '」を削除しますか？ 写真と履歴も消え、元に戻せません。')) return;
    await deleteOne('items', id);
    await deletePhoto(it.photoId);
    state.items = state.items.filter(i => i.id !== id);
    await markChanged();
    toast('削除しました');
    navigate('#/', { replace: true });
  }

  // ---------------------------------------------------------------------------
  // 場所の入力欄（最近の場所チップ＋ツリーから選ぶ）
  // ---------------------------------------------------------------------------
  function placeWidgetHtml(selectedId) {
    const recent = C.recentPlaceIds(state.items, state.places, 6);
    return '<button type="button" class="place-field" data-act="pick-place">' + ICON.place +
      '<span class="grow">' + (selectedId ? esc(pathOf(selectedId)) : '<span class="placeholder">場所を選ぶ</span>') + '</span>' + ICON.chev + '</button>' +
      (recent.length ? '<div class="chips recent-places" aria-label="最近の場所">' + recent.map(id =>
        '<button type="button" class="chip' + (id === selectedId ? ' on' : '') + '" data-act="choose-recent" data-id="' + esc(id) + '">' +
        esc(pathOf(id)) + '</button>').join('') + '</div>' : '');
  }

  function refreshPlaceWidget() {
    const w = document.getElementById('place-widget');
    if (w && state.form) w.innerHTML = placeWidgetHtml(state.form.placeId);
  }

  // ---- 場所を選ぶシート ----
  const picker = document.getElementById('picker');
  const pk = { cur: null, exclude: new Set(), allowRoot: false, resolve: null };

  function renderPicker() {
    const crumbs = document.getElementById('picker-crumbs');
    const list = document.getElementById('picker-list');
    const chooseBtn = document.getElementById('picker-choose');
    const path = C.placePath(state.placesById, pk.cur);
    crumbs.innerHTML = (pk.cur ? '<button type="button" data-pick="open" data-id="">すべて</button>' : '<span class="cur">すべて</span>') +
      path.map((p, i) => '<span class="sep">›</span>' + (i === path.length - 1
        ? '<span class="cur">' + esc(p.name) + '</span>'
        : '<button type="button" data-pick="open" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button>')).join('');
    const kids = C.childrenOf(state.places, pk.cur).filter(p => !pk.exclude.has(p.id));
    let html = kids.map(p => '<li><button type="button" class="entry" data-pick="open" data-id="' + esc(p.id) + '">' +
      '<span class="body"><span class="name">' + esc(p.name) + '</span><span class="meta">' + C.childrenOf(state.places, p.id).length + ' の場所 ・ ' + countIn(p.id) + '件</span></span>' +
      '<span class="chev">' + ICON.chev + '</span></button></li>').join('');
    if (!kids.length) {
      html = '<li class="empty small">' + (pk.cur ? 'この中に場所はありません。このまま「決定」するか、下で細かい場所を追加できます。' : 'まだ場所がありません。よくある場所から選ぶか、下で追加してください。') + '</li>';
    }
    if (!pk.cur) {
      const sug = ROOM_SUGGESTIONS.filter(n => !state.places.some(p => !p.parentId && p.name === n));
      if (sug.length) {
        html += '<li class="empty small"><div class="muted">よくある場所を追加</div><div class="chips">' +
          sug.map(n => '<button type="button" class="chip" data-pick="suggest" data-name="' + esc(n) + '">＋ ' + esc(n) + '</button>').join('') + '</div></li>';
      }
    }
    list.innerHTML = html;
    if (pk.cur) {
      chooseBtn.disabled = false;
      chooseBtn.textContent = '「' + C.placePath(state.placesById, pk.cur).map(p => p.name).pop() + '」に決定';
    } else {
      chooseBtn.disabled = !pk.allowRoot;
      chooseBtn.textContent = pk.allowRoot ? '最上位に置く' : '場所を選んでください';
    }
  }

  function pickPlace(opts) {
    pk.cur = opts.current && state.placesById.has(opts.current) ? opts.current : null;
    pk.exclude = opts.exclude || new Set();
    if (pk.cur && pk.exclude.has(pk.cur)) pk.cur = null;
    pk.allowRoot = !!opts.allowRoot;
    document.getElementById('picker-title').textContent = opts.title || '場所を選ぶ';
    renderPicker();
    picker.showModal();
    return new Promise(resolve => { pk.resolve = resolve; });
  }

  function closePicker(result) {
    const r = pk.resolve;
    pk.resolve = null;
    if (picker.open) picker.close();
    if (r) r(result);
  }

  picker.addEventListener('click', async e => {
    if (e.target === picker) {
      // ダイアログの外側（背景）を押したときだけ閉じる。シート自体の余白では閉じない
      const r = picker.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closePicker(undefined);
      return;
    }
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const a = b.dataset.pick;
    if (a === 'close') closePicker(undefined);
    else if (a === 'open') { pk.cur = b.dataset.id || null; renderPicker(); }
    else if (a === 'choose') closePicker(pk.cur);
    else if (a === 'suggest') {
      const p = await addPlace(b.dataset.name, pk.cur);
      pk.cur = p.id;
      renderPicker();
    }
  });
  picker.addEventListener('cancel', e => { e.preventDefault(); closePicker(undefined); });
  document.getElementById('picker-add').addEventListener('submit', async e => {
    e.preventDefault();
    const input = e.target.elements.name;
    const name = input.value.trim();
    if (!name) return input.focus();
    const p = await addPlace(name, pk.cur);
    input.value = '';
    pk.cur = p.id;
    renderPicker();
    toast('「' + p.name + '」を追加しました');
  });

  // ---------------------------------------------------------------------------
  // 登録・編集フォーム
  // ---------------------------------------------------------------------------
  function photoWidgetHtml() {
    const f = state.form;
    let preview;
    if (f.photo && f.photo.previewUrl) preview = '<img class="preview" src="' + esc(f.photo.previewUrl) + '" alt="選んだ写真">';
    else if (f.photo !== 'remove' && f.existingPhotoId) preview = '<img class="preview" data-photo="' + esc(f.existingPhotoId) + '" alt="登録済みの写真">';
    else preview = '<span class="preview">' + ICON.image + '</span>';
    const has = (f.photo && f.photo.previewUrl) || (f.photo !== 'remove' && f.existingPhotoId);
    return '<div class="photo-field">' + preview + '<div class="buttons">' +
      '<label class="btn file-btn">' + ICON.camera + ' 撮影する<input type="file" accept="image/*" capture="environment" data-photo-input aria-label="カメラで撮影"></label>' +
      '<label class="btn file-btn">' + ICON.image + ' 写真を選ぶ<input type="file" accept="image/*" data-photo-input aria-label="写真を選ぶ"></label>' +
      (has ? '<button type="button" class="btn small danger" data-act="photo-remove">写真を外す</button>' : '') +
      '</div></div>';
  }

  function refreshPhotoWidget() {
    const w = document.getElementById('photo-widget');
    if (w) { w.innerHTML = photoWidgetHtml(); hydrate(w); }
  }

  function clearFormPhoto() {
    const f = state.form;
    if (f && f.photo && f.photo.previewUrl) URL.revokeObjectURL(f.photo.previewUrl);
  }

  function renderItemForm(id, params) {
    const it = id ? findItem(id) : null;
    if (id && !it) return renderNotFound();
    clearFormPhoto();
    const presetPlace = params.get('place');
    state.form = {
      kind: 'item',
      id: it ? it.id : null,
      placeId: it ? it.placeId : (presetPlace && state.placesById.has(presetPlace) ? presetPlace : null),
      photo: null,
      existingPhotoId: it ? it.photoId : null,
      missQ: params.get('miss') ? params.get('name') : null,
    };
    const name = it ? it.name : (params.get('name') || '');
    const isHome = it ? !!it.homePlaceId && it.homePlaceId === it.placeId : true;
    const otherHome = it && it.homePlaceId && it.homePlaceId !== it.placeId ? pathOf(it.homePlaceId) : '';
    setView(it ? '編集' : '置いた場所を記録',
      '<form data-form="item" novalidate>' +
      '<div class="field"><label for="f-name">もの <span class="req">*</span></label>' +
      '<input id="f-name" name="name" type="text" required maxlength="100" value="' + esc(name) + '" placeholder="例: 車の鍵" autocomplete="off" enterkeyhint="next"></div>' +
      '<div class="field"><span class="label">場所</span><div id="place-widget">' + placeWidgetHtml(state.form.placeId) + '</div></div>' +
      '<div class="field"><label for="f-detail">詳しい位置（任意）</label>' +
      '<input id="f-detail" name="detail" type="text" maxlength="1000" value="' + esc(it ? it.detail : '') + '" placeholder="例: 上から2段目の右奥、青いポーチの中" autocomplete="off"></div>' +
      '<div class="field"><span class="label">写真（任意・おすすめ）</span><div id="photo-widget">' + photoWidgetHtml() + '</div>' +
      '<p class="hint">「どこの・何の中に」が分かるよう、少し引いて撮ると探すときに役立ちます。</p></div>' +
      '<label class="check"><input type="checkbox" name="home"' + (isHome ? ' checked' : '') + '><span>ここを<b>定位置</b>にする<br><span class="small muted">いつも戻す場所。ここから動かすとホームの「定位置に戻していないもの」に出ます。' +
      (otherHome ? '現在の定位置: ' + esc(otherHome) : '') + '</span></span></label>' +
      '<div class="field"><label for="f-aliases">別名・よみ（任意・検索用）</label>' +
      '<input id="f-aliases" name="aliases" type="text" maxlength="300" value="' + esc(it ? it.aliases : '') + '" placeholder="例: かぎ キー 車" autocomplete="off">' +
      '<p class="hint">スペース区切り。漢字の名前は読み（かな）も入れておくと確実に見つかります。</p></div>' +
      '<p class="hint">キーボードのマイクで音声入力すると速く登録できます。</p>' +
      '<div class="sticky-save"><button type="submit" class="btn primary block">保存</button></div>' +
      '</form>', { back: !!it || params.has('name') || params.has('place') });
    if (!it && !name) document.getElementById('f-name').focus();
  }

  async function submitItemForm(form) {
    const f = state.form;
    const name = form.elements.name.value.trim();
    if (!name) { toast('ものの名前を入れてください'); form.elements.name.focus(); return; }
    const detail = form.elements.detail.value.trim();
    const aliases = form.elements.aliases.value.trim();
    const isHome = form.elements.home.checked;
    const now = Date.now();
    const existing = f.id ? findItem(f.id) : null;
    let photoId = existing ? existing.photoId : null;
    let oldPhoto = null;
    if (f.photo === 'remove') { oldPhoto = photoId; photoId = null; }
    else if (f.photo && f.photo.full) {
      const pid = C.makeId();
      await putMany('photos', [{ id: pid, type: f.photo.type, full: f.photo.full, thumb: f.photo.thumb, w: f.photo.w, h: f.photo.h, createdAt: now }]);
      oldPhoto = photoId;
      photoId = pid;
    }
    let item;
    if (existing) {
      item = Object.assign({}, existing, { name, aliases, detail, photoId, placeId: f.placeId, updatedAt: now });
      if (existing.placeId !== f.placeId || existing.detail !== detail) {
        item.history = C.pushHistory(existing.history, { at: now, kind: 'moved', placeId: f.placeId, detail, lentTo: '' });
        item.lastSeenAt = now;
      }
      if (isHome) { item.homePlaceId = f.placeId; item.homeDetail = detail; }
      else if (existing.homePlaceId && existing.homePlaceId === existing.placeId) { item.homePlaceId = null; item.homeDetail = ''; }
    } else {
      item = C.sanitizeItem({
        id: C.makeId(), name, aliases, detail, photoId, placeId: f.placeId,
        homePlaceId: isHome ? f.placeId : null, homeDetail: isHome ? detail : '',
        status: 'placed', lastSeenAt: now, searchCount: 0, foundCount: 0,
        history: [{ at: now, kind: 'created', placeId: f.placeId, detail }], createdAt: now, updatedAt: now,
      }, now);
    }
    await saveItem(item);
    if (oldPhoto) await deletePhoto(oldPhoto);
    let misses = C.removeMiss(state.meta.misses, name);
    if (f.missQ) misses = C.removeMiss(misses, f.missQ);
    if (misses.length !== (state.meta.misses || []).length) await setMeta('misses', misses);
    clearFormPhoto();
    state.form = null;
    toast('保存しました');
    navigate('#/item/' + item.id, { replace: true });
  }

  // ---------------------------------------------------------------------------
  // 移動の記録
  // ---------------------------------------------------------------------------
  function renderMove(id) {
    const it = findItem(id);
    if (!it) return renderNotFound();
    state.form = { kind: 'move', id: it.id, placeId: null };
    setView('移動を記録',
      '<p class="muted">' + esc(it.name) + ' ・ いま: ' + esc(pathOf(it.placeId)) + (it.detail ? '（' + esc(it.detail) + '）' : '') + '</p>' +
      '<form data-form="move" novalidate>' +
      '<div class="field"><span class="label">新しい場所</span><div id="place-widget">' + placeWidgetHtml(null) + '</div></div>' +
      '<div class="field"><label for="m-detail">詳しい位置（任意）</label>' +
      '<input id="m-detail" name="detail" type="text" maxlength="1000" placeholder="例: ソファの右のクッションの下" autocomplete="off"></div>' +
      '<label class="check"><input type="checkbox" name="home"><span>ここを新しい<b>定位置</b>にする</span></label>' +
      '<div class="sticky-save"><button type="submit" class="btn primary block">移動を記録</button></div></form>', { back: true });
  }

  async function submitMove(form) {
    const f = state.form;
    if (!f.placeId) { toast('新しい場所を選んでください'); return; }
    const detail = form.elements.detail.value.trim();
    const isHome = form.elements.home.checked;
    const id = f.id;
    state.form = null;
    await updateItem(id, (it, now) => {
      it.placeId = f.placeId;
      it.detail = detail;
      it.lastSeenAt = now;
      if (it.status === 'lent') { it.status = 'placed'; it.lentTo = ''; it.lentAt = null; }
      if (isHome) { it.homePlaceId = f.placeId; it.homeDetail = detail; }
      it.history = C.pushHistory(it.history, { at: now, kind: 'moved', placeId: f.placeId, detail, lentTo: '' });
    }, '移動を記録しました', { noRender: true });
    navigate('#/item/' + id, { replace: true });
  }

  // ---------------------------------------------------------------------------
  // 場所
  // ---------------------------------------------------------------------------
  function crumbsHtml(id) {
    const path = C.placePath(state.placesById, id);
    return '<nav class="crumbs" aria-label="現在の階層">' +
      (id ? '<a href="#/places">すべての場所</a>' : '<span class="cur">すべての場所</span>') +
      path.map((p, i) => '<span class="sep">›</span>' + (i === path.length - 1
        ? '<span class="cur">' + esc(p.name) + '</span>'
        : '<a href="#/places/' + esc(p.id) + '">' + esc(p.name) + '</a>')).join('') + '</nav>';
  }

  function renderPlaces(id) {
    const place = id ? state.placesById.get(id) : null;
    if (id && !place) return renderNotFound();
    const kids = C.childrenOf(state.places, id);
    const here = state.items.filter(i => (i.placeId || null) === (id || null)).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    let html = crumbsHtml(id);
    if (place) {
      if (place.photoId) html += '<div class="photo-wrap"><img data-photo="' + esc(place.photoId) + '" data-kind="full" data-act="zoom" alt="' + esc(place.name) + 'の写真"></div>';
      if (place.note) html += '<p class="prose">' + esc(place.note) + '</p>';
      html += '<div class="actions"><a class="btn primary" href="#/new?place=' + esc(encodeURIComponent(place.id)) + '">' + ICON.box + ' ものを登録</a>' +
        '<a class="btn" href="#/place-edit/' + esc(place.id) + '">' + ICON.edit + ' 場所を編集</a></div>';
    }
    html += section(place ? 'この中の場所' : '場所', kids.length
      ? '<ul class="list list-card">' + kids.map(p => '<li>' + placeEntryHtml(p, '#/places/' + p.id, false) + '</li>').join('') + '</ul>'
      : '<p class="muted small">' + (place ? '「棚の上段」「引き出し」など、細かい場所を追加できます。' : 'まず部屋や大きな場所を追加しましょう。') + '</p>');
    html += '<form class="inline-add" data-form="add-place"><input type="text" name="name" maxlength="100" placeholder="' +
      (place ? esc(place.name) + 'の中に場所を追加' : '場所を追加（例: リビング）') + '" autocomplete="off" enterkeyhint="done" aria-label="追加する場所の名前">' +
      '<button type="submit" class="btn">追加</button></form>';
    if (!place) {
      const sug = ROOM_SUGGESTIONS.filter(n => !state.places.some(p => !p.parentId && p.name === n));
      if (sug.length) {
        html += '<div class="chips">' + sug.map(n => '<button type="button" class="chip" data-act="suggest-place" data-name="' + esc(n) + '">＋ ' + esc(n) + '</button>').join('') + '</div>';
      }
    }
    if (here.length || place) {
      html += section(place ? 'ここにあるもの' : '場所未設定のもの', here.length ? listHtml(here) : '<p class="muted small">まだありません。</p>');
    }
    setView(place ? place.name : '場所', html, { back: !!place });
  }

  function renderPlaceEdit(id) {
    const place = state.placesById.get(id);
    if (!place) return renderNotFound();
    clearFormPhoto();
    state.form = { kind: 'place', id: place.id, parentId: place.parentId, photo: null, existingPhotoId: place.photoId };
    const hasKids = state.places.some(p => p.parentId === place.id);
    const hasItems = state.items.some(i => i.placeId === place.id);
    setView('場所を編集',
      '<form data-form="place" novalidate>' +
      '<div class="field"><label for="p-name">名前 <span class="req">*</span></label><input id="p-name" name="name" type="text" maxlength="100" required value="' + esc(place.name) + '" autocomplete="off"></div>' +
      '<div class="field"><span class="label">どこの中にあるか</span><button type="button" class="place-field" data-act="pick-parent">' + ICON.place +
      '<span class="grow" id="parent-label">' + esc(place.parentId ? pathOf(place.parentId) : '最上位') + '</span>' + ICON.chev + '</button></div>' +
      '<div class="field"><span class="label">写真（任意）</span><div id="photo-widget">' + photoWidgetHtml() + '</div></div>' +
      '<div class="field"><label for="p-note">メモ（任意）</label><textarea id="p-note" name="note" maxlength="1000" placeholder="例: 鍵付き。鍵は財布の中">' + esc(place.note) + '</textarea></div>' +
      '<div class="sticky-save"><button type="submit" class="btn primary block">保存</button></div></form>' +
      '<div class="card"><h2>この場所を削除</h2>' +
      (hasKids || hasItems
        ? '<p class="small muted">中に' + (hasKids ? '場所' : '') + (hasKids && hasItems ? 'や' : '') + (hasItems ? 'もの' : '') + 'があるため削除できません。先に移動してください。</p>'
        : '<button type="button" class="btn danger block" data-act="delete-place" data-id="' + esc(place.id) + '">削除する</button>') + '</div>',
      { back: true });
  }

  async function submitPlaceForm(form) {
    const f = state.form;
    const place = state.placesById.get(f.id);
    if (!place) return;
    const name = form.elements.name.value.trim();
    if (!name) { toast('名前を入れてください'); form.elements.name.focus(); return; }
    const now = Date.now();
    let photoId = place.photoId;
    let oldPhoto = null;
    if (f.photo === 'remove') { oldPhoto = photoId; photoId = null; }
    else if (f.photo && f.photo.full) {
      const pid = C.makeId();
      await putMany('photos', [{ id: pid, type: f.photo.type, full: f.photo.full, thumb: f.photo.thumb, w: f.photo.w, h: f.photo.h, createdAt: now }]);
      oldPhoto = photoId;
      photoId = pid;
    }
    if (f.parentId && C.wouldCreateCycle(state.placesById, place.id, f.parentId)) { toast('自分の中には移動できません'); return; }
    await savePlace(Object.assign({}, place, {
      name: name.slice(0, C.LIMITS.name), note: form.elements.note.value.trim().slice(0, C.LIMITS.note),
      parentId: f.parentId || null, photoId, updatedAt: now,
    }));
    if (oldPhoto) await deletePhoto(oldPhoto);
    clearFormPhoto();
    state.form = null;
    toast('保存しました');
    navigate('#/places/' + place.id, { replace: true });
  }

  async function actDeletePlace(id) {
    const place = state.placesById.get(id);
    if (!place) return;
    if (state.places.some(p => p.parentId === id) || state.items.some(i => i.placeId === id)) { toast('中に場所やものがあるため削除できません'); return; }
    if (!confirm('場所「' + place.name + '」を削除しますか？')) return;
    // この場所を定位置にしていたものは、定位置を外す
    const affected = state.items.filter(i => i.homePlaceId === id).map(i => Object.assign({}, i, { homePlaceId: null, homeDetail: '', updatedAt: Date.now() }));
    if (affected.length) {
      await putMany('items', affected);
      state.items = state.items.map(i => affected.find(a => a.id === i.id) || i);
    }
    await deleteOne('places', id);
    await deletePhoto(place.photoId);
    state.places = state.places.filter(p => p.id !== id);
    reindex();
    await markChanged();
    toast('削除しました');
    navigate(place.parentId ? '#/places/' + place.parentId : '#/places', { replace: true });
  }

  // ---------------------------------------------------------------------------
  // データ（バックアップ・読み込み・保存の状態）
  // ---------------------------------------------------------------------------
  function fmtBytes(n) {
    if (n == null) return '—';
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(1) + ' GB';
  }

  async function renderData() {
    const myHash = lastHash;
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
    const photoCount = (await getAllKeys('photos')).length;
    if (lastHash !== myHash) return;
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const last = state.meta.lastBackupAt;
    let html = '<div class="card"><div class="stat"><div><b>' + state.items.length + '</b><span>もの</span></div><div><b>' + state.places.length +
      '</b><span>場所</span></div><div><b>' + photoCount + '</b><span>写真</span></div></div>' +
      '<p class="small muted">使用量: ' + fmtBytes(est && est.usage) + (est && est.quota ? ' / 上限の目安 ' + fmtBytes(est.quota) : '') + '</p></div>';

    html += '<div class="card"><h2>バックアップ（書き出し）</h2>' +
      '<p class="small">データはこの端末のブラウザの中だけにあります。機種変更・故障・ブラウザのデータ削除に備えて、ときどき書き出してください。iPhone では「ファイルに保存」から iCloud Drive に置けます。</p>' +
      '<p class="small muted">最後に書き出した日: ' + (last ? fmtDate(last) + '（' + C.relativeTime(last, Date.now()) + '）' : 'まだありません') +
      ' ・ その後の変更: ' + (state.meta.changesSinceBackup || 0) + '件</p>' +
      '<label class="check"><input type="checkbox" id="exp-photos" checked><span>写真も含める（ファイルが大きくなります）</span></label>' +
      '<div id="export-area"><button type="button" class="btn primary block" data-act="export-prepare">書き出すファイルを作る</button></div></div>';

    html += '<div class="card"><h2>読み込み（復元・ほかの端末から）</h2>' +
      '<label class="btn block file-btn">バックアップファイルを選ぶ<input type="file" accept="application/json,.json" data-import-input aria-label="バックアップファイルを選ぶ"></label>' +
      '<div id="import-area"></div></div>';

    html += '<div class="card"><h2>データを消えにくくする</h2>' +
      (persisted
        ? '<p class="small">有効です。ブラウザが容量不足のときに自動で消す対象から外れます。</p>'
        : '<p class="small">未設定です。有効にすると、端末の容量不足のときにブラウザが自動でデータを消す対象から外れます（ブラウザが許可しない場合もあります）。どちらにしても書き出しは続けてください。</p>' +
          '<button type="button" class="btn block" data-act="persist">消えにくくする</button>') + '</div>';

    html += '<details class="card"' + (standalone ? '' : ' open') + '><summary>ホーム画面に追加する（アプリとして使う）</summary><div class="prose small">' +
      '<p><b>iPhone（Safari）</b>: 下の共有ボタン → 「ホーム画面に追加」</p>' +
      '<p><b>Android（Chrome）</b>: 右上のメニュー → 「アプリをインストール」または「ホーム画面に追加」</p>' +
      '<p>追加すると全画面で起動し、電波がなくても使えます。<b>Safari のタブで開いた場合とホーム画面から開いた場合では、保存場所が別になる</b>ことがあります。いつも同じ開き方で使ってください。</p></div></details>';

    html += '<details class="card"><summary>プライバシー</summary><div class="prose small">' +
      '<p>登録したもの・場所・写真は、この端末のブラウザの中（IndexedDB）にだけ保存します。サーバーへの送信はしません。ページの設定（CSP）で、外部への通信そのものを禁止しています。</p>' +
      '<p>写真は保存時に縮小して作り直すため、撮影場所（GPS）などの付加情報は残りません。</p>' +
      '<p>書き出したファイルには写真と場所が含まれます。共有先に注意してください。</p></div></details>';

    setView('データ', html, { back: false });
  }

  function stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

  async function exportPrepare() {
    const area = document.getElementById('export-area');
    const withPhotos = document.getElementById('exp-photos').checked;
    area.innerHTML = '<p class="small muted">作成中…</p>';
    const photos = withPhotos ? (await getAll('photos')).map(p => ({
      id: p.id, type: p.type, w: p.w, h: p.h, createdAt: p.createdAt,
      full: C.bytesToBase64(new Uint8Array(p.full)), thumb: p.thumb ? C.bytesToBase64(new Uint8Array(p.thumb)) : null,
    })) : [];
    const backup = C.buildBackup({ places: state.places, items: state.items, photos, misses: state.meta.misses }, Date.now());
    const name = 'okiba-backup-' + stamp() + '.json';
    const file = new File([JSON.stringify(backup)], name, { type: 'application/json' });
    if (state.prepared) URL.revokeObjectURL(state.prepared.url);
    state.prepared = { file, url: URL.createObjectURL(file) };
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    area.innerHTML = '<p class="small">準備できました（' + esc(name) + '・' + fmtBytes(file.size) + '）</p>' +
      (canShare ? '<p><button type="button" class="btn primary block" data-act="export-share">共有して保存（ファイルに保存・AirDrop など）</button></p>' : '') +
      '<p><a class="btn block" href="' + esc(state.prepared.url) + '" download="' + esc(name) + '" data-act="export-download">ダウンロード</a></p>';
  }

  async function markBackedUp() {
    await setMeta('lastBackupAt', Date.now());
    await setMeta('changesSinceBackup', 0);
  }

  async function exportShare() {
    if (!state.prepared) return;
    try {
      await navigator.share({ files: [state.prepared.file], title: 'おきばメモ バックアップ' });
      await markBackedUp();
      toast('書き出しました');
      render(true);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast('共有できませんでした。「ダウンロード」を使ってください');
    }
  }

  async function importChosen(file) {
    const area = document.getElementById('import-area');
    let obj;
    try { obj = JSON.parse(await file.text()); } catch (e) { area.innerHTML = '<p class="small">JSON として読めませんでした。</p>'; return; }
    const r = C.validateBackup(obj, Date.now());
    if (r.fatal) { state.importPending = null; area.innerHTML = '<div class="card warn"><p class="small">' + esc(r.fatal) + '</p></div>'; return; }
    state.importPending = r.data;
    const w = r.warnings || [];
    area.innerHTML = '<div class="card info"><p class="small">読み込めます: もの ' + r.data.items.length + '件・場所 ' + r.data.places.length + '件・写真 ' + r.data.photos.length + '枚</p>' +
      (w.length ? '<details><summary class="small">注意 ' + w.length + '件（自動で直しました）</summary><ul class="small">' +
        w.slice(0, 20).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></details>' : '') +
      '<div class="actions"><button type="button" class="btn primary" data-act="import-merge">統合する</button>' +
      '<button type="button" class="btn danger" data-act="import-replace">置き換える</button></div>' +
      '<p class="hint">統合: 今のデータに足します（同じものは新しい方を残す）。置き換え: 今のデータを消して、ファイルの内容にします。</p></div>';
  }

  function decodePhotos(list) {
    return list.map(p => {
      const full = C.base64ToBytes(p.full).buffer;
      return { id: p.id, type: p.type, w: p.w, h: p.h, createdAt: p.createdAt, full, thumb: p.thumb ? C.base64ToBytes(p.thumb).buffer : null };
    });
  }

  async function writeAll(places, items, newPhotos, clearPhotos) {
    const t = db.transaction(['places', 'items', 'photos'], 'readwrite');
    t.objectStore('places').clear();
    t.objectStore('items').clear();
    if (clearPhotos) t.objectStore('photos').clear();
    for (const p of places) t.objectStore('places').put(p);
    for (const i of items) t.objectStore('items').put(i);
    for (const ph of newPhotos) t.objectStore('photos').put(ph);
    await txDone(t);
  }

  async function importApply(mode) {
    const inc = state.importPending;
    if (!inc) return;
    if (mode === 'replace' && !confirm('この端末のデータ（もの ' + state.items.length + '件・場所 ' + state.places.length + '件）を消して、ファイルの内容に置き換えます。よろしいですか？\n\n迷ったら先に「書き出す」で今のデータを保存してください。')) return;
    try {
      if (mode === 'replace') {
        await writeAll(inc.places, inc.items, decodePhotos(inc.photos), true);
        await setMeta('misses', inc.misses);
        await setMeta('changesSinceBackup', 0);
      } else {
        const curPhotoIds = new Set(await getAllKeys('photos'));
        const merged = C.mergeData(
          { places: state.places, items: state.items, photos: [...curPhotoIds].map(id => ({ id })), misses: state.meta.misses || [] }, inc);
        await writeAll(merged.places, merged.items, decodePhotos(inc.photos.filter(p => !curPhotoIds.has(p.id))), false);
        await setMeta('misses', merged.misses);
        await markChanged();
      }
    } catch (err) {
      toast('読み込みに失敗しました: ' + err.message);
      return;
    }
    thumbCache.forEach(u => URL.revokeObjectURL(u));
    thumbCache.clear();
    state.importPending = null;
    await loadAll();
    toast('読み込みました');
    navigate('#/', { replace: true });
  }

  // ---------------------------------------------------------------------------
  // イベント（委譲）
  // ---------------------------------------------------------------------------
  view.addEventListener('input', e => {
    if (e.target.id === 'q') {
      state.query = e.target.value;
      renderHomeBody();
    }
  });

  view.addEventListener('change', async e => {
    const t = e.target;
    if (t.matches('[data-photo-input]') && t.files && t.files[0] && state.form) {
      const form = state.form;
      form.processing = true;
      try {
        const ph = await processImage(t.files[0]);
        if (state.form !== form) return;
        clearFormPhoto();
        ph.previewUrl = URL.createObjectURL(new Blob([ph.thumb], { type: ph.type }));
        state.form.photo = ph;
        refreshPhotoWidget();
      } catch (err) {
        toast(err.message);
      } finally {
        form.processing = false;
        t.value = '';
      }
    } else if (t.matches('[data-import-input]') && t.files && t.files[0]) {
      await importChosen(t.files[0]);
      t.value = '';
    }
  });

  view.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    if (state.form && state.form.processing && (kind === 'item' || kind === 'place')) { toast('写真を処理しています。少し待ってから保存してください'); return; }
    try {
      if (kind === 'search') { const q = document.getElementById('q'); if (q) q.blur(); }
      else if (kind === 'item') await submitItemForm(form);
      else if (kind === 'move') await submitMove(form);
      else if (kind === 'place') await submitPlaceForm(form);
      else if (kind === 'lend') await actLend(form.dataset.id, form.elements.to.value.trim());
      else if (kind === 'add-place') {
        const input = form.elements.name;
        const name = input.value.trim();
        if (!name) return input.focus();
        const { parts } = parseHash();
        await addPlace(name, parts[1] || null);
        toast('「' + name + '」を追加しました');
        render(true);
      }
    } catch (err) {
      console.error(err);
      toast('保存できませんでした: ' + err.message);
    }
  });

  view.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]');
    if (!el || !view.contains(el)) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    try {
      switch (act) {
        case 'open-result': {
          e.preventDefault();
          const q = state.query;
          await updateItemSilently(id, it => { it.searchCount += 1; });
          const misses = C.removeMiss(state.meta.misses, q);
          if (misses.length !== (state.meta.misses || []).length) await setMeta('misses', misses);
          navigate('#/item/' + id);
          break;
        }
        case 'miss-add':
          await setMeta('misses', C.addMiss(state.meta.misses, el.dataset.q, Date.now()));
          toast('メモしました。見つけたらホームから登録できます');
          state.query = '';
          renderHome();
          break;
        case 'miss-del':
          e.preventDefault();
          await setMeta('misses', C.removeMiss(state.meta.misses, el.dataset.q));
          renderHomeBody();
          break;
        case 'found': await actFound(id); break;
        case 'return-home': e.preventDefault(); await actReturnHome(id); break;
        case 'returned': await actReturned(id); break;
        case 'lend-toggle': {
          const f = view.querySelector('form[data-form="lend"]');
          f.hidden = !f.hidden;
          if (!f.hidden) f.elements.to.focus();
          break;
        }
        case 'delete-item': await actDeleteItem(id); break;
        case 'delete-place': await actDeletePlace(id); break;
        case 'zoom': {
          const lb = document.getElementById('lightbox');
          document.getElementById('lightbox-img').src = el.src;
          lb.showModal();
          break;
        }
        case 'pick-place': {
          const r = await pickPlace({ current: state.form && state.form.placeId });
          if (r !== undefined && state.form) { state.form.placeId = r; refreshPlaceWidget(); }
          break;
        }
        case 'choose-recent':
          if (state.form) { state.form.placeId = id; refreshPlaceWidget(); }
          break;
        case 'pick-parent': {
          const f = state.form;
          const r = await pickPlace({ current: f.parentId, exclude: C.descendantIds(state.places, f.id), allowRoot: true, title: 'どこの中にあるか' });
          if (r !== undefined) {
            f.parentId = r;
            document.getElementById('parent-label').textContent = r ? pathOf(r) : '最上位';
          }
          break;
        }
        case 'photo-remove':
          clearFormPhoto();
          state.form.photo = 'remove';
          refreshPhotoWidget();
          break;
        case 'suggest-place':
          await addPlace(el.dataset.name, null);
          toast('「' + el.dataset.name + '」を追加しました');
          render(true);
          break;
        case 'export-prepare': await exportPrepare(); break;
        case 'export-share': await exportShare(); break;
        case 'export-download':
          await markBackedUp();
          setTimeout(() => toast('ダウンロードしました（保存先を確認してください）'), 300);
          break;
        case 'import-merge': await importApply('merge'); break;
        case 'import-replace': await importApply('replace'); break;
        case 'persist': {
          const ok = navigator.storage && navigator.storage.persist ? await navigator.storage.persist().catch(() => false) : false;
          toast(ok ? '有効にしました' : 'このブラウザでは許可されませんでした。書き出しで備えてください');
          render(true);
          break;
        }
      }
    } catch (err) {
      console.error(err);
      toast('エラー: ' + err.message);
    }
  });

  async function updateItemSilently(id, fn) {
    const it = findItem(id);
    if (!it) return;
    const next = Object.assign({}, it);
    fn(next);
    await putMany('items', [next]);
    state.items = state.items.map(i => (i.id === id ? next : i));
  }

  document.getElementById('lightbox').addEventListener('click', e => e.currentTarget.close());

  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (a.dataset.tab === 'home' && (location.hash || '#/') === '#/') {
      const q = document.getElementById('q');
      if (q) q.focus();
      return;
    }
    navigate(href);
  });

  backBtn.addEventListener('click', goBack);
  bannerEl.addEventListener('click', e => {
    if (e.target.closest('[data-act="sw-update"]') && state.swWaiting) {
      state.swUpdating = true;
      state.swWaiting.postMessage({ type: 'SKIP_WAITING' });
    }
  });
  window.addEventListener('popstate', () => render());
  window.addEventListener('hashchange', () => render());

  // ---------------------------------------------------------------------------
  // オフライン対応（Service Worker）
  // ---------------------------------------------------------------------------
  function registerSw() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js').then(reg => {
      const check = () => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          state.swWaiting = reg.waiting;
          bannerEl.innerHTML = '<div class="card info row"><span class="grow small">新しい版があります</span><button type="button" class="btn small primary" data-act="sw-update">更新</button></div>';
          bannerEl.hidden = false;
        }
      };
      check();
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') check(); });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (state.swUpdating) { state.swUpdating = false; location.reload(); }
    });
  }

  // ---------------------------------------------------------------------------
  // 起動
  // ---------------------------------------------------------------------------
  async function start() {
    try {
      if (!window.indexedDB) throw new Error('このブラウザは保存（IndexedDB）に対応していません');
      db = await openDb();
      await loadAll();
    } catch (err) {
      console.error(err);
      setView('おきばメモ', '<div class="card warn"><h2>データを保存できません</h2><p class="small">' + esc(err.message) +
        '</p><p class="small">プライベートブラウズでは保存できないことがあります。通常のタブ、またはホーム画面に追加したアプリから開いてください。</p></div>', { back: false });
      return;
    }
    if (!history.state || typeof history.state.depth !== 'number') history.replaceState({ depth: 0 }, '', location.hash || '#/');
    render(true);
    registerSw();
  }

  start();
})();
