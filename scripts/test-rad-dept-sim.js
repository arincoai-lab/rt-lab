#!/usr/bin/env node
/**
 * 放射線科の多忙な一日（rad-dept-sim/rad-core.js）の回帰テスト。
 *
 *   node scripts/test-rad-dept-sim.js
 *
 * 守りたいこと:
 *  1. 同じ種・同じ操作なら同じ点（再現性）
 *  2. 判断が点に効く: 来た順に入れるだけなら B 未満、救急に備える采配なら A 以上
 *  3. どの方針でも全員が検査を終え、点数が 0..100 の整数
 *  4. 予約: 1部屋1人まで、取り消せる、空いたら自動で始まる、トイレ中は始まらない
 *  5. キャラの効果が書いたとおりに働く（おしゃべり 1.5 倍、撮り直し、閉所 +8 分、せっかちの不満がうつる）
 *  6. 画面に「クレーマー」と書かない
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.dirname(__dirname);
let R;
try { R = require(path.join(ROOT, 'rad-dept-sim/rad-core.js')); }
catch (e) { console.error('rad-core.js を読み込めない: ' + e.message); process.exit(1); }

let pass = 0, fail = 0;
function check(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

const DT = 0.5;
const freeRoom = (G, p) => G.rooms.find(r => !r.p && R.canTake(G, r.id, p.id));

// 方針: 来た順に、空いている部屋へ入れるだけ
function fifo(G) {
  const ws = R.waiting(G).sort((a, b) => a.waitSince - b.waitSince);
  for (const p of ws) { const r = freeRoom(G, p); if (r) R.assign(G, p.id, r.id); }
}
// 方針: 至急→早めに→通常、同じなら短い検査から。救急の電話が来たら、着くまでに終わらない CT は入れない
function smart(G) {
  const O = { red: 0, yellow: 1, green: 2 };
  const call = R.incomingCall(G);
  const ws = R.waiting(G).sort((a, b) => O[a.sev] - O[b.sev] || R.EX[R.curEx(a)][1] - R.EX[R.curEx(b)][1]);
  for (const p of ws) {
    const [type] = R.EX[R.curEx(p)];
    if (type === 'CT' && call && p.sev !== 'red' && R.examPlan(p).mins > call.t - G.t) continue;
    const r = freeRoom(G, p); if (r) R.assign(G, p.id, r.id);
  }
}
function play(policy, seed) {
  const G = R.newGame(seed);
  for (let n = 0; n < 20000 && !G.ended; n++) { policy(G); R.step(G, DT); }
  return G;
}

// ---- 1. 再現性 ----
{
  const a = R.result(play(smart)), b = R.result(play(smart));
  check(a.score === b.score && a.avg === b.avg, `同じ種・同じ操作で点が変わる（${a.score} / ${b.score}）`);
}

// ---- 2. 判断が点に効く ----
{
  const f = R.result(play(fifo)), s = R.result(play(smart));
  console.log(`  来た順: ${f.grade} ${f.score}点（平均待ち ${f.avg.toFixed(1)}分・至急の待ち ${f.redWait.toFixed(1)}分・怒った ${f.angry}人・終了 ${f.endTime}）`);
  console.log(`  采配  : ${s.grade} ${s.score}点（平均待ち ${s.avg.toFixed(1)}分・至急の待ち ${s.redWait.toFixed(1)}分・怒った ${s.angry}人・終了 ${s.endTime}）`);
  check(f.score < 55, `来た順に入れるだけで B 以上になる（${f.score}点）。難しさを見直す`);
  check(s.score >= 70, `救急に備える采配でも A に届かない（${s.score}点）。難しさを見直す`);
  check(s.redWait === 0, `采配の方針で至急の人を待たせている（${s.redWait}分）`);
}

// ---- 3. 全員が終わる・点が整数 ----
{
  const policies = { fifo, smart, none: () => {} };
  for (const seed of [1, 2, 3, R.SEED]) {
    for (const [name, pol] of Object.entries(policies)) {
      if (name === 'none') continue;
      const G = play(pol, seed);
      const res = R.result(G);
      check(G.ended, `${name}/種${seed}: 終わらない`);
      check(res.patients === R.SCHEDULE.length, `${name}/種${seed}: 終えた人数 ${res.patients} ≠ ${R.SCHEDULE.length}`);
      check(Number.isInteger(res.score) && res.score >= 0 && res.score <= 100, `${name}/種${seed}: 点数が 0..100 の整数でない（${res.score}）`);
    }
  }
  // 何もしないと、待合に人が残ったまま終わらない（勝手に検査が進まない）
  const G = R.newGame();
  for (let i = 0; i < 1000; i++) R.step(G, DT);
  check(!G.ended && G.done.length === 0, '何も操作しないのに検査が進んだ');
  check(R.result(G).score >= 0, '未終了でも result が NaN にならない');
}

// ---- 4. 予約 ----
{
  const G = R.newGame();
  R.step(G, 0.1); // 8:30 の6人が来る
  const ws = R.waiting(G);
  const xr = ws.filter(p => R.EX[R.curEx(p)][0] === 'XR');
  check(R.assign(G, xr[0].id, 'xr1') === 'started', '空いた部屋に入らない');
  check(R.assign(G, xr[1].id, 'xr1') === 'reserved', '検査中の部屋に予約できない');
  check(R.canTake(G, 'xr1', xr[2] ? xr[2].id : -1) === false, '1部屋に2人目を予約できてしまう');
  const mri = ws.find(p => R.EX[R.curEx(p)][0] === 'MRI');
  check(R.assign(G, mri.id, 'xr1') === null, '種類の違う部屋に入れてしまう');
  check(!R.waiting(G).includes(xr[1]), '予約した人が待合に残っている');
  check(R.unreserve(G, xr[1].id) && R.waiting(G).includes(xr[1]) && G.rooms[0].next === null, '取り消しで待合に戻らない');
  R.assign(G, xr[1].id, 'xr1');
  for (let i = 0; i < 40 && G.rooms[0].p !== xr[1]; i++) R.step(G, DT);
  check(G.rooms[0].p === xr[1], '部屋が空いても予約の人が始まらない');
  check(xr[1].waited >= R.EX['胸部'][1] - 1, `予約中の待ち時間が数えられていない（${xr[1].waited}）`);

  // 2つ目の検査がある人が終わったとき、予約の人が入り、前の人は待合に戻る
  const H = R.newGame();
  R.step(H, 0.1);
  const two = R.waiting(H).find(p => p.exams.length === 2 && R.EX[p.exams[0]][0] === 'XR');
  const one = R.waiting(H).find(p => p.exams.length === 1 && R.EX[p.exams[0]][0] === 'XR');
  R.assign(H, two.id, 'xr1'); R.assign(H, one.id, 'xr1');
  for (let i = 0; i < 40 && H.rooms[0].p !== one; i++) R.step(H, DT);
  check(H.rooms[0].p === one && H.patients.includes(two) && two.step === 1, '2つ目の検査がある人と予約の人の入れ替わりがおかしい');
}

// ---- 5. キャラ ----
{
  const mk = (char, exam, extra) => ({ char, exams: [exam], step: 0, retake: false, escort: false, ...extra });
  check(R.examPlan(mk('chatty', '胸部')).mins === Math.ceil(5 * 1.5), 'おしゃべり: 1.5 倍になっていない');
  check(R.examPlan(mk('child', '胸部', { retake: true })).mins === 5 + 3, '子ども: 撮り直しで検査時間の半分が足されない');
  check(R.examPlan(mk('child', '胸部', { retake: false })).mins === 5, '子ども: 撮り直しなしで時間が変わる');
  check(R.examPlan(mk('claustro', '短いMRI')).mins === 20 + 8, '閉所: +8 分になっていない');
  check(R.examPlan(mk('claustro', '胸部')).mins === 5, '閉所: MRI 以外にも効いている');
  // 付き添いがいれば撮り直しは起きない、いなければ約 1/3
  let n = 0, hit = 0;
  for (let seed = 1; seed <= 3000; seed++) {
    const G = R.newGame(seed);
    while (G.nextIdx < R.SCHEDULE.length) R.step(G, 5);
    const c = [...G.patients].find(p => p.char === 'child');
    n++; if (c.retake) hit++;
  }
  check(hit / n > 0.29 && hit / n < 0.38, `子どもの撮り直しの率が 1/3 から外れる（${(hit / n).toFixed(3)}）`);
  {
    const G = R.newGame();
    while (G.nextIdx < R.SCHEDULE.length) R.step(G, 5);
    const c = G.patients.find(p => p.char === 'child');
    check(c.retake === true, '既定の種で、子どもの撮り直しが一度も見られない（見せ場がなくなる）');
  }
  // せっかち: 限界が半分。怒ると、待合の外来の人の機嫌が 1 段下がる
  {
    const G = R.newGame();
    let imp;
    while (!(imp = G.patients.find(p => p.char === 'impatient'))) R.step(G, DT);
    const others = G.patients.filter(p => p !== imp && p.src === '外来' && !p.angry);
    const extra0 = others.map(p => p.moodExtra);
    let spread = false;
    for (let i = 0; i < 200 && !spread; i++) spread = R.step(G, DT).some(e => e.type === 'spread');
    check(spread && imp.angry && R.waitNow(G, imp) <= R.MOOD.green[1] / 2 + DT, 'せっかち: 限界の半分で怒らない');
    check(others.some((p, i) => p.moodExtra > extra0[i]), 'せっかち: 不満が待合にうつらない');
  }
  // トイレ: 予約中にいなくなり、その間は部屋が空いても始まらない
  {
    const G = R.newGame();
    let g;
    while (!(g = G.patients.find(p => p.char === 'toilet'))) R.step(G, DT);
    // 一般撮影 1 を長い腰椎でふさいで、源さんを予約する
    G.rooms[0].p = { exams: ['腰椎'], step: 0 }; G.rooms[0].left = 6; G.rooms[0].total = 6; G.rooms[0].marks = [];
    G.rooms[1].p = { exams: ['腰椎'], step: 0 }; G.rooms[1].left = 30; G.rooms[1].total = 30; G.rooms[1].marks = [];
    check(R.assign(G, g.id, 'xr1') === 'reserved', 'トイレ: 予約できない');
    let away = false;
    for (let i = 0; i < 20 && !away; i++) away = R.step(G, DT).some(e => e.type === 'toilet');
    check(away && R.isAway(G, g), 'トイレ: 予約中にいなくならない');
    for (let i = 0; i < 20 && R.isAway(G, g); i++) {
      R.step(G, DT);
      if (R.isAway(G, g)) check(G.rooms[0].p !== g, 'トイレ: いないのに検査が始まった');
    }
    R.step(G, DT);
    check(G.rooms[0].p === g, 'トイレ: 戻っても予約の検査が始まらない');
  }
  // トイレ中は、ほかの部屋にも入れない。空いた部屋に別の人を入れたら、その人が先で、源さんは予約に残る
  {
    const G = R.newGame();
    let g;
    while (!(g = G.patients.find(p => p.char === 'toilet'))) R.step(G, DT);
    G.rooms[0].p = { exams: ['腰椎'], step: 0 }; G.rooms[0].left = 3; G.rooms[0].total = 3; G.rooms[0].marks = [];
    G.rooms[1].p = { exams: ['腰椎'], step: 0 }; G.rooms[1].left = 1.5; G.rooms[1].total = 1.5; G.rooms[1].marks = [];
    R.assign(G, g.id, 'xr1');
    G.t = g.reservedAt + g.toiletDelay; R.step(G, 0.01);
    check(R.isAway(G, g), 'トイレ: 準備でいなくならない');
    for (let i = 0; i < 7; i++) R.step(G, DT); // 一般撮影 2 と 1 が空く（トイレは 4 分なので、まだ戻らない）
    check(!R.canTake(G, 'xr2', g.id) && R.assign(G, g.id, 'xr2') === null, 'トイレ中の人を別の部屋に入れられてしまう');
    const other = { id: 9999, src: '外来', sev: 'green', exams: ['胸部'], step: 0, char: null, waitSince: G.t, waited: 0, redWait: 0, angry: false, moodExtra: 0, reservedFor: null, awayUntil: 0 };
    G.patients.push(other);
    check(G.rooms[0].p === null && R.assign(G, other.id, 'xr1') === 'started', 'トイレ中に空いた部屋へ、別の人を入れられない');
    check(G.rooms[0].next === g, 'トイレ: 別の人を入れたら、源さんの予約が消えた');
  }
  // 付き添いありの子どもは撮り直しにならない（来たときに決まる）
  {
    const orig = R.SCHEDULE.map(r => r.escort);
    const ci = R.SCHEDULE.findIndex(r => r.char === 'child');
    let retakes = 0;
    for (let seed = 1; seed <= 300; seed++) {
      R.SCHEDULE[ci].escort = true;
      const H = R.newGame(seed);
      while (H.nextIdx <= ci) R.step(H, 5);
      if ([...H.patients, ...H.done, ...H.rooms.map(r => r.p)].find(p => p && p.char === 'child').retake) retakes++;
    }
    R.SCHEDULE[ci].escort = orig[ci];
    check(retakes === 0, `付き添いありの子どもが撮り直しになる（${retakes}回）`);
  }
  // 終了は一度だけ。終わったあとの step は何もしない
  {
    const G = R.newGame();
    let ends = 0;
    for (let n = 0; n < 20000 && !G.ended; n++) { smart(G); ends += R.step(G, DT).filter(e => e.type === 'end').length; }
    for (let i = 0; i < 10; i++) ends += R.step(G, DT).filter(e => e.type === 'end').length;
    const t = G.t; R.step(G, 1);
    check(ends === 1 && G.t === t, `終了の合図が ${ends} 回出る、または終了後も時間が進む`);
    // 一時停止（dt=0）では時間が進まないが、操作はできる
    const H = R.newGame(); R.step(H, 0.1);
    const t0 = H.t, p = R.waiting(H)[0];
    R.step(H, 0);
    const r = H.rooms.find(x => R.canTake(H, x.id, p.id));
    check(H.t === t0 && R.assign(H, p.id, r.id) === 'started', '一時停止中に時間が進む、または操作できない');
  }
  // 終わったら感謝のひと言
  const res = R.result(play(smart));
  check(res.met.length === 5 && res.met.every(m => m.thanks), 'キャラ5人が結果に出ない、または感謝のひと言がない');
}

// ---- 6. 言葉 ----
{
  const html = fs.readFileSync(path.join(ROOT, 'rad-dept-sim/index.html'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'rad-dept-sim/rad-core.js'), 'utf8');
  check(!/クレーマー/.test(html + core), '画面に「クレーマー」と書いてある');
  check(/ゲーム用の目安/.test(html), '時間がゲーム用の目安であることを画面に書いていない');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
