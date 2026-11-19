/**
 * 放射線科の多忙な一日 〜放射線科運営シミュレータ〜 の計算の中身。画面は持たない純粋な関数だけ。
 * ブラウザでは window.RadCore、Node では require() で使う。
 *
 * 時間の単位はゲーム内の「分」。8:30 が 0、12:00 が 210。
 * 検査時間・待てる限界・救急の来方は、ゲーム用の目安（実在の診療の目安ではない）。
 * 偶然の要素（子どもの撮り直し、トイレのタイミング）は、患者さんが来たときに乱数の種から決める。
 * 同じ種なら毎回同じ展開になり、上達が点に出る。
 * テストは scripts/test-rad-dept-sim.js。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RadCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROOMS = [
    { id: 'xr1', name: '一般撮影 1', type: 'XR' },
    { id: 'xr2', name: '一般撮影 2', type: 'XR' },
    { id: 'ct',  name: 'CT',         type: 'CT' },
    { id: 'mri', name: 'MRI',        type: 'MRI' },
  ];
  const TYPE_NAME = { XR: '一般撮影', CT: 'CT', MRI: 'MRI' };
  // 検査名: [部屋の種類, 分]
  const EX = {
    '胸部': ['XR', 5], '腹部': ['XR', 5], '手': ['XR', 6], '膝': ['XR', 8], '腰椎': ['XR', 12],
    '頭部CT': ['CT', 8], '胸部CT': ['CT', 8], '腹部CT': ['CT', 10], '造影CT': ['CT', 15], '全身CT': ['CT', 15],
    '頭部MRI': ['MRI', 25], '膝MRI': ['MRI', 30], '腰椎MRI': ['MRI', 35], '肩MRI': ['MRI', 30], '短いMRI': ['MRI', 20],
  };
  // 待てる限界 [😐 になる分, 😠 になる分]。至急（red）は [待たせたと数え始める分, 危険の分]
  const MOOD = { green: [20, 40], yellow: [15, 30], red: [3, 5] };
  const CALL_AHEAD = 10;   // 救急は着く 10 分前に電話
  const CLOSE = 210;       // 12:00
  const SEED = 20261124;  // 子どもの撮り直しが起きる種（見せ場を残す）

  // 患者さんのキャラ。どれも「読めば対策が取れる」弱点と、カードの目印を持つ
  const CHARS = {
    impatient: { icon: '💢', name: 'せっかちな佐藤さん', hint: '怒るのが早い。怒ると待合の外来の人も不機嫌に', thanks: '…まあ、思ったより早かったな。ありがとう' },
    chatty:    { icon: '💬', name: 'おしゃべり好きの梅さん', hint: '世間話で検査が 1.5 倍かかる', thanks: '楽しかったわ、ありがとね' },
    child:     { icon: '🧸', name: 'じっとできない、はるとくん', hint: '付き添いがいないと撮り直しになることも', thanks: 'バイバーイ！' },
    toilet:    { icon: '🚻', name: 'トイレが近い源さん', hint: '予約して待たせると、トイレに行ってしまう', thanks: 'すまんかったね、ありがとう' },
    claustro:  { icon: '😰', name: '狭いところが苦手な田中さん', hint: 'MRI の途中で一度休憩が入る（+8 分）', thanks: '声をかけてもらえて助かりました' },
  };
  const CHATTY_RATE = 1.5;
  const CHILD_RETAKE_P = 1 / 3;
  const CLAUSTRO_EXTRA = 8;
  const TOILET_AWAY = 4;

  // 区分: 外来 / 入院 / 救急。緊急度: red=至急 / yellow=早めに / green=通常
  const S = (t, src, sev, exams, extra) => Object.assign({ t, src, sev, exams }, extra || {});
  const SCHEDULE = [
    // 8:30 開始と同時に外来がどっと来る（MRI の予約が重なっている）
    S(0, '外来', 'green', ['胸部']), S(0, '外来', 'green', ['腰椎']), S(0, '外来', 'green', ['腰椎MRI']),
    S(0, '外来', 'yellow', ['造影CT']), S(0, '外来', 'green', ['胸部', '胸部CT']), S(0, '外来', 'green', ['膝MRI']),
    S(1, '外来', 'green', ['胸部', '腹部']), S(2, '外来', 'green', ['短いMRI']),
    S(3, '外来', 'green', ['胸部'], { char: 'chatty' }),
    S(5, '外来', 'green', ['頭部MRI']), S(8, '外来', 'green', ['膝', '膝MRI']), S(12, '入院', 'yellow', ['腹部CT']),
    S(15, '外来', 'green', ['手']), S(16, '外来', 'green', ['胸部', '胸部CT']),
    S(20, '外来', 'green', ['腰椎'], { char: 'impatient' }),
    S(25, '入院', 'yellow', ['胸部', '腹部CT']),
    S(40, '外来', 'green', ['胸部'], { char: 'child', escort: false }),
    // 救急の直前に長い CT が来る（入れるか、空けておくか）
    S(57, '外来', 'yellow', ['造影CT']), S(65, '救急', 'red', ['頭部CT']),
    S(68, '外来', 'green', ['胸部'], { char: 'toilet' }),
    S(70, '外来', 'green', ['膝']), S(80, '入院', 'yellow', ['腹部CT']), S(88, '救急', 'red', ['全身CT', '胸部']),
    S(90, '外来', 'green', ['胸部', '腰椎']), S(95, '外来', 'yellow', ['造影CT']),
    S(100, '外来', 'green', ['短いMRI'], { char: 'claustro' }),
    S(110, '入院', 'yellow', ['腹部CT']), S(120, '外来', 'green', ['胸部']), S(121, '外来', 'green', ['腹部']),
    S(135, '救急', 'red', ['頭部CT', '胸部']), S(140, '外来', 'green', ['肩MRI']), S(150, '外来', 'green', ['腹部']),
  ];

  // 再現できる乱数（mulberry32）
  function rng32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newGame(seed) {
    const G = {
      t: 0, seed: seed === undefined ? SEED : seed, patients: [], done: [], nextIdx: 0, pid: 0, ended: false, log: [],
      rooms: ROOMS.map(r => ({ id: r.id, name: r.name, type: r.type, p: null, next: null, left: 0, total: 0, marks: [] })),
    };
    G.rand = rng32(G.seed);
    return G;
  }

  const curEx = p => p.exams[p.step];
  const waitNow = (G, p) => G.t - p.waitSince;
  const room = (G, id) => G.rooms.find(r => r.id === id);
  const findP = (G, id) => G.patients.find(p => p.id === id);
  function fmt(m) { const h = 8 + Math.floor((m + 30) / 60), mm = Math.floor((m + 30) % 60); return `${h}:${String(mm).padStart(2, '0')}`; }
  function log(G, s) { G.log.unshift(`${fmt(G.t)} ${s}`); if (G.log.length > 60) G.log.pop(); }

  function limits(p) {
    const l = MOOD[p.sev];
    return p.char === 'impatient' ? [l[0] / 2, l[1] / 2] : l;
  }
  function moodLevel(G, p) {
    const w = waitNow(G, p) + p.moodExtra, l = limits(p);
    return w >= l[1] ? 2 : w >= l[0] ? 1 : 0;
  }

  function arrive(G, row) {
    const p = {
      id: ++G.pid, src: row.src, sev: row.sev, exams: row.exams.slice(), step: 0, char: row.char || null, escort: !!row.escort,
      waitSince: G.t, waited: 0, redWait: 0, angry: false, moodExtra: 0, reservedFor: null, reservedAt: 0,
      retake: false, toiletDelay: 0, toiletUsed: false, awayUntil: 0, thanks: null,
    };
    // 偶然の要素は来た瞬間に決める（来る順番は固定なので、同じ種なら同じ結果）
    if (p.char === 'child') p.retake = !p.escort && G.rand() < CHILD_RETAKE_P;
    if (p.char === 'toilet') p.toiletDelay = 1 + G.rand() * 3;
    G.patients.push(p);
    log(G, `${row.src}の患者さん（${row.exams.join('→')}）が来ました`);
    return p;
  }

  // その人の、いまの検査にかかる分（キャラの効果込み）。撮り直し・休憩の時刻も返す
  function examPlan(p) {
    const base = EX[curEx(p)][1];
    let mins = base;
    const marks = [];
    if (p.char === 'chatty') mins = Math.ceil(base * CHATTY_RATE);
    if (p.char === 'child' && p.retake && EX[curEx(p)][0] === 'XR') {
      marks.push({ at: base, type: 'retake', text: '動いちゃった！ 撮り直し' });
      mins += Math.ceil(base / 2);
    }
    if (p.char === 'claustro' && EX[curEx(p)][0] === 'MRI') {
      marks.push({ at: Math.round(base * 0.4), type: 'pause', text: 'ちょっと休憩…声かけ中' });
      mins += CLAUSTRO_EXTRA;
    }
    return { mins, marks };
  }

  function start(G, p, r, fromReserve) {
    for (const x of G.rooms) if (x.next === p) x.next = null;
    p.reservedFor = null;
    p.waited += waitNow(G, p);
    G.patients = G.patients.filter(x => x !== p);
    const plan = examPlan(p);
    r.p = p; r.left = plan.mins; r.total = plan.mins;
    r.marks = plan.marks.map(m => Object.assign({ fired: false }, m));
    log(G, `${r.name}：${curEx(p)} 開始（${Math.round(waitNow(G, p))}分待ち${fromReserve ? '・予約から' : ''}）`);
  }

  function canTake(G, roomId, pid) {
    const r = room(G, roomId), p = findP(G, pid);
    if (!r || !p || r.type !== EX[curEx(p)][0] || r.next === p) return false;
    if (isAway(G, p)) return false; // トイレ中の人は、どの部屋にも入れない
    return !r.p || !r.next;
  }

  // 空いていれば開始、検査中で「次」が空いていれば予約（1部屋1人まで）
  function assign(G, pid, roomId) {
    if (G.ended || !canTake(G, roomId, pid)) return null;
    const r = room(G, roomId), p = findP(G, pid);
    if (!r.p) { start(G, p, r, false); return 'started'; }
    for (const x of G.rooms) if (x.next === p) x.next = null;
    r.next = p; p.reservedFor = r.id; p.reservedAt = G.t;
    log(G, `${r.name}：次に ${curEx(p)} を予約`);
    return 'reserved';
  }

  function unreserve(G, pid) {
    const p = findP(G, pid);
    if (!p || !p.reservedFor) return false;
    const r = room(G, p.reservedFor);
    if (r && r.next === p) r.next = null;
    p.reservedFor = null;
    log(G, `${r ? r.name : ''}：予約を取り消し（${curEx(p)}）`);
    return true;
  }

  function isAway(G, p) { return p.awayUntil > G.t; }

  function step(G, dt) {
    const ev = [];
    if (G.ended || !(dt > 0)) return ev;
    G.t += dt;
    while (G.nextIdx < SCHEDULE.length && SCHEDULE[G.nextIdx].t <= G.t) {
      const p = arrive(G, SCHEDULE[G.nextIdx++]);
      ev.push({ type: 'arrive', pid: p.id });
    }
    // トイレ: 予約されて待っていると、一度だけいなくなる
    for (const p of G.patients) {
      if (p.char === 'toilet' && p.reservedFor && !p.toiletUsed && G.t >= p.reservedAt + p.toiletDelay) {
        p.toiletUsed = true; p.awayUntil = G.t + TOILET_AWAY;
        log(G, `${CHARS.toilet.name}がトイレに行きました`);
        ev.push({ type: 'toilet', pid: p.id, roomId: p.reservedFor });
      }
    }
    for (const r of G.rooms) {
      if (!r.p) continue;
      r.left -= dt;
      const elapsed = r.total - r.left;
      for (const m of r.marks) if (!m.fired && elapsed >= m.at) { m.fired = true; ev.push({ type: m.type, roomId: r.id, text: m.text }); }
      if (r.left <= 1e-9) {
        const p = r.p; r.p = null; r.marks = [];
        log(G, `${r.name}：${curEx(p)} 終了`);
        p.step++;
        if (p.step < p.exams.length) {
          p.waitSince = G.t; p.moodExtra = 0; G.patients.push(p);
          ev.push({ type: 'finish', roomId: r.id, pid: p.id, nextExam: curEx(p) });
        } else {
          p.thanks = p.char ? CHARS[p.char].thanks : null;
          G.done.push(p);
          ev.push({ type: 'finish', roomId: r.id, pid: p.id, thanks: p.thanks });
        }
      }
    }
    // 空いた部屋に、予約の人を入れる（トイレ中なら戻るまで待つ）
    for (const r of G.rooms) {
      if (!r.p && r.next && !isAway(G, r.next)) { start(G, r.next, r, true); ev.push({ type: 'start', roomId: r.id }); }
    }
    for (const p of G.patients) {
      if (p.sev === 'red' && waitNow(G, p) > MOOD.red[0]) p.redWait += dt;
      if (!p.angry && moodLevel(G, p) === 2) {
        p.angry = true;
        ev.push({ type: 'angry', pid: p.id });
        if (p.char === 'impatient') {
          // 不満がうつる: 待合の外来の人の機嫌が 1 段下がる
          for (const q of G.patients) if (q !== p && q.src === '外来' && !q.angry) q.moodExtra += MOOD[q.sev][0];
          log(G, `${CHARS.impatient.name}が受付で声を荒げています`);
          ev.push({ type: 'spread', pid: p.id });
        }
      }
    }
    if (G.nextIdx >= SCHEDULE.length && G.patients.length === 0 && G.rooms.every(r => !r.p && !r.next)) {
      G.ended = true;
      ev.push({ type: 'end' });
    }
    return ev;
  }

  const SEV_ORDER = { red: 0, yellow: 1, green: 2 };
  function waiting(G) {
    return G.patients.filter(p => !p.reservedFor).sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev] || a.waitSince - b.waitSince);
  }
  function incomingCall(G) {
    for (let i = G.nextIdx; i < SCHEDULE.length; i++) {
      const r = SCHEDULE[i];
      if (r.src === '救急' && r.t - G.t <= CALL_AHEAD) return r;
    }
    return null;
  }
  // いまの平均待ち・至急の待ち（画面上部の数字）
  function liveStats(G) {
    const all = [...G.done, ...G.patients, ...G.rooms.filter(r => r.p).map(r => r.p)];
    const waits = all.map(p => p.waited + (G.patients.includes(p) ? waitNow(G, p) : 0));
    return {
      avg: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
      redWait: all.filter(p => p.sev === 'red').reduce((a, p) => a + p.redWait, 0),
    };
  }

  function result(G) {
    const all = G.done;
    const n = all.length || 1;
    const avg = all.reduce((a, p) => a + p.waited, 0) / n;
    const maxWait = all.length ? Math.max(...all.map(p => p.waited)) : 0;
    const redWait = all.filter(p => p.sev === 'red').reduce((a, p) => a + p.redWait, 0);
    const angry = all.filter(p => p.angry).length;
    const overtime = Math.max(0, G.t - CLOSE);
    const raw = 100 - avg * 1.2 - redWait * 5 - angry * 3 - overtime * 0.5;
    const score = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 0)));
    const grade = score >= 85 ? 'S' : score >= 70 ? 'A' : score >= 55 ? 'B' : score >= 40 ? 'C' : 'D';
    const advice = redWait > 3 ? '救急の患者さんを待たせすぎました。電話が来たら、CT を空けておくのがコツ。'
      : overtime > 0 ? '長い MRI を後回しにすると残業に。空いた時間に先に入れておこう。'
      : angry > 0 ? '待たせすぎた人がいます。短い検査を先にさばくと、平均の待ちが縮みます。'
      : '見事な采配！ 明日もこの調子で。';
    return { score, grade, avg, maxWait, redWait, angry, overtime, endTime: fmt(G.t), patients: all.length, advice,
      met: all.filter(p => p.char).map(p => ({ char: p.char, name: CHARS[p.char].name, icon: CHARS[p.char].icon, thanks: CHARS[p.char].thanks })) };
  }

  return {
    ROOMS, TYPE_NAME, EX, MOOD, CALL_AHEAD, CLOSE, SEED, CHARS, SCHEDULE,
    CHATTY_RATE, CHILD_RETAKE_P, CLAUSTRO_EXTRA, TOILET_AWAY,
    newGame, step, assign, unreserve, canTake, waiting, incomingCall, liveStats, result,
    curEx, waitNow, moodLevel, limits, fmt, examPlan, isAway, rng32,
  };
});
