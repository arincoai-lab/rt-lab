/**
 * おきばメモ — 画面に依存しない中核ロジック（検索・場所ツリー・バックアップ検証）。
 *
 * ブラウザでは window.OkibaCore、Node では require() で読み込む（scripts/test-okiba.js がテストする）。
 * DOM・IndexedDB には触らない。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OkibaCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const APP_ID = 'okiba';
  const BACKUP_VERSION = 1;
  const HISTORY_CAP = 30;
  const MISSES_CAP = 20;
  const DAY = 24 * 60 * 60 * 1000;
  const LIMITS = { name: 100, aliases: 300, detail: 1000, lentTo: 100, note: 1000, query: 100 };

  // ---- 文字の正規化 ----

  /** 全角/半角・大文字/小文字・カタカナ/ひらがなの違いを吸収する（NFKC → 小文字 → カタカナをひらがなに） */
  function normalize(s) {
    if (s == null) return '';
    return String(s)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(q) {
    return normalize(q).split(/[ 、,，・]+/).filter(Boolean);
  }

  // ---- よく探すものの読み（漢字 ⇔ かな）----
  // 漢字の読みは辞書が無いと引けないため、「かぎ」で「鍵」が見つからない問題をよく探すものに限って補う。
  // ここに無いものは、登録時の「別名・よみ」で補う。
  const SYNONYM_GROUPS_RAW = [
    ['鍵', 'かぎ', 'キー'], ['合鍵', 'あいかぎ', 'スペアキー'], ['眼鏡', 'めがね'], ['財布', 'さいふ'],
    ['印鑑', 'いんかん', 'はんこ', '判子'], ['印鑑登録証', 'いんかんとうろくしょう'],
    ['保険証', 'ほけんしょう'], ['診察券', 'しんさつけん'], ['お薬手帳', 'おくすりてちょう', '薬手帳'],
    ['通帳', 'つうちょう'], ['免許証', 'めんきょしょう', '運転免許証'],
    ['マイナンバーカード', 'マイナカード'], ['パスポート', '旅券'], ['年金手帳', 'ねんきんてちょう'],
    ['母子手帳', 'ぼしてちょう'], ['定期券', 'ていきけん'], ['社員証', 'しゃいんしょう', 'IDカード'],
    ['充電器', 'じゅうでんき'], ['延長コード', 'えんちょうこーど', '電源タップ'], ['電池', 'でんち', '乾電池'],
    ['懐中電灯', 'かいちゅうでんとう'], ['リモコン'], ['イヤホン', 'イヤフォン'], ['USBメモリ', 'USBメモリー'],
    ['爪切り', 'つめきり'], ['毛抜き', 'けぬき'], ['体温計', 'たいおんけい'], ['救急箱', 'きゅうきゅうばこ'],
    ['薬', 'くすり'], ['絆創膏', 'ばんそうこう'], ['傘', 'かさ'], ['手袋', 'てぶくろ'], ['帽子', 'ぼうし'],
    ['腕時計', 'うでどけい'], ['時計', 'とけい'], ['指輪', 'ゆびわ'], ['水筒', 'すいとう'],
    ['弁当箱', 'べんとうばこ'], ['靴べら', 'くつべら'],
    ['説明書', 'せつめいしょ', '取扱説明書', '取説', 'とりせつ'], ['保証書', 'ほしょうしょ'],
    ['領収書', 'りょうしゅうしょ', 'レシート'], ['契約書', 'けいやくしょ'], ['書類', 'しょるい'],
    ['切手', 'きって'], ['封筒', 'ふうとう'], ['名刺', 'めいし'], ['手帳', 'てちょう'],
    ['鋏', 'はさみ'], ['ホチキス', 'ホッチキス', 'ステープラー'], ['セロテープ', 'セロハンテープ'],
    ['定規', 'じょうぎ', 'ものさし'], ['消しゴム', 'けしごむ'], ['鉛筆', 'えんぴつ'], ['電卓', 'でんたく'],
    ['工具', 'こうぐ'], ['ドライバー', 'ねじ回し'],
  ];
  const SYNONYM_GROUPS = SYNONYM_GROUPS_RAW.map(g => [...new Set(g.map(normalize))]);

  /** 検索語1つを、読みの別表記を含む候補の配列にする（先頭は元の語） */
  function expandToken(t) {
    const out = [t];
    for (const g of SYNONYM_GROUPS) {
      const hit = g.some(m => m === t || (t.length >= 2 && m.startsWith(t)));
      if (hit) for (const m of g) if (!out.includes(m)) out.push(m);
    }
    return out;
  }

  // ---- 場所ツリー ----

  function indexById(list) {
    const m = new Map();
    for (const x of list || []) m.set(x.id, x);
    return m;
  }

  /** ルートから id までの場所の配列（親子が循環していても止まる） */
  function placePath(byId, id) {
    const path = [];
    const seen = new Set();
    let cur = id != null ? byId.get(id) : null;
    while (cur && !seen.has(cur.id) && path.length < 50) {
      seen.add(cur.id);
      path.unshift(cur);
      cur = cur.parentId != null ? byId.get(cur.parentId) : null;
    }
    return path;
  }

  function placePathText(byId, id, sep) {
    return placePath(byId, id).map(p => p.name).join(sep || ' › ');
  }

  /** rootId とその子孫すべての id（rootId を含む） */
  function descendantIds(places, rootId) {
    const children = new Map();
    for (const p of places) {
      if (p.parentId == null) continue;
      if (!children.has(p.parentId)) children.set(p.parentId, []);
      children.get(p.parentId).push(p.id);
    }
    const out = new Set([rootId]);
    const stack = [rootId];
    while (stack.length) {
      for (const c of children.get(stack.pop()) || []) {
        if (!out.has(c)) { out.add(c); stack.push(c); }
      }
    }
    return out;
  }

  /** placeId の親を newParentId に変えると循環するか */
  function wouldCreateCycle(byId, placeId, newParentId) {
    const seen = new Set();
    let cur = newParentId;
    while (cur != null && !seen.has(cur)) {
      if (cur === placeId) return true;
      seen.add(cur);
      const p = byId.get(cur);
      cur = p ? p.parentId : null;
    }
    return false;
  }

  function childrenOf(places, parentId) {
    return places
      .filter(p => (p.parentId == null ? null : p.parentId) === (parentId == null ? null : parentId))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  /** 最近使った場所（ものを置いた・作った順）。存在しない場所は除く */
  function recentPlaceIds(items, places, limit) {
    const byId = indexById(places);
    const ev = [];
    for (const it of items) {
      for (const h of it.history || []) if (h.placeId) ev.push([h.at || 0, h.placeId]);
      if (it.placeId) ev.push([it.updatedAt || 0, it.placeId]);
    }
    for (const p of places) ev.push([p.createdAt || 0, p.id]);
    ev.sort((a, b) => b[0] - a[0]);
    const out = [];
    for (const [, id] of ev) {
      if (byId.has(id) && !out.includes(id)) out.push(id);
      if (out.length >= (limit || 8)) break;
    }
    return out;
  }

  // ---- 検索 ----

  function fieldScore(hay, t, exact, prefix, part) {
    if (!hay) return 0;
    if (hay === t) return exact;
    if (hay.startsWith(t)) return prefix;
    if (hay.includes(t)) return part;
    return 0;
  }

  function itemFields(item, byId) {
    return {
      name: normalize(item.name),
      aliases: normalize(item.aliases).split(/[ 、,，・]+/).filter(Boolean),
      detail: normalize(item.detail),
      lentTo: item.status === 'lent' ? normalize(item.lentTo) : '',
      place: normalize(placePathText(byId, item.placeId, ' ')),
      home: normalize(placePathText(byId, item.homePlaceId, ' ')),
    };
  }

  function tokenScoreForItem(f, t) {
    let s = fieldScore(f.name, t, 100, 80, 60);
    for (const a of f.aliases) s = Math.max(s, fieldScore(a, t, 70, 55, 45));
    if (f.detail.includes(t)) s = Math.max(s, 30);
    if (f.lentTo.includes(t)) s = Math.max(s, 30);
    if (f.place.includes(t)) s = Math.max(s, 25);
    if (f.home.includes(t)) s = Math.max(s, 10);
    return s;
  }

  /** 全語にマッチしたものだけを、スコアの高い順に返す */
  function searchItems(items, places, query) {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const byId = indexById(places);
    const res = [];
    for (const item of items) {
      const f = itemFields(item, byId);
      let total = 0;
      let all = true;
      for (const t of tokens) {
        let best = 0;
        expandToken(t).forEach((alt, i) => {
          const s = tokenScoreForItem(f, alt) * (i === 0 ? 1 : 0.9);
          if (s > best) best = s;
        });
        if (!best) { all = false; break; }
        total += best;
      }
      if (all) res.push({ item, score: total + Math.min(item.searchCount || 0, 10) * 0.5 });
    }
    return res.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));
  }

  function searchPlaces(places, query) {
    const tokens = tokenize(query);
    if (!tokens.length) return [];
    const byId = indexById(places);
    const res = [];
    for (const p of places) {
      const name = normalize(p.name);
      const path = normalize(placePathText(byId, p.id, ' '));
      let total = 0;
      let all = true;
      for (const t of tokens) {
        let best = 0;
        expandToken(t).forEach((alt, i) => {
          let s = fieldScore(name, alt, 100, 80, 60);
          if (!s && path.includes(alt)) s = 25;
          s *= i === 0 ? 1 : 0.9;
          if (s > best) best = s;
        });
        if (!best) { all = false; break; }
        total += best;
      }
      if (all) res.push({ place: p, score: total });
    }
    return res.sort((a, b) => b.score - a.score);
  }

  // ---- 状態 ----

  function isMisplaced(item) {
    return item.status !== 'lent' && !!item.homePlaceId && item.placeId !== item.homePlaceId;
  }

  function frequentlySearched(items, n) {
    return items
      .filter(it => (it.searchCount || 0) >= 2)
      .sort((a, b) => b.searchCount - a.searchCount)
      .slice(0, n || 5);
  }

  /** 新しい履歴を先頭に足し、HISTORY_CAP 件で切る */
  function pushHistory(history, entry) {
    return [entry].concat(history || []).slice(0, HISTORY_CAP);
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function relativeTime(ts, now) {
    if (!ts) return '—';
    const d = Math.round((startOfDay(now) - startOfDay(ts)) / DAY);
    if (d <= 0) return '今日';
    if (d === 1) return '昨日';
    if (d < 7) return d + '日前';
    if (d < 30) return Math.floor(d / 7) + '週間前';
    if (d < 365) return Math.floor(d / 30) + 'か月前';
    return '1年以上前';
  }

  /**
   * バックアップを促すか。書き出してから変更があることが前提で、
   *  - 一度も書き出していない: 変更10件以上、または最初の登録から3日以上（使い始めの数件ではまだ促さない）
   *  - 書き出したことがある: 前回から14日以上、または変更30件以上
   */
  function backupReminder(meta, itemCount, now, oldestCreatedAt) {
    const changes = (meta && meta.changesSinceBackup) || 0;
    const last = meta && meta.lastBackupAt;
    if (!itemCount || !changes) return { show: false };
    if (last == null) {
      const age = oldestCreatedAt ? now - oldestCreatedAt : 0;
      return { show: changes >= 10 || age >= 3 * DAY, days: null, changes };
    }
    const days = Math.floor((now - last) / DAY);
    return { show: days >= 14 || changes >= 30, days, changes };
  }

  /** 「探したけど見つからなかった語」を記録（同じ語は回数を足して先頭へ） */
  function addMiss(misses, q, now) {
    const key = normalize(q);
    if (!key) return misses || [];
    const prev = (misses || []).find(m => normalize(m.q) === key);
    const rest = (misses || []).filter(m => normalize(m.q) !== key);
    const entry = { q: String(q).trim().slice(0, LIMITS.query), at: now, count: (prev ? prev.count : 0) + 1 };
    return [entry].concat(rest).slice(0, MISSES_CAP);
  }

  function removeMiss(misses, q) {
    const key = normalize(q);
    return (misses || []).filter(m => normalize(m.q) !== key);
  }

  // ---- バックアップ（書き出し・読み込みの検証） ----

  function str(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }
  function num(v, dflt) {
    return typeof v === 'number' && isFinite(v) && v >= 0 ? v : dflt;
  }
  // id は URL（#/item/<id>）にそのまま入るため、英数字・ハイフン・下線に限る（UUID と makeId の代替形式が通る）
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function idOrNull(v) {
    return typeof v === 'string' && ID_RE.test(v) ? v : null;
  }
  const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
  const HISTORY_KINDS = new Set(['created', 'moved', 'found', 'returned', 'lent', 'home']);

  function sanitizePlace(p, now) {
    if (!p || typeof p !== 'object') return null;
    const id = idOrNull(p.id);
    const name = str(p.name, LIMITS.name);
    if (!id || !name) return null;
    return {
      id, name,
      parentId: idOrNull(p.parentId),
      note: str(p.note, LIMITS.note),
      photoId: idOrNull(p.photoId),
      createdAt: num(p.createdAt, now),
      updatedAt: num(p.updatedAt, now),
    };
  }

  function sanitizeItem(it, now) {
    if (!it || typeof it !== 'object') return null;
    const id = idOrNull(it.id);
    const name = str(it.name, LIMITS.name);
    if (!id || !name) return null;
    const status = it.status === 'lent' ? 'lent' : 'placed';
    const history = (Array.isArray(it.history) ? it.history : [])
      .filter(h => h && typeof h === 'object' && HISTORY_KINDS.has(h.kind))
      .slice(0, HISTORY_CAP)
      .map(h => ({
        at: num(h.at, 0), kind: h.kind, placeId: idOrNull(h.placeId),
        detail: str(h.detail, LIMITS.detail), lentTo: str(h.lentTo, LIMITS.lentTo),
      }));
    return {
      id, name,
      aliases: str(it.aliases, LIMITS.aliases),
      placeId: idOrNull(it.placeId),
      detail: str(it.detail, LIMITS.detail),
      homePlaceId: idOrNull(it.homePlaceId),
      homeDetail: str(it.homeDetail, LIMITS.detail),
      photoId: idOrNull(it.photoId),
      status,
      lentTo: status === 'lent' ? str(it.lentTo, LIMITS.lentTo) : '',
      lentAt: status === 'lent' ? num(it.lentAt, now) : null,
      lastSeenAt: num(it.lastSeenAt, null),
      searchCount: Math.floor(num(it.searchCount, 0)),
      foundCount: Math.floor(num(it.foundCount, 0)),
      history,
      createdAt: num(it.createdAt, now),
      updatedAt: num(it.updatedAt, now),
    };
  }

  function sanitizePhoto(ph) {
    if (!ph || typeof ph !== 'object') return null;
    const id = idOrNull(ph.id);
    const type = typeof ph.type === 'string' && /^image\/(jpeg|png|webp)$/.test(ph.type) ? ph.type : null;
    if (!id || !type || typeof ph.full !== 'string' || !ph.full || !B64.test(ph.full)) return null;
    const thumb = typeof ph.thumb === 'string' && B64.test(ph.thumb) && ph.thumb ? ph.thumb : null;
    return { id, type, full: ph.full, thumb, w: num(ph.w, 0), h: num(ph.h, 0), createdAt: num(ph.createdAt, 0) };
  }

  /** 重複id・存在しない参照・親子の循環を直す（in place ではなく新しい配列を返す） */
  function repair(data) {
    const warnings = [];
    const dedupe = (list, label) => {
      const seen = new Set();
      return list.filter(x => {
        if (seen.has(x.id)) { warnings.push(label + 'のidが重複していたため後の方を除外: ' + x.id); return false; }
        seen.add(x.id);
        return true;
      });
    };
    const photos = dedupe(data.photos, '写真');
    const photoIds = new Set(photos.map(p => p.id));
    const places = dedupe(data.places, '場所').map(p => Object.assign({}, p));
    const byId = indexById(places);
    for (const p of places) {
      if (p.parentId != null && !byId.has(p.parentId)) { warnings.push('親の場所が無いため最上位に移動: ' + p.name); p.parentId = null; }
      if (p.photoId != null && !photoIds.has(p.photoId)) p.photoId = null;
    }
    for (const p of places) {
      if (p.parentId != null && wouldCreateCycle(byId, p.id, p.parentId)) {
        warnings.push('場所の親子が循環していたため最上位に移動: ' + p.name);
        p.parentId = null;
      }
    }
    const items = dedupe(data.items, 'もの').map(it => {
      const x = Object.assign({}, it);
      if (x.placeId != null && !byId.has(x.placeId)) { warnings.push('場所が見つからないため「場所未設定」に: ' + x.name); x.placeId = null; }
      if (x.homePlaceId != null && !byId.has(x.homePlaceId)) { x.homePlaceId = null; x.homeDetail = ''; }
      if (x.photoId != null && !photoIds.has(x.photoId)) x.photoId = null;
      x.history = (x.history || []).map(h => (h.placeId != null && !byId.has(h.placeId) ? Object.assign({}, h, { placeId: null }) : h));
      return x;
    });
    return { places, items, photos, misses: data.misses || [], warnings };
  }

  /**
   * 読み込んだJSONを検証して、取り込める形に整える。
   * 致命的な誤り（別アプリのファイル・新しすぎる版）は fatal に入れて data を返さない。
   */
  function validateBackup(obj, now) {
    now = now || Date.now();
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { fatal: 'JSONの形式ではありません' };
    if (obj.app !== APP_ID) return { fatal: 'おきばメモのバックアップファイルではありません' };
    if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
      return { fatal: 'このファイルは新しい版のアプリで作られています（版 ' + obj.version + '）。アプリを更新してから読み込んでください' };
    }
    const warnings = [];
    const take = (arr, fn, label) => {
      const src = Array.isArray(arr) ? arr : [];
      const out = [];
      for (const x of src) {
        const y = fn(x, now);
        if (y) out.push(y); else warnings.push(label + 'の不正なデータを1件除外');
      }
      return out;
    };
    const places = take(obj.places, sanitizePlace, '場所');
    const items = take(obj.items, sanitizeItem, 'もの');
    const photos = take(obj.photos, sanitizePhoto, '写真');
    const misses = (Array.isArray(obj.misses) ? obj.misses : [])
      .filter(m => m && typeof m.q === 'string' && m.q.trim())
      .slice(0, MISSES_CAP)
      .map(m => ({ q: str(m.q, LIMITS.query), at: num(m.at, 0), count: Math.floor(num(m.count, 1)) || 1 }));
    const r = repair({ places, items, photos, misses });
    return { data: { places: r.places, items: r.items, photos: r.photos, misses: r.misses }, warnings: warnings.concat(r.warnings) };
  }

  /** 端末のデータに読み込んだデータを統合する。同じidは updatedAt が新しい方を残す */
  function mergeData(cur, inc) {
    const mergeList = (a, b) => {
      const m = new Map();
      for (const x of a) m.set(x.id, x);
      for (const x of b) {
        const y = m.get(x.id);
        if (!y || (x.updatedAt || 0) > (y.updatedAt || 0)) m.set(x.id, x);
      }
      return [...m.values()];
    };
    const photos = new Map();
    for (const p of cur.photos.concat(inc.photos)) if (!photos.has(p.id)) photos.set(p.id, p);
    let misses = (cur.misses || []).slice();
    for (const m of (inc.misses || []).slice().reverse()) {
      if (!misses.some(x => normalize(x.q) === normalize(m.q))) misses = [m].concat(misses);
    }
    return repair({
      places: mergeList(cur.places, inc.places),
      items: mergeList(cur.items, inc.items),
      photos: [...photos.values()],
      misses: misses.slice(0, MISSES_CAP),
    });
  }

  function buildBackup(data, now) {
    return {
      app: APP_ID,
      version: BACKUP_VERSION,
      exportedAt: new Date(now).toISOString(),
      places: data.places,
      items: data.items,
      photos: data.photos,
      misses: data.misses || [],
    };
  }

  // ---- Base64（写真をJSONに入れるため） ----

  function bytesToBase64(bytes) {
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function makeId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  return {
    APP_ID, BACKUP_VERSION, HISTORY_CAP, MISSES_CAP, LIMITS, DAY,
    normalize, tokenize, expandToken, SYNONYM_GROUPS,
    indexById, placePath, placePathText, descendantIds, wouldCreateCycle, childrenOf, recentPlaceIds,
    searchItems, searchPlaces,
    isMisplaced, frequentlySearched, pushHistory, relativeTime, backupReminder, addMiss, removeMiss,
    sanitizeItem, sanitizePlace, validateBackup, mergeData, buildBackup, repair,
    bytesToBase64, base64ToBytes, makeId,
  };
});
