#!/usr/bin/env node
/**
 * world-atlas（Natural Earth 4.1.0、1:110m、パブリックドメイン）の land-110m.json（TopoJSON）を、
 * 地図に描くだけの軽い形式（経度・緯度の輪の配列、小数2桁）に変換する。
 *   node scripts/flight-dose/land-to-json.js <land-110m.json> flight-dose/land-110m.json
 * 取得元: https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json
 */
const fs = require('fs');
const [src, dst] = process.argv.slice(2);
const topo = JSON.parse(fs.readFileSync(src, 'utf8'));
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map(arc => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; });
});
const arcPts = i => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
const ring = idx => {
  const out = [];
  idx.forEach((i, k) => { const p = arcPts(i); out.push(...(k ? p.slice(1) : p)); });
  return out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
};
const rings = [];
for (const g of topo.objects.land.geometries) {
  const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
  for (const poly of polys) for (const r of poly) rings.push(ring(r));
}
fs.writeFileSync(dst, JSON.stringify({
  _about: 'Natural Earth 1:110m の陸地（パブリックドメイン、world-atlas 2.0.2 経由）。[経度, 緯度] の輪の配列。',
  rings,
}) + '\n');
console.log(`${dst}: ${rings.length} 輪, ${rings.reduce((s, r) => s + r.length, 0)} 点`);
