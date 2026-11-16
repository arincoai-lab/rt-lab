#!/usr/bin/env python3
"""favicon 一式を生成する（Pillow が必要: pip install pillow）。

  python3 scripts/generate-favicon.py

出力（いずれも公開対象）:
  favicon.ico            16/32/48px。ブラウザのタブと Google の検索結果が使う
  apple-touch-icon.png   180px。iPhone の「ホーム画面に追加」
  assets/icon-192.png    192px。Android など

図柄: ヘッダーと同じ青（#1a5f9e）の角丸に、白の「RT」。
文字は macOS の Helvetica Neue Bold を使う。別の環境で作り直すときは FONT_CANDIDATES に足す。
生成物はコミットする（CI では作らない）。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
BLUE = (26, 95, 158, 255)   # --main
WHITE = (255, 255, 255, 255)
BASE = 1024                 # 大きく描いてから縮小する（輪郭をなめらかにするため）

FONT_CANDIDATES = [
    ("/System/Library/Fonts/HelveticaNeue.ttc", 1),        # Bold
    ("/System/Library/Fonts/Helvetica.ttc", 1),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 0),
]


def load_font(size):
    for path, index in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size, index=index)
    raise SystemExit("太字のフォントが見つかりません。FONT_CANDIDATES に追加してください。")


def draw(rounded=True):
    img = Image.new("RGBA", (BASE, BASE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, BASE - 1, BASE - 1], radius=int(BASE * 0.2), fill=BLUE)
    else:
        d.rectangle([0, 0, BASE, BASE], fill=BLUE)  # iOS は自分で角を丸めるので、塗りつぶしの正方形にする
    font = load_font(int(BASE * 0.56))
    box = d.textbbox((0, 0), "RT", font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((BASE - w) / 2 - box[0], (BASE - h) / 2 - box[1]), "RT", font=font, fill=WHITE)
    return img


def main():
    rounded = draw(True)
    rounded.resize((256, 256), Image.LANCZOS).save(
        ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    rounded.resize((192, 192), Image.LANCZOS).save(ROOT / "assets" / "icon-192.png", optimize=True)
    draw(False).resize((180, 180), Image.LANCZOS).convert("RGB").save(
        ROOT / "apple-touch-icon.png", optimize=True)
    for f in ("favicon.ico", "assets/icon-192.png", "apple-touch-icon.png"):
        print(f, (ROOT / f).stat().st_size, "bytes")


if __name__ == "__main__":
    main()
