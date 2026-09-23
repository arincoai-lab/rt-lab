#!/usr/bin/env node
/**
 * drl-comparison のプロトコール名マッピングに対する「第二意見」オラクル。
 *
 *   node scripts/jev-drl-oracle.js --dry-run          # キー不要。件数とトークン量の見積りだけ
 *   TYPESAFE_API_KEY=... node scripts/jev-drl-oracle.js
 *
 * 何をするか:
 *   合成したプロトコル名コーパス（scripts/fixtures/protocol-names.json）を、
 *   ①drl-comparison が実際に積んでいる suggestDrlCategory（HTMLから抽出してそのまま実行）と
 *   ②判定専用モデル Jev（Choice）の両方にかけ、食い違いを一覧にする。
 *   食い違いに人が正解を付け、キーワード判定側の誤りと確定したものを
 *   scripts/test-drl-mapping.js の回帰ケースに足す、という使い方をする。
 *
 * 設計上の約束:
 *   - 実施設のデータは使わない。コーパスは合成（fixtures の _note を参照）
 *   - 年齢帯・管電圧帯・FOV の数値判定は**コード側で先に確定**させ、
 *     矛盾する選択肢を落としてから Jev に渡す（Jev は not a calculator）
 *   - Jev が「より緩い（DRL値の高い）区分」を出したケースは常に別枠で出す。
 *     2026-09-09 に見つかった誤マッピングは全部この向きだった
 *   - このスクリプトは drl-comparison/index.html を書き換えない。読むだけ
 *
 * 出力先は既定で OS の一時ディレクトリ（--out で変更可）。本番には公開されない（deploy.yml が scripts を除外）。
 * 実行要件: Node.js 18 以上（グローバル fetch と AbortSignal.timeout を使う）。--dry-run だけは古い Node でも動く。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.dirname(__dirname);
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const EXCLUDE_LABEL = '（対象外）';
const PRICE_PER_MTOK_INPUT = 0.042; // USD。2026-09 時点の公表値（出力は無料）

// ---------------------------------------------------------------- 引数
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const DRY = has('dry-run');
const MODEL = opt('model', 'jev-1.13.0');
const ONLY_MOD = opt('modality', null);
const LIMIT = Number(opt('limit', 0));
const CONCURRENCY = Math.max(1, Number(opt('concurrency', 4)));
const OUT_DIR = opt('out', path.join(os.tmpdir(), 'jev-drl-oracle'));

// ---------------------------------------------------------------- 実物のマッチャを読む
// テスト側（test-drl-mapping.js）はロジックを書き写しているが、ここでは
// drl-comparison が配信している suggestDrlCategory 本体を抽出して実行する。
// 写し間違いの入る余地をなくすため。
function loadTool() {
  const html = fs.readFileSync(path.join(ROOT, 'drl-comparison/index.html'), 'utf8');
  const modSrc = (html.match(/const MODALITIES = \{[\s\S]*?\n\};/) || [])[0];
  const fnSrc = (html.match(/function suggestDrlCategory\(protocolName\) \{[\s\S]*?\n\}\n/) || [])[0];
  if (!modSrc || !fnSrc) throw new Error('drl-comparison/index.html から MODALITIES / suggestDrlCategory を抽出できなかった');
  const factory = new Function(`
    ${modSrc}
    const EXCLUDE_LABEL = ${JSON.stringify(EXCLUDE_LABEL)};
    let currentModality = 'ct';
    function mod() { return MODALITIES[currentModality]; }
    ${fnSrc}
    return {
      MODALITIES,
      suggest(modality, name) { currentModality = modality; return suggestDrlCategory(name); }
    };
  `);
  return factory();
}

// ---------------------------------------------------------------- 数値はコードで確定させる
// Jev は日付・数値の比較が苦手（公式 model-jaggedness に明記）。年齢帯・管電圧帯・FOV は
// ここで取り出し、矛盾する選択肢を落としてから渡す。
function parseFacts(name) {
  const facts = {};
  const s = name
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ｋＫ]/g, 'k').replace(/[ｖＶ]/g, 'v');

  // 「5-10歳」「10歳未満」は患者の年齢ではなく区分の表記なので読まない。
  // 読んでしまうと上限側（10歳）を患者年齢と誤解し、正解の帯を選択肢から落とす。
  const isBandLabel = /\d+\s*[-‐–—〜～~]\s*<?\s*\d+\s*(?:歳|才)/.test(s)
    || /\d+\s*(?:歳|才)\s*(?:未満|以上|以下)/.test(s);

  if (!isBandLabel) {
    let m = s.match(/(\d+)\s*(?:歳|才)\s*(\d+)\s*(?:か月|ヶ月|ケ月|カ月)/);
    if (m) facts.age_years = Number(m[1]) + Number(m[2]) / 12;
    if (facts.age_years === undefined) {
      m = s.match(/(\d+(?:\.\d+)?)\s*(?:歳|才)/) || s.match(/(\d+(?:\.\d+)?)\s*(?:y\.?o\.?|yo|yrs?|years?|y)(?![a-z])/i);
      if (m) facts.age_years = Number(m[1]);
    }
    if (facts.age_years === undefined) {
      // 'mo' は MODE・MOTION 等の語頭に当たるため、直後が英字なら月齢と見なさない
      m = s.match(/(?:生後\s*)?(\d+)\s*(?:か月|ヶ月|ケ月|カ月|months?|mo(?![a-z]))/i);
      if (m) facts.age_years = Number(m[1]) / 12;
    }
    if (facts.age_years === undefined && /新生児|neonat/i.test(s)) facts.age_years = 0;
    if (facts.age_years === undefined && /乳児|infant/i.test(s)) facts.age_years = 0.5;
  }

  // 管電圧は文字列表記を数値マッチより先に見る（「100kV未満」を kv=100 と読まないため）
  if (/100\s*kv\s*未満/i.test(s)) facts.kv = 99;
  else if (/100\s*kv\s*以上/i.test(s)) facts.kv = 100;
  else {
    const m = s.match(/(?:^|[^0-9])(\d{2,3})\s*kv/i);
    if (m) facts.kv = Number(m[1]);
  }

  const f = s.match(/(\d+(?:\.\d+)?)\s*cm(?:2|²|\^2)/i);
  if (f) facts.fov_cm2 = Number(f[1]);

  return facts;
}

// 数値と矛盾する区分をふるい落とす。返り値は [残った区分, 落とした理由]
function filterCategories(modality, categories, facts) {
  const dropped = [];
  const keep = categories.filter((cat) => {
    if (modality === 'pediatric_ct') {
      const band = cat.match(/（(\d+)-<(\d+)歳）/);
      if (band && facts.age_years !== undefined) {
        const ok = facts.age_years >= Number(band[1]) && facts.age_years < Number(band[2]);
        if (!ok) dropped.push(cat);
        return ok;
      }
      return true;
    }
    if (modality === 'general') {
      if (facts.age_years !== undefined) {
        const isInfant = /（0〜1歳）/.test(cat);
        const isChild5 = /（5歳）/.test(cat);
        const isChild10 = /（10歳）/.test(cat);
        const isPed = isInfant || isChild5 || isChild10;
        let ok;
        // general の区分は「（0〜1歳）」という包含表記（pediatric_ct の「0-<1歳」とは違う）
        if (facts.age_years <= 1) ok = isInfant;
        else if (facts.age_years < 10) ok = isChild5;
        else if (facts.age_years < 15) ok = isChild10;
        else ok = !isPed;
        if (!ok) dropped.push(cat);
        return ok;
      }
      if (facts.kv !== undefined) {
        if (facts.kv >= 100 && /100kV未満/.test(cat)) { dropped.push(cat); return false; }
        if (facts.kv < 100 && /100kV以上/.test(cat)) { dropped.push(cat); return false; }
      }
      return true;
    }
    if (modality === 'dental' && facts.fov_cm2 !== undefined && /CBCT/.test(cat)) {
      const ok = facts.fov_cm2 < 40 ? /FOV<40/.test(cat)
        : facts.fov_cm2 <= 100 ? /FOV 40〜100/.test(cat)
          : /FOV>100/.test(cat);
      if (!ok) dropped.push(cat);
      return ok;
    }
    return true;
  });
  return [keep, dropped];
}

// ---------------------------------------------------------------- 質問を組み立てる
function buildRequest(tool, modality, name) {
  const m = tool.MODALITIES[modality];
  const facts = parseFacts(name);
  const [cats, dropped] = filterCategories(modality, Object.keys(m.drl), facts);

  const criteria = {};
  for (const cat of cats) criteria[cat] = `Japan DRLs 2025 の区分「${cat}」に当たる検査`;
  criteria[EXCLUDE_LABEL] = 'DRLs 2025 に対応する区分がない、またはプロトコル名だけでは区分を決められない';

  const state = {
    protocol_name: name,
    modality: m.name,
    confirmed_numbers: Object.keys(facts).length ? facts : '（名前に年齢・管電圧・FOVの記載なし）',
    note: 'protocol_name は医療機関が検査装置に登録している検査プロトコルの名前。患者情報ではない'
  };

  const body = {
    model: MODEL,
    state,
    questions: {
      category: {
        type: 'choice',
        instructions: '`protocol_name` はどの診断参考レベル（DRL）の区分に当たるか。'
          + '年齢帯・管電圧帯・FOV の数値による絞り込みは `confirmed_numbers` を使って'
          + 'こちらで済ませてあるので、選択肢の中から部位と撮影法の一致だけで選ぶこと。'
          + '数を数えたり大小を比べたりする必要はない。'
          + `当てはまる区分が無いときや、名前だけでは決められないときは「${EXCLUDE_LABEL}」を選ぶこと。`,
        criteria
      }
    }
  };
  return { body, facts, dropped, nOptions: cats.length + 1 };
}

// ---------------------------------------------------------------- API 呼び出し
async function callJev(body, apiKey) {
  const MAX = 5;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });
    } catch (e) {
      if (attempt === MAX) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 429 || res.status === 529 || res.status >= 500) {
      if (attempt === MAX) throw new Error(`${res.status} ${await res.text()}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }
}

async function pool(items, size, worker) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  }));
  return out;
}

// ---------------------------------------------------------------- 判定の向き
// Jev の提案が「より緩い（DRL値が高い）」かどうか。過去の誤マッピングは全部この向きだった。
function drlDirection(m, keywordCat, jevCat) {
  if (keywordCat === jevCat) return 'same';
  const vals = (cat) => (cat && cat !== EXCLUDE_LABEL && m.drl[cat]) ? m.drl[cat] : null;
  const a = vals(keywordCat), b = vals(jevCat);
  if (!a || !b) {
    if (!a && b) return 'keyword-missed';   // キーワードは（対象外）、Jev は区分を提案
    if (a && !b) return 'jev-excluded';     // キーワードは区分を提案、Jev は（対象外）
    return 'both-excluded';
  }
  // 指標が複数あるとき（CTDIvol と DLP、Ka,r と PKA）は片方だけ緩いことがある。
  // 最初の指標で打ち切ると、その食い違いが警告表から漏れる。
  let anyHigher = false, anyLower = false;
  for (const k of Object.keys(a)) {
    if (a[k] === null || b[k] === null || b[k] === undefined) continue;
    if (b[k] > a[k]) anyHigher = true;
    if (b[k] < a[k]) anyLower = true;
  }
  if (anyHigher) return 'jev-looser';       // 1指標でも高ければ施設に甘い判定になりうる
  if (anyLower) return 'jev-stricter';
  return 'equal-values';
}

// ---------------------------------------------------------------- 本体
async function main() {
  const tool = loadTool();
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/protocol-names.json'), 'utf8'));
  let cases = fixture.cases.filter((c) => !ONLY_MOD || c.modality === ONLY_MOD);
  if (LIMIT > 0) cases = cases.slice(0, LIMIT);

  for (const c of cases) {
    if (!tool.MODALITIES[c.modality]) throw new Error(`未知のモダリティ: ${c.modality}（${c.name}）`);
    if (c.expect && c.expect !== EXCLUDE_LABEL && !(c.expect in tool.MODALITIES[c.modality].drl)) {
      throw new Error(`fixtures の expect が区分名と一致しない: ${c.modality} / ${c.name} -> ${c.expect}`);
    }
  }

  const prepared = cases.map((c) => {
    const req = buildRequest(tool, c.modality, c.name);
    const kw = tool.suggest(c.modality, c.name);
    return { ...c, ...req, keyword: kw.category, keywordAuto: kw.auto };
  });

  const nCats = Object.values(tool.MODALITIES).reduce((s, m) => s + Object.keys(m.drl).length, 0);
  console.log(`区分の総数: ${nCats}（${Object.keys(tool.MODALITIES).length} モダリティ）`);
  console.log(`コーパス: ${prepared.length} 件` + (ONLY_MOD ? `（--modality ${ONLY_MOD}）` : ''));

  if (DRY) {
    const chars = prepared.reduce((s, p) => s + JSON.stringify(p.body).length, 0);
    const tok = Math.round(chars / 2.2); // 日本語混じりの粗い見積り
    console.log(`推定入力トークン: 約 ${tok.toLocaleString()} tok（1件あたり 約 ${Math.round(tok / prepared.length)} tok）`);
    console.log(`推定費用: 約 $${(tok / 1e6 * PRICE_PER_MTOK_INPUT).toFixed(4)}（入力 $${PRICE_PER_MTOK_INPUT}/MTok・出力無料として）`);
    const byMod = {};
    for (const p of prepared) {
      byMod[p.modality] = byMod[p.modality] || { n: 0, opts: 0, dropped: 0 };
      byMod[p.modality].n++; byMod[p.modality].opts += p.nOptions; byMod[p.modality].dropped += p.dropped.length;
    }
    console.log('\nモダリティ | 件数 | 平均選択肢数 | 数値で落とした選択肢の平均');
    for (const [k, v] of Object.entries(byMod)) {
      console.log(`  ${k.padEnd(13)} ${String(v.n).padStart(4)}  ${(v.opts / v.n).toFixed(1).padStart(8)}  ${(v.dropped / v.n).toFixed(1).padStart(10)}`);
    }
    if (has('show')) {
      console.log('\n名前 → 数値の確定値 / 残った選択肢数 / キーワード判定');
      for (const p of prepared) {
        console.log(`  ${p.name}  |  ${JSON.stringify(p.facts)}  |  ${p.nOptions}択  |  ${p.keyword}`);
      }
    }
    console.log('\n--dry-run のためAPIは呼んでいない。実行するには TYPESAFE_API_KEY を設定して --dry-run を外す。');
    return;
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    console.error('TYPESAFE_API_KEY が未設定。環境変数で渡すこと（リポジトリ内のファイルに書かない）。');
    process.exit(1);
  }

  let usedIn = 0, usedOut = 0, failed = 0;
  const t0 = Date.now();
  const rows = await pool(prepared, CONCURRENCY, async (p, i) => {
    // 数値の確定だけで候補が（対象外）しか残らない行は、聞くまでもないので呼ばない
    if (p.nOptions <= 1) {
      return {
        modality: p.modality, name: p.name, expect: p.expect ?? null,
        keyword: p.keyword, keywordAuto: p.keywordAuto,
        jev: EXCLUDE_LABEL, confidence: null, p_jev: null,
        facts: p.facts, droppedByNumbers: p.dropped.length, model: '(skipped: 数値で候補が0件)'
      };
    }
    try {
      const res = await callJev(p.body, apiKey);
      const a = res.answers.category;
      usedIn += res.usage?.input_tokens || 0;
      usedOut += res.usage?.output_tokens || 0;
      if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${prepared.length}\n`);
      return {
        modality: p.modality, name: p.name, expect: p.expect ?? null,
        keyword: p.keyword, keywordAuto: p.keywordAuto,
        jev: a.choice, confidence: a.confidence ?? null,
        p_jev: a.probabilities ? a.probabilities[a.choice] ?? null : null,
        facts: p.facts, droppedByNumbers: p.dropped.length,
        model: res.model
      };
    } catch (e) {
      failed++;
      return { modality: p.modality, name: p.name, expect: p.expect ?? null, keyword: p.keyword, error: String(e.message || e) };
    }
  });

  const ok = rows.filter((r) => !r.error);
  for (const r of ok) r.direction = drlDirection(tool.MODALITIES[r.modality], r.keyword, r.jev);

  // ---- 集計
  const agree = ok.filter((r) => r.keyword === r.jev);
  const disagree = ok.filter((r) => r.keyword !== r.jev);
  const labeled = ok.filter((r) => r.expect);
  const kwRight = labeled.filter((r) => r.keyword === r.expect);
  const jevRight = labeled.filter((r) => r.jev === r.expect);
  const looser = disagree.filter((r) => r.direction === 'jev-looser');
  const invented = disagree.filter((r) => r.direction === 'jev-excluded');  // ツールが勝手に区分を当てている疑い
  const undecided = ok.filter((r) => !r.expect);

  const bins = [[0, 0.7], [0.7, 0.85], [0.85, 0.95], [0.95, 1.01]];
  const binRows = bins.map(([lo, hi]) => {
    const inBin = ok.filter((r) => r.confidence !== null && r.confidence >= lo && r.confidence < hi);
    const lab = inBin.filter((r) => r.expect);
    return {
      bin: `[${lo.toFixed(2)},${hi.toFixed(2)})`, n: inBin.length,
      agree_with_keyword: inBin.length ? (inBin.filter((r) => r.keyword === r.jev).length / inBin.length) : null,
      n_labeled: lab.length,
      jev_accuracy: lab.length ? (lab.filter((r) => r.jev === r.expect).length / lab.length) : null
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const runId = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const jsonPath = path.join(OUT_DIR, `oracle-${runId}.json`);
  const mdPath = path.join(OUT_DIR, `oracle-${runId}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    run: { date: stamp, model: MODEL, modelReturned: ok[0]?.model ?? null, n: rows.length, failed, usage: { input_tokens: usedIn, output_tokens: usedOut } },
    summary: { agree: agree.length, disagree: disagree.length, labeled: labeled.length, keyword_accuracy: labeled.length ? kwRight.length / labeled.length : null, jev_accuracy: labeled.length ? jevRight.length / labeled.length : null },
    bins: binRows, rows
  }, null, 2));

  const fmt = (x) => x === null ? '—' : (x * 100).toFixed(1) + '%';
  const md = [];
  md.push(`# DRL マッピング 第二意見オラクル（${stamp}）`, '');
  md.push(`- モデル: \`${ok[0]?.model ?? MODEL}\` / 件数 ${rows.length}（失敗 ${failed}）/ 入力 ${usedIn.toLocaleString()} tok / 概算 $${(usedIn / 1e6 * PRICE_PER_MTOK_INPUT).toFixed(4)}`);
  md.push(`- キーワード判定と Jev の一致: **${agree.length}/${ok.length}（${fmt(agree.length / ok.length)}）**`);
  md.push(`- 参考ラベル付き ${labeled.length} 件での正答率: キーワード **${fmt(labeled.length ? kwRight.length / labeled.length : null)}** / Jev **${fmt(labeled.length ? jevRight.length / labeled.length : null)}**`);
  md.push(`  - ラベルは fixtures の \`expect\`（合成・**人の確認が要る参考値**）。これ自体を正解として扱わないこと`);
  md.push(`  - **未確定（\`expect: null\`）の ${undecided.length} 件はこの分母に入っていない**。区分の有無の解釈が割れる難しい名前がここに集まるので、正答率はその分だけ甘く出る`, '');
  if (undecided.length) {
    md.push('### 未確定のまま（人が決めたら fixtures の expect を埋める）', '',
      '| モダリティ | プロトコル名 | キーワード判定 | Jev | conf |', '|---|---|---|---|---|');
    for (const r of undecided) md.push(`| ${r.modality} | ${r.name} | ${r.keyword} | ${r.jev} | ${r.confidence?.toFixed(3) ?? '—'} |`);
    md.push('');
  }
  md.push('## 確信度の区間', '', '| 区間 | n | キーワードとの一致 | ラベル付き n | Jev 正答率 |', '|---|---|---|---|---|');
  for (const b of binRows) md.push(`| ${b.bin} | ${b.n} | ${fmt(b.agree_with_keyword)} | ${b.n_labeled} | ${fmt(b.jev_accuracy)} |`);
  md.push('', `## ⚠️ Jev が「より緩い区分」を出した食い違い（${looser.length} 件）`, '',
    '過去の誤マッピングは全部この向きだった。どちらが正しいかを人が判断し、キーワード側が誤りなら回帰ケースに足す。', '',
    '| モダリティ | プロトコル名 | キーワード判定 | Jev | conf | 参考ラベル |', '|---|---|---|---|---|---|');
  for (const r of looser) md.push(`| ${r.modality} | ${r.name} | ${r.keyword} | ${r.jev} | ${r.confidence?.toFixed(3) ?? '—'} | ${r.expect ?? '—'} |`);
  md.push('', `## ⚠️ キーワード判定が区分を当て、Jev は「区分なし」と言った食い違い（${invented.length} 件）`, '',
    'DRLs2025 に対応区分が無い検査にツールが勝手に区分を当てていないか。過去の事故（2026-09-09 の誤マッピング、',
    "今回の '単純'／'正面' のワイルドカード）はすべてこの形だった。", '',
    '| モダリティ | プロトコル名 | キーワード判定 | conf(Jevの区分なし確度) | 参考ラベル |', '|---|---|---|---|---|');
  for (const r of invented) md.push(`| ${r.modality} | ${r.name} | ${r.keyword} | ${r.confidence?.toFixed(3) ?? '—'} | ${r.expect ?? '未確定'} |`);
  md.push('', `## その他の食い違い（${disagree.length - looser.length - invented.length} 件）`, '',
    '| モダリティ | プロトコル名 | キーワード判定 | Jev | conf | 向き | 参考ラベル |', '|---|---|---|---|---|---|---|');
  for (const r of disagree.filter((x) => x.direction !== 'jev-looser' && x.direction !== 'jev-excluded')) {
    md.push(`| ${r.modality} | ${r.name} | ${r.keyword} | ${r.jev} | ${r.confidence?.toFixed(3) ?? '—'} | ${r.direction} | ${r.expect ?? '—'} |`);
  }
  const bothWrong = labeled.filter((r) => r.keyword !== r.expect && r.jev !== r.expect);
  md.push('', `## 両方とも参考ラベルと違うケース（${bothWrong.length} 件）`, '',
    '| モダリティ | プロトコル名 | キーワード | Jev | 参考ラベル |', '|---|---|---|---|---|');
  for (const r of bothWrong) md.push(`| ${r.modality} | ${r.name} | ${r.keyword} | ${r.jev} | ${r.expect} |`);
  if (failed) {
    md.push('', `## 失敗 ${failed} 件`, '');
    for (const r of rows.filter((x) => x.error)) md.push(`- ${r.modality} / ${r.name}: ${r.error}`);
  }
  fs.writeFileSync(mdPath, md.join('\n') + '\n');

  console.log(`\n一致 ${agree.length}/${ok.length}（${fmt(agree.length / ok.length)}）・食い違い ${disagree.length}（うち「より緩い」${looser.length}）`);
  if (labeled.length) console.log(`参考ラベル ${labeled.length} 件での正答率: キーワード ${fmt(kwRight.length / labeled.length)} / Jev ${fmt(jevRight.length / labeled.length)}`);
  console.log(`入力 ${usedIn.toLocaleString()} tok・概算 $${(usedIn / 1e6 * PRICE_PER_MTOK_INPUT).toFixed(4)}・${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`レポート: ${mdPath}\nJSON:     ${jsonPath}`);
  if (failed) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { loadTool, parseFacts, filterCategories, drlDirection, buildRequest };
