#!/usr/bin/env node
/**
 * 胸部X線写真の匠（chest-xray-master/chest-core.js）の回帰テスト。
 *
 *   node scripts/test-chest-xray.js
 *
 * 守りたいこと:
 *  1. 採点の項目と点が原典の照合表（scripts/chest-xray-provenance.json）と一致する
 *  2. 正しく合わせれば必ず100点に届き、何もしないと低い点になる（難しさの両端）
 *  3. 1つだけ崩すと、その項目だけが減点される（採点の説明と点がずれない）
 *  4. 呼吸のどの瞬間に撮っても、点が 0..満点 の整数（NaN や負にならない）
 *  5. 吸気の判定が原典の「後ろの肋骨10本」に合っている
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/chest-xray-provenance.json'), 'utf8'));
let C;
try {
  C = require(path.join(ROOT, 'chest-xray-master/chest-core.js'));
} catch (e) {
  console.error('chest-core.js を読み込めない: ' + e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(cond, msg) {
  if (cond) pass++;
  else { fail++; console.log('FAIL: ' + msg); }
}
const byKey = r => Object.fromEntries(r.items.map(i => [i.key, i]));
const TYPES = C.PATIENT_TYPES.map(t => t.id);
function eachPatient(fn) {
  for (const id of TYPES) for (let seed = 1; seed <= 20; seed++) fn(C.makePatient(id, C.makeRng(seed)), id, seed);
}

// ---------------------------------------------------------------- 1. 照合表との一致（maxPoints）
{
  const p = C.makePatient(TYPES[0], C.makeRng(1));
  const r = C.score(p, C.ideal(p));
  const keys = Object.keys(prov.criteria);
  check(r.items.length === keys.length, `採点項目は${keys.length}つのはず（実際 ${r.items.length}）`);
  check(r.items.reduce((a, b) => a + b.max, 0) === 100, '満点の合計は100');
  for (const k of keys) {
    const it = r.items.find(i => i.key === k);
    check(it && it.max === prov.criteria[k].max, `${k} の満点が照合表（${prov.criteria[k].max}）と一致`);
  }
  check(C.POSTERIOR_RIBS_FULL === prov.criteria.inspiration.posterior_ribs_full, '吸気の基準（後ろの肋骨の本数）が照合表と一致');
}

// ---------------------------------------------------------------- 2. 難しさの両端（idealIs100 / untouchedIsLow）
eachPatient((p, id, seed) => {
  const r = C.score(p, C.ideal(p));
  check(r.total === 100, `${id}#${seed}: 正しく合わせると100点（実際 ${r.total}: ${JSON.stringify(r.items.map(i => i.key + i.pt))}）`);
});
{
  let sum = 0, n = 0;
  eachPatient(p => {
    sum += C.score(p, { controls: C.defaultControls(p), lvl: 0.35, v: 0.1 }).total; n++;
  });
  check(sum / n <= 30, `何もせず普通の呼吸中に撮ると平均30点以下（実際 ${(sum / n).toFixed(1)}）`);
}

// ---------------------------------------------------------------- 3. 1項目だけ崩す（oneItemOnly）
{
  const breaks = [
    ['rot', s => { s.controls.rot += 3; }],
    ['center', s => { s.controls.x += 3; }],
    ['scapula', s => { s.controls.roll = 0; }],
    ['coverage', s => { s.controls.panelY += 10; }],
    ['inspiration', s => { s.lvl = 0.6; }],
    ['motion', s => { s.v = 0.1; }],
  ];
  eachPatient((p, id, seed) => {
    for (const [key, mut] of breaks) {
      const shot = C.ideal(p); shot.controls = { ...shot.controls }; mut(shot);
      const r = byKey(C.score(p, shot));
      for (const k of Object.keys(r)) {
        if (k === key) check(r[k].pt < r[k].max, `${id}#${seed}: ${key} を崩すと ${key} が減点される`);
        else check(r[k].pt === r[k].max, `${id}#${seed}: ${key} を崩しても ${k} は満点のまま（実際 ${r[k].pt}/${r[k].max}）`);
      }
    }
  });
}

// ---------------------------------------------------------------- 4. 呼吸の全区間（scoreFiniteEverywhere）
eachPatient((p, id, seed) => {
  if (seed > 3) return;
  let b = C.newBreath();
  const ctl = C.ideal(p).controls;
  for (let i = 0; i < 400; i++) {
    if (i === 40) b = C.startInhale(b);
    b = C.breathStep(b, p, 0.05);
    check(Number.isFinite(b.lvl) && b.lvl >= 0 && b.lvl <= 1, `${id}#${seed} t=${(i * 0.05).toFixed(2)}: 呼吸の深さが 0..1`);
    const r = C.score(p, { controls: ctl, lvl: b.lvl, v: b.v });
    for (const it of r.items) check(Number.isInteger(it.pt) && it.pt >= 0 && it.pt <= it.max, `${id}#${seed} t=${(i * 0.05).toFixed(2)}: ${it.key} の点が 0..${it.max} の整数（実際 ${it.pt}）`);
  }
});
{
  // 息止めは患者ごとの秒数で終わり、吸い直すまで深吸気に戻らない
  const p = C.makePatient('elderly', C.makeRng(5));
  let b = C.startInhale(C.newBreath());
  for (let t = 0; t < 1.6 + p.hold + 0.5; t += 0.05) b = C.breathStep(b, p, 0.05);
  check(b.mode === 'release' || b.mode === 'tidal', `高齢の人は ${p.hold} 秒で息止めが終わる（実際 mode=${b.mode}）`);
  check(C.startInhale({ ...b, mode: 'hold' }).mode === 'hold', '息止め中に「吸って」を押しても何も起きない');
}

// ---------------------------------------------------------------- 5. 吸気の判定（inspirationRule）
eachPatient((p, id, seed) => {
  const ctl = C.ideal(p).controls;
  const at = lvl => byKey(C.score(p, { controls: ctl, lvl, v: 0 })).inspiration.info.ribs;
  check(at(1) === C.POSTERIOR_RIBS_FULL, `${id}#${seed}: 吸いきると横隔膜は後ろの肋骨${C.POSTERIOR_RIBS_FULL}本目（実際 ${at(1)}）`);
  check(at(0.6) <= C.POSTERIOR_RIBS_FULL - 1, `${id}#${seed}: 浅い吸気（0.6）では9本目以下（実際 ${at(0.6)}）`);
});

// ---------------------------------------------------------------- 6. 操作の範囲（controlsClamped）
{
  const c = C.clampControls({ x: 99, rot: -99, roll: 5, panelY: -99 });
  for (const k of Object.keys(C.CONTROL_RANGE)) {
    const [lo, hi] = C.CONTROL_RANGE[k];
    check(c[k] >= lo && c[k] <= hi, `clampControls: ${k} が範囲内（実際 ${c[k]}）`);
  }
  check(C.clampControls({ x: NaN, rot: 0, roll: 0, panelY: 0 }).x === 0, 'clampControls: NaN は0に');
  eachPatient(p => {
    const ideal = C.ideal(p).controls;
    for (const k of Object.keys(C.CONTROL_RANGE)) {
      const [lo, hi] = C.CONTROL_RANGE[k];
      check(ideal[k] >= lo && ideal[k] <= hi, `${p.type}: 満点の操作 ${k}=${ideal[k]} が操作の範囲内`);
    }
  });
}

// ---------------------------------------------------------------- 7. 同じ種から同じ患者（再現性）
{
  const a = C.makePatient('nervous', C.makeRng(42)), b = C.makePatient('nervous', C.makeRng(42));
  check(JSON.stringify(a) === JSON.stringify(b), '同じ種からは同じ患者が作られる');
}

// ---------------------------------------------------------------- 8. 5人のラウンド（roundOrder）
{
  const r = C.makeRound(7);
  check(r.length === 5, '1ラウンドは5人');
  check(JSON.stringify(r.map(p => p.type)) === JSON.stringify(['office', 'stiff', 'large', 'elderly', 'nervous']), '易しい順に出る');
  check(JSON.stringify(C.makeRound(7)) === JSON.stringify(r), '同じ種なら同じ5人');
}

// ---------------------------------------------------------------- 9. 落ち着かない人のゆれ
{
  for (let seed = 1; seed <= 20; seed++) {
    const r = C.makeRound(seed);
    for (const p of r) {
      for (let tt = 0; tt <= 60; tt += 0.25) {
        const sw = C.swayX(p, tt);
        if (p.type !== 'nervous') check(sw === 0 && C.livePatient(p, tt) === p, `${p.type}: ゆれない`);
        else check(Math.abs(sw) <= 1.25 + 1e-9, `nervous: ゆれは ±1.25cm 以内（実際 ${sw}）`);
      }
      // ゆれている最中でも、そのときの位置に合わせれば100点
      const lp = C.livePatient(p, 3.3);
      check(C.score(lp, C.ideal(lp)).total === 100, `${p.type}#${seed}: ゆれた位置に合わせれば100点`);
      check(C.ideal(lp).controls.x >= C.CONTROL_RANGE.x[0] && C.ideal(lp).controls.x <= C.CONTROL_RANGE.x[1], `${p.type}#${seed}: ゆれても操作の範囲内で合わせられる`);
    }
  }
}

// ---------------------------------------------------------------- 10. 称号の境界（titleBoundary）
{
  const T = (avg, sec) => C.roundResult([avg, avg, avg, avg, avg], [sec, sec, sec, sec, sec]).titleKey;
  check(T(90, 20) === 'takumi', '平均90点・1人20秒 → 匠');
  check(T(90, 20.1) === 'veteran', '平均90点・1人20.1秒 → 丁寧なベテラン');
  check(T(89, 20) === 'ace', '平均89点・1人20秒 → 検診車のエース');
  check(T(70, 60) === 'solid', '平均70点・遅い → 頼れる技師');
  check(T(50, 5) === 'rookie', '平均50点 → 新人技師');
  check(T(49, 5) === 'student', '平均49点 → 実習生');
  const r = C.roundResult([100, 90, 80, 70, 60], [10, 20, 30, 40, 50]);
  check(r.avg === 80 && r.totalSec === 150 && r.avgSec === 30, '平均点と合計時間');
}

// ---------------------------------------------------------------- 11. 投稿文に可変の情報は点数・時間・称号だけ（shareTextHasNoPII）
for (const lang of ['ja', 'en']) {
  const a = C.shareText(lang, C.roundResult([91, 91, 91, 91, 91], [11, 11, 11, 11, 11]));
  const b = C.shareText(lang, C.roundResult([91, 91, 91, 91, 91], [12, 12, 12, 12, 12]));
  check(a.includes('91') && a.includes('55.0'), `${lang}: 投稿文に点数と時間が入る`);
  check(a.replace('55.0', 'X') === b.replace('60.0', 'X'), `${lang}: 投稿文は時間以外に変わるものがない`);
  check(!/[{}]/.test(a), `${lang}: 投稿文に埋め忘れの {…} がない`);
}

// ---------------------------------------------------------------- 12. 日英の辞書（i18nKeysMatch / detectLang）
{
  const ja = Object.keys(C.I18N.ja).sort(), en = Object.keys(C.I18N.en).sort();
  const onlyJa = ja.filter(k => !en.includes(k)), onlyEn = en.filter(k => !ja.includes(k));
  check(onlyJa.length === 0, `英語に訳し漏れ: ${onlyJa.join(', ')}`);
  check(onlyEn.length === 0, `日本語にない英語のキー: ${onlyEn.join(', ')}`);
  for (const k of ja) {
    const vj = (C.I18N.ja[k].match(/\{\w+\}/g) || []).sort().join(), ve = (C.I18N.en[k] || '').match(/\{\w+\}/g);
    check(vj === (ve || []).sort().join(), `${k}: 日英で差し込む値（{…}）が同じ`);
  }
  for (const key of ['patient_', 'item_', 'title_']) {
    const need = key === 'patient_' ? C.PATIENT_TYPES.map(x => x.id) : key === 'item_' ? Object.keys(prov.criteria) : C.TITLE_RULES.map(x => x.key);
    for (const id of need) check((key + id) in C.I18N.en && (key + id) in C.I18N.ja, `文言 ${key + id} がある`);
  }
  check(C.detectLang('en-US', null) === 'en', 'ブラウザが英語 → 英語');
  check(C.detectLang('ja-JP', null) === 'ja', 'ブラウザが日本語 → 日本語');
  check(C.detectLang('ja', null) === 'ja', 'ja → 日本語');
  check(C.detectLang('fr-FR', null) === 'en', 'その他の言語 → 英語');
  check(C.detectLang('ja-JP', 'en') === 'en', '保存した選択が優先');
  check(C.detectLang(undefined, 'bogus') === 'en', '不明な値 → 英語');
  // 採点の一言が全項目・両言語で埋まる
  const p = C.makePatient('office', C.makeRng(3));
  const bad = { controls: C.defaultControls(p), lvl: 0.35, v: 0.1 };
  for (const lang of ['ja', 'en']) for (const shot of [C.ideal(p), bad]) for (const it of C.score(p, shot).items) {
    const d = C.detail(lang, it);
    check(d && !/[{}]/.test(d) && !/undefined|NaN/.test(d), `${lang}: ${it.key} の一言が埋まる（${d}）`);
  }
}

console.log(`\nchest-xray: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
