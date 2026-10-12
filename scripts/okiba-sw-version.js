#!/usr/bin/env node
/**
 * okiba/sw.js の VERSION を、アプリのファイル（ASSETS）の内容のハッシュに更新する。
 *
 *   node scripts/okiba-sw-version.js          … 書き換える
 *   node scripts/okiba-sw-version.js --check  … 一致しなければ exit 1（CI 用）
 *
 * Service Worker はキャッシュ名（VERSION）が変わらないと新しいファイルを配らない。
 * 手で上げ忘れると、利用者の端末に古い app.js が残り続けるため、内容から機械的に決める。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(path.dirname(__dirname), 'okiba');
const SW = path.join(DIR, 'sw.js');
const VERSION_RE = /const VERSION = 'okiba-[0-9a-f]{8}';/;

function assetsOf(sw) {
  const m = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('sw.js に ASSETS が見つからない');
  return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
}

function computeVersion(sw) {
  const h = crypto.createHash('sha256');
  for (const a of assetsOf(sw)) {
    if (a === './') continue;
    const rel = a.replace(/^\.\//, '');
    h.update(rel + '\0');
    h.update(fs.readFileSync(path.join(DIR, rel)));
    h.update('\0');
  }
  // sw.js 自身の VERSION 行以外の変更（キャッシュ戦略の変更など）も版に含める
  h.update(sw.replace(VERSION_RE, ''));
  return 'okiba-' + h.digest('hex').slice(0, 8);
}

function main() {
  const sw = fs.readFileSync(SW, 'utf8');
  if (!VERSION_RE.test(sw)) throw new Error('sw.js に VERSION 行が見つからない');
  const want = "const VERSION = '" + computeVersion(sw) + "';";
  const have = sw.match(VERSION_RE)[0];
  if (process.argv.includes('--check')) {
    if (have !== want) {
      console.error('okiba/sw.js の VERSION が古い（' + have + ' → ' + want + '）。node scripts/okiba-sw-version.js を実行してコミットすること');
      process.exit(1);
    }
    console.log('okiba/sw.js VERSION OK');
    return;
  }
  if (have === want) { console.log('変更なし: ' + want); return; }
  fs.writeFileSync(SW, sw.replace(VERSION_RE, want));
  console.log('更新: ' + want);
}

if (require.main === module) main();
module.exports = { computeVersion, assetsOf };
