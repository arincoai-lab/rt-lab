#!/usr/bin/env python3
"""おきばメモ（okiba/）のアプリアイコンを生成する。

使い方: python3 scripts/generate-okiba-icons.py

出力（okiba/icons/）:
  icon-192.png / icon-512.png   … 角丸・背景透過（purpose: any）
  icon-maskable-512.png         … 全面塗り・図柄は中央80%の安全領域内（purpose: maskable）
  apple-touch-icon.png (180)    … 全面塗り（iOS が角を丸める。透過は黒くなるため使わない）

依存: Pillow。フォントは使わない（図形だけで描くので環境によって見た目が変わらない）。
"""
import math
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "okiba", "icons")
TEAL = (15, 118, 110, 255)
TEAL_DARK = (11, 90, 84, 255)
WHITE = (255, 255, 255, 255)
SS = 4  # 4倍で描いて縮小（アンチエイリアス）


def draw_glyph(d, cx, cy, scale):
    """場所のピン＋中の箱。scale はピンの円の半径"""
    r = scale
    tip_y = cy + 1.95 * r
    # ピン: 円と、円の接線から先端への三角形
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    a = math.acos(r / (tip_y - cy))
    pts = [(cx - r * math.sin(a), cy + r * math.cos(a)), (cx, tip_y), (cx + r * math.sin(a), cy + r * math.cos(a))]
    d.polygon(pts, fill=WHITE)
    # 中の箱（ものの置き場所）
    b = 0.46 * r
    d.rounded_rectangle([cx - b, cy - b * 0.85, cx + b, cy + b * 0.95], radius=b * 0.18, fill=TEAL)
    d.line([cx - b, cy - b * 0.25, cx + b, cy - b * 0.25], fill=WHITE, width=max(1, int(b * 0.16)))


def make(size, rounded, glyph_ratio):
    S = size * SS
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=TEAL)
    else:
        d.rectangle([0, 0, S, S], fill=TEAL)
    # 床の影（置き場所の台）
    r = S * glyph_ratio / 2.95
    cy = S * 0.5 - r * 0.48
    shadow_w = r * 1.15
    sy = cy + 1.95 * r
    d.ellipse([S / 2 - shadow_w, sy - r * 0.16, S / 2 + shadow_w, sy + r * 0.16], fill=TEAL_DARK)
    draw_glyph(d, S / 2, cy, r)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    outputs = {
        "icon-192.png": make(192, True, 0.62),
        "icon-512.png": make(512, True, 0.62),
        "icon-maskable-512.png": make(512, False, 0.50),
        "apple-touch-icon.png": make(180, False, 0.58).convert("RGB"),
    }
    for name, img in outputs.items():
        path = os.path.join(OUT, name)
        img.save(path, optimize=True)
        print(path, img.size)


if __name__ == "__main__":
    main()
