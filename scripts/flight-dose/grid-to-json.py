#!/usr/bin/env python3
"""grid.cpp の出力（lat lon Rc doserate[uSv/h]）を flight-dose/doserate-2025.json に変換する。
   python3 scripts/flight-dose/grid-to-json.py <grid.txt> flight-dose/doserate-2025.json
値は nSv/h の整数で持つ（scale=0.001 で μSv/h）。物理的にありえない値（負・NaN・0.5 未満・10 超）は止める。
"""
import json, math, sys

src, dst = sys.argv[1], sys.argv[2]
header, rows = None, []
for line in open(src):
    if line.startswith('#'):
        header = line[1:].split()
        continue
    lat, lon, rc, v = map(float, line.split())
    if not math.isfinite(v) or v < 0.5 or v > 10:
        sys.exit(f'ありえない線量率: lat {lat} lon {lon} -> {v}')
    rows.append((lat, lon, v))
lats = sorted({r[0] for r in rows}); lons = sorted({r[1] for r in rows})
if len(rows) != len(lats) * len(lons):
    sys.exit('格子が欠けている')
meta = dict(zip(header[0::2], header[1::2]))
out = {
    '_about': 'PARMA 4.19 (JAEA, EXPACS と同じモデル) で計算した高度 11 km・客室内 (g=-11) の実効線量率 (ICRP 116)。'
              '2025 年の月平均 W-index で 12 か月平均。作り方は scripts/flight-dose/README.md',
    'source': 'T. Sato, PLOS ONE 10(12): e0144679 (2015); T. Sato, PLOS ONE 11(8): e0160390 (2016); https://phits.jaea.go.jp/expacs/',
    'year': int(meta['year']), 'altKm': float(meta['alt_km']), 'g': float(meta['g']), 'meanW': round(float(meta['meanW']), 2),
    'unit': 'uSv/h', 'scale': 0.001,
    'lat0': lats[0], 'dlat': lats[1] - lats[0], 'nlat': len(lats),
    'lon0': lons[0], 'dlon': lons[1] - lons[0], 'nlon': len(lons),
    'values': [round(v * 1000) for (_, _, v) in sorted(rows)],
}
with open(dst, 'w') as f:
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
print(f'{dst}: {len(rows)} 点, {min(r[2] for r in rows):.3f}〜{max(r[2] for r in rows):.3f} μSv/h')
