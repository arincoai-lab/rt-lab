# 海外旅行の被ばく線量: 線量率の格子の作り方

`flight-dose/doserate-2025.json`（高度 11 km・客室内の実効線量率、2° 格子）は、JAEA の PARMA で作る。
PARMA 本体はリポジトリに入れていない（約 9.5 MB）。作り直すときは次の手順で取得する。

1. https://phits.jaea.go.jp/expacs/download.htm の利用許諾条件を読む（改変・再配布可。成果の公開時は論文2本と URL の参照、`nsed-expacs@jaea.go.jp` への報告が必要）
2. `https://phits.jaea.go.jp/expacs/data/parma_cpp.zip` を取得（4.19 版の sha256 は `scripts/flight-dose-provenance.json` の `sources.PARMA.sha256`）し、展開したフォルダに `grid.cpp` をコピーする
3. ビルド（macOS の Command Line Tools で標準ヘッダが見つからないときは SDK の libc++ を明示する）

   ```bash
   S=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
   xcrun clang++ -O2 -std=c++17 -w -nostdinc++ -isystem $S/usr/include/c++/v1 -isysroot $S grid.cpp subroutines.cpp -o grid
   ```

4. 計算（約3分）と変換

   ```bash
   ./grid 2025 11 -11 2 2 > grid-2025-11km.txt
   python3 scripts/flight-dose/grid-to-json.py grid-2025-11km.txt flight-dose/doserate-2025.json
   node scripts/test-flight-dose.js
   ```

引数は 年・高度(km)・形状パラメータ g（-11 = 客室）・緯度刻み・経度刻み。
1地点の確認は `./grid 2025 11 -11 2 2 test <緯度> <経度>`。

注意: PARMA 4.19 の太陽活動（W-index）の日別値は 2026-03-26 まで。それより後の日付は W=0 になり、線量が2〜3割高く出る。
