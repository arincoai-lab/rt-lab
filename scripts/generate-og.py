#!/usr/bin/env python3
"""OGP画像（1200x630 PNG）を生成する。

使い方: python3 scripts/generate-og.py [--only <slug>|default]

記事は blog/index.html の .blog-card から自動抽出するので、記事を追加したら
再実行するだけで新しい画像が増える。出力先は assets/og/。

依存: /Applications/Google Chrome.app（headless でHTMLをスクリーンショット）
"""
import argparse
import html
import io
import os
import re
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "assets", "og")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
W, H = 1200, 630

FONT_STACK = ("'Noto Sans JP','Hiragino Sans','Hiragino Kaku Gothic ProN',"
              "'Yu Gothic',sans-serif")

BASE_CSS = """
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:%(W)dpx;height:%(H)dpx;overflow:hidden}
  body{
    font-family:%(FONT)s;
    background:linear-gradient(135deg,#1a5f9e 0%%,#2980b9 100%%);
    color:#fff; display:flex; flex-direction:column;
    padding:64px 72px; position:relative;
  }
  body::after{
    content:''; position:absolute; right:-140px; bottom:-190px;
    width:520px; height:520px; border-radius:50%%;
    background:rgba(255,255,255,.07);
  }
  .brand{display:flex; align-items:baseline; gap:16px; position:relative; z-index:1}
  .brand-name{font-size:38px; font-weight:300; letter-spacing:.06em}
  .brand-sub{font-size:17px; font-weight:400; opacity:.85}
  .foot{margin-top:auto; display:flex; align-items:center; gap:18px;
        font-size:20px; opacity:.9; position:relative; z-index:1}
  .pill{background:rgba(255,255,255,.18); border-radius:999px;
        padding:7px 22px; font-size:19px; font-weight:500}
""" % {"W": W, "H": H, "FONT": FONT_STACK}

ARTICLE_TPL = """<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<style>%(css)s
  .mid{flex:1; display:flex; align-items:center; position:relative; z-index:1}
  .title{font-weight:700; line-height:1.42; font-size:%(size)dpx;
         display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical;
         overflow:hidden}
</style></head><body>
  <div class="brand"><span class="brand-name">RT-Lab</span>
    <span class="brand-sub">放射線技師のためのWebツール</span></div>
  <div class="mid"><h1 class="title">%(title)s</h1></div>
  <div class="foot"><span class="pill">%(tag)s</span><span>rt-ai-lab.com/blog/</span></div>
</body></html>"""

DEFAULT_TPL = """<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<style>%(css)s
  body{justify-content:center}
  .brand{margin-bottom:26px}
  .lead{font-size:60px; font-weight:700; line-height:1.4; position:relative; z-index:1}
  .sub{margin-top:24px; font-size:26px; line-height:1.7; opacity:.9;
       position:relative; z-index:1}
  .foot{margin-top:44px}
</style></head><body>
  <div class="brand"><span class="brand-name">RT-Lab</span></div>
  <div class="lead">放射線技師の業務を、<br>ブラウザひとつで。</div>
  <div class="sub">CT線量評価・画質指標・造影剤計算などの無料Webツール集</div>
  <div class="foot"><span class="pill">インストール不要・広告なし</span>
    <span>rt-ai-lab.com</span></div>
</body></html>"""


def title_size(text):
    n = len(text)
    if n <= 26:
        return 62
    if n <= 34:
        return 55
    if n <= 44:
        return 48
    if n <= 56:
        return 42
    return 37


def parse_articles():
    """blog/index.html の .blog-card から (slug, tag, title) を取り出す。"""
    path = os.path.join(ROOT, "blog", "index.html")
    src = io.open(path, encoding="utf-8").read()
    cards = re.findall(r'<article class="blog-card">(.*?)</article>', src, re.S)
    out = []
    for c in cards:
        tag = re.search(r'<span class="blog-card-tag">([^<]+)</span>', c)
        link = re.search(r'<h2><a href="/blog/([^/]+)/">(.*?)</a></h2>', c, re.S)
        if not (tag and link):
            sys.exit("blog/index.html のカード書式が想定と違う: %r" % c[:120])
        title = re.sub(r"\s+", " ", link.group(2)).strip()
        out.append((link.group(1), tag.group(1).strip(), title))
    if not out:
        sys.exit("blog/index.html から記事カードを1件も抽出できなかった")
    return out


def shoot(doc, dest):
    fd, tmp = tempfile.mkstemp(suffix=".html")
    os.write(fd, doc.encode("utf-8"))
    os.close(fd)
    profile = tempfile.mkdtemp(prefix="og-chrome-")
    # 前回の出力が残っていると「生成完了」と誤判定するので先に消す
    if os.path.exists(dest):
        os.unlink(dest)
    cmd = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
           "--force-device-scale-factor=1", "--virtual-time-budget=4000",
           "--no-first-run", "--no-default-browser-check",
           "--window-size=%d,%d" % (W, H), "--screenshot=%s" % dest,
           "--user-data-dir=%s" % profile, "file://%s" % tmp]
    # Chrome headless はスクショ書き出し後も終了しないことがあるので待って落とす
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + 45
    while time.time() < deadline:
        if os.path.exists(dest) and os.path.getsize(dest) > 0:
            time.sleep(0.6)
            break
        if proc.poll() is not None:
            break
        time.sleep(0.4)
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
    os.unlink(tmp)
    if not (os.path.exists(dest) and os.path.getsize(dest) > 0):
        sys.exit("生成失敗: %s" % dest)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="default か記事slugを指定して1枚だけ生成")
    args = ap.parse_args()

    if not os.path.exists(CHROME):
        sys.exit("Google Chrome が見つからない: %s" % CHROME)
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)

    jobs = []
    if args.only in (None, "default"):
        jobs.append(("og-default.png", DEFAULT_TPL % {"css": BASE_CSS}))
    for slug, tag, title in parse_articles():
        if args.only not in (None, slug):
            continue
        jobs.append(("%s.png" % slug, ARTICLE_TPL % {
            "css": BASE_CSS, "title": html.escape(title),
            "tag": html.escape(tag), "size": title_size(title)}))

    if not jobs:
        sys.exit("--only %r に一致する対象がない" % args.only)

    for name, doc in jobs:
        dest = os.path.join(OUT_DIR, name)
        shoot(doc, dest)
        print("generated: assets/og/%s (%d bytes)" % (name, os.path.getsize(dest)))


if __name__ == "__main__":
    main()
