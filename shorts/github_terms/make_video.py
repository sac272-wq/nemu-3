#!/usr/bin/env python3
"""GitHub用語解説ショート動画（60秒 / 1080x1920 / 30fps）を生成する。

必要なもの: ffmpeg, open_jtalk(+naist-jdic, nitech htsvoice), Noto Sans CJK, Pillow, numpy
使い方: python3 make_video.py  -> out/github_terms_short.mp4
"""
import math
import os
import subprocess
import tempfile
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "out")
OUT_MP4 = os.path.join(OUT_DIR, "github_terms_short.mp4")

W, H, FPS = 1080, 1920, 30
TOTAL = 60.0
SR = 48000

DIC = "/var/lib/mecab/dic/open-jtalk/naist-jdic"
VOICE = "/usr/share/hts-voice/nitech-jp-atr503-m001/nitech_jp_atr503_m001.htsvoice"
FONT_B = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
FONT_R = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

# 色（GitHub ダーク風）
BG = (13, 17, 23)
PANEL = (22, 27, 34)
BORDER = (48, 54, 61)
TEXT = (230, 237, 243)
MUTED = (139, 148, 158)
GREEN = (63, 185, 80)
PURPLE = (163, 113, 247)
BLUE = (88, 166, 255)
ORANGE = (240, 136, 62)
YELLOW = (255, 225, 77)

# ---------------------------------------------------------------- 台本
# 各行: (読み上げ用テキスト, 画面字幕, テロップ or None)
# テロップはその行の読み上げ開始と同時にポップ表示する
SCENES = [
    dict(key="hook", title=None, lines=[
        ("プルリク出しといて、って言われて", "「プルリク出しといて」って言われて", "プルリクって何！？"),
        ("固まったこと、ない？", "固まったこと、ない？", None),
    ]),
    dict(key="intro", title=None, lines=[
        ("ギットハブ用語を、", "GitHub用語を", None),
        ("60秒で、5つ覚えよう！", "60秒で5つ覚えよう！", "60秒で5つ！"),
    ]),
    dict(key="repo", title=("リポジトリ", "Repository", 1), lines=[
        ("リポジトリは、", "リポジトリは、", None),
        ("プロジェクトの保管庫。", "プロジェクトの保管庫。", "保管庫"),
        ("コードと変更の歴史が、まるごと入っています。", "コードと変更の歴史が まるごと入ってる", None),
    ]),
    dict(key="commit", title=("コミット", "Commit", 2), lines=[
        ("コミットは、", "コミットは、", None),
        ("変更のセーブポイント。", "変更のセーブポイント。", "セーブポイント"),
        ("いつ、誰が、何を変えたか残ります。", "いつ・誰が・何を変えたか 記録が残る", None),
    ]),
    dict(key="branch", title=("ブランチ", "Branch", 3), lines=[
        ("ブランチは、", "ブランチは、", None),
        ("本流から枝分かれした、作業場所。", "本流から枝分かれした作業場所。", "枝分かれ"),
        ("本番を壊さずに、試せます。", "本番を壊さずに試せる", None),
    ]),
    dict(key="pr", title=("プルリクエスト", "Pull Request", 4), lines=[
        ("プルリクエストは、", "プルリクエストは、", None),
        ("この変更を、取り込んでください、というお願い。", "「この変更を取り込んでください」 というお願い", "取り込んで！"),
        ("みんなにレビューしてもらいます。", "みんなにレビューしてもらう", None),
    ]),
    dict(key="merge", title=("マージ", "Merge", 5), lines=[
        ("マージは、", "マージは、", None),
        ("枝の変更を、本流に合体させること。", "枝の変更を本流に合体させること。", "合体！"),
        ("承認されたら、マージで完了。", "承認されたら マージで完了", None),
    ]),
    dict(key="summary", title=None, lines=[
        ("保管庫、セーブ、枝分かれ、お願い、合体。", "保管庫・セーブ・枝分かれ・お願い・合体", None),
        ("これでもう、プルリクも怖くない！", "これでもう プルリクも怖くない！", "もう怖くない！"),
        ("保存して、見返してね。", "保存して見返してね", "保存してね"),
    ]),
]

# 効果音: (シーンkey, 行index, 種類)  ※行の読み上げ開始時刻に鳴らす
SFX = [("hook", 0, "impact"), ("merge", 1, "ding"), ("summary", 1, "pop")]

GAP_LINE = 0.10   # 行間の無音
GAP_SCENE = 0.30  # シーン間の無音
LEAD_IN = 0.15    # 冒頭の無音


# ---------------------------------------------------------------- 音声
def tts(text, path, rate):
    subprocess.run(["open_jtalk", "-x", DIC, "-m", VOICE, "-r", f"{rate:.3f}",
                    "-ow", path], input=text.encode("utf-8"), check=True)
    with wave.open(path) as w:
        assert w.getframerate() == SR and w.getnchannels() == 1
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return data.astype(np.float32) / 32768.0


def synth_all(tmp, rate):
    clips = []
    for si, sc in enumerate(SCENES):
        for li, ln in enumerate(sc["lines"]):
            clips.append(tts(ln[0], os.path.join(tmp, f"s{si}_{li}.wav"), rate))
    return clips


def layout(clips):
    """各行の開始・終了時刻を決める。"""
    t = LEAD_IN
    timeline, k = [], 0
    for si, sc in enumerate(SCENES):
        if si > 0:
            t += GAP_SCENE - GAP_LINE
        for li, _ in enumerate(sc["lines"]):
            d = len(clips[k]) / SR
            timeline.append(dict(scene=si, line=li, start=t, end=t + d, clip=k))
            t += d + GAP_LINE
            k += 1
    return timeline, t


def sfx(kind):
    def env(n, tau):
        return np.exp(-np.arange(n) / (tau * SR))
    if kind == "impact":
        n = int(0.6 * SR)
        tt = np.arange(n) / SR
        freq = 90 * np.exp(-tt * 4) + 40
        tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) * env(n, 0.18)
        noise = np.random.default_rng(1).normal(0, 1, n) * env(n, 0.03) * 0.5
        return (tone + noise) * 0.55
    if kind == "ding":
        n = int(1.0 * SR)
        tt = np.arange(n) / SR
        s = (np.sin(2 * np.pi * 1318.5 * tt) + 0.6 * np.sin(2 * np.pi * 1975.5 * tt)
             + 0.3 * np.sin(2 * np.pi * 2637 * tt))
        return s * env(n, 0.25) * 0.22
    if kind == "pop":
        n = int(0.15 * SR)
        tt = np.arange(n) / SR
        freq = 350 + 1400 * (tt / tt[-1])
        return np.sin(2 * np.pi * np.cumsum(freq) / SR) * env(n, 0.04) * 0.45
    raise ValueError(kind)


def build_audio(clips, timeline, path):
    mix = np.zeros(int(TOTAL * SR) + SR, dtype=np.float32)
    for ev in timeline:
        a = int(ev["start"] * SR)
        c = clips[ev["clip"]] * 0.9
        mix[a:a + len(c)] += c
    for key, li, kind in SFX:
        si = next(i for i, s in enumerate(SCENES) if s["key"] == key)
        ev = next(e for e in timeline if e["scene"] == si and e["line"] == li)
        s = sfx(kind)
        a = int(ev["start"] * SR)
        mix[a:a + len(s)] += s
    mix = mix[:int(TOTAL * SR)]
    peak = np.max(np.abs(mix))
    if peak > 0.98:
        mix *= 0.98 / peak
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((mix * 32767).astype(np.int16).tobytes())


# ---------------------------------------------------------------- 描画ヘルパ
_fonts = {}


def font(size, bold=True):
    k = (size, bold)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(FONT_B if bold else FONT_R, size, index=0)
    return _fonts[k]


def ease_out(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3


def ctext(d, xy, text, size, fill=TEXT, bold=True, stroke=0, stroke_fill=(0, 0, 0)):
    d.text(xy, text, font=font(size, bold), fill=fill, anchor="mm",
           stroke_width=stroke, stroke_fill=stroke_fill, align="center")


def node(d, x, y, r, color, ring=TEXT):
    d.ellipse([x - r, y - r, x + r, y + r], fill=color, outline=ring, width=5)


def draw_check(d, x, y, s, color, w=12):
    d.line([(x - s, y), (x - s * 0.3, y + s * 0.7), (x + s, y - s * 0.8)],
           fill=color, width=w, joint="curve")


def lerp(a, b, p):
    return a + (b - a) * p


def bezier(p0, p1, p2, p3, n=40, upto=1.0):
    pts = []
    for i in range(n + 1):
        t = i / n * upto
        x = ((1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0]
             + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0])
        y = ((1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1]
             + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1])
        pts.append((x, y))
    return pts


def base_frame(title):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    for x in range(0, W, 60):
        d.line([(x, 0), (x, H)], fill=(18, 23, 30), width=1)
    for y in range(0, H, 60):
        d.line([(0, y), (W, y)], fill=(18, 23, 30), width=1)
    # ヘッダーチップ
    d.rounded_rectangle([300, 120, 780, 210], radius=45, fill=PANEL, outline=BLUE, width=4)
    ctext(d, (540, 163), "GitHub用語解説", 48, BLUE)
    if title:
        name, en, num = title
        ctext(d, (540, 300), f"{num} / 5", 44, MUTED)
        ctext(d, (540, 420), name, 130 if len(name) <= 5 else 104, TEXT)
        ctext(d, (540, 540), en, 52, MUTED, bold=False)
    return img


# ---------------------------------------------------------------- 図解（シーンごと）
DY = 640  # 図解エリアの上端


def diag_hook(d, t):
    # 吹き出し
    p = ease_out(t / 0.35)
    bx0, by0, bx1, by1 = 110, 330, 970, 560
    off = int((1 - p) * 60)
    d.rounded_rectangle([bx0, by0 + off, bx1, by1 + off], radius=40, fill=PANEL, outline=BORDER, width=5)
    d.polygon([(700, by1 + off), (780, by1 + off), (640, by1 + 110 + off)], fill=PANEL)
    d.line([(700, by1 + off - 2), (640, by1 + 110 + off)], fill=BORDER, width=5)
    d.line([(780, by1 + off - 2), (640, by1 + 110 + off)], fill=BORDER, width=5)
    ctext(d, (540, 410 + off), "先輩", 40, MUTED)
    ctext(d, (540, 480 + off), "プルリク出しといて！", 62, TEXT)
    # 人物（固まってる）
    cx, cy = 540, 980
    shake = int(6 * math.sin(t * 40)) if t > 2.0 else 0
    cx += shake
    d.ellipse([cx - 110, cy - 330, cx + 110, cy - 110], fill=(55, 62, 71))
    d.rounded_rectangle([cx - 190, cy - 80, cx + 190, cy + 220], radius=90, fill=(55, 62, 71))
    d.ellipse([cx - 55, cy - 250, cx - 25, cy - 215], fill=TEXT)
    d.ellipse([cx + 25, cy - 250, cx + 55, cy - 215], fill=TEXT)
    d.line([(cx - 40, cy - 160), (cx + 40, cy - 160)], fill=TEXT, width=8)
    # 汗
    for i, (sx, sy) in enumerate([(cx + 150, cy - 300), (cx + 190, cy - 220)]):
        if t > 0.6 + i * 0.3:
            d.ellipse([sx - 16, sy - 10, sx + 16, sy + 30], fill=BLUE)
            d.polygon([(sx - 14, sy + 4), (sx + 14, sy + 4), (sx, sy - 28)], fill=BLUE)
    # ？マーク
    if t > 0.3:
        q = ease_out((t - 0.3) / 0.3)
        ctext(d, (cx - 250, cy - 330), "?", int(150 * q) + 1, YELLOW, stroke=6)
        ctext(d, (cx + 280, cy - 250), "?", int(110 * q) + 1, ORANGE, stroke=6)


TERMS = [("リポジトリ", BLUE), ("コミット", GREEN), ("ブランチ", PURPLE),
         ("プルリクエスト", ORANGE), ("マージ", YELLOW)]


def diag_intro(d, t):
    for i, (name, col) in enumerate(TERMS):
        p = ease_out((t - 0.25 * i) / 0.35)
        if p <= 0:
            continue
        y = 360 + i * 150
        x = int(lerp(-500, 0, p))
        d.rounded_rectangle([170 + x, y, 910 + x, y + 120], radius=30, fill=PANEL, outline=col, width=5)
        d.ellipse([205 + x, y + 35, 255 + x, y + 85], fill=col)
        d.text((290 + x, y + 60), name, font=font(60), fill=TEXT, anchor="lm")


def diag_repo(d, t):
    p = ease_out(t / 0.5)
    x0, y0, x1, y1 = 190, DY + 80, 890, DY + 560
    yo = int((1 - p) * 80)
    d.rounded_rectangle([x0, y0 - 60 + yo, x0 + 280, y0 + 20 + yo], radius=24, fill=(31, 111, 235))
    d.rounded_rectangle([x0, y0 + yo, x1, y1 + yo], radius=30, fill=(31, 111, 235))
    d.rounded_rectangle([x0 + 20, y0 + 30 + yo, x1 - 20, y1 - 20 + yo], radius=24, fill=PANEL)
    d.text((x0 + 50, y0 + 75 + yo), "my-project/", font=font(44), fill=BLUE, anchor="lm")
    files = [("index.html", BLUE), ("app.js", YELLOW), ("style.css", PURPLE)]
    for i, (fname, col) in enumerate(files):
        q = ease_out((t - 0.4 - 0.25 * i) / 0.3)
        if q <= 0:
            continue
        fy = y0 + 140 + i * 95 + yo
        fx = x0 + 60 + int((1 - q) * 40)
        d.rounded_rectangle([fx, fy, fx + 46, fy + 60], radius=8, outline=col, width=5)
        d.text((fx + 75, fy + 30), fname, font=font(44, False), fill=TEXT, anchor="lm")
    if t > 1.6:
        q = ease_out((t - 1.6) / 0.4)
        cx, cy = x1 - 120, y0 + 330 + yo
        r = int(70 * q) + 1
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=GREEN, width=8)
        d.line([(cx, cy), (cx, cy - r * 0.6)], fill=GREEN, width=8)
        d.line([(cx, cy), (cx + r * 0.45, cy + r * 0.2)], fill=GREEN, width=8)
        ctext(d, (cx, cy + 115), "履歴", 40, GREEN)


def diag_commit(d, t):
    y = DY + 260
    xs = [170, 400, 630, 860]
    labels = ["最初", "画面追加", "バグ修正", "デザイン"]
    n_vis = 1 + int(max(0, t - 0.3) / 0.7)
    n_vis = min(n_vis, len(xs))
    last = xs[n_vis - 1]
    d.line([(xs[0], y), (last, y)], fill=GREEN, width=14)
    for i in range(n_vis):
        q = ease_out((t - 0.3 - 0.7 * (i - 1)) / 0.3) if i > 0 else 1
        node(d, xs[i], y, int(46 * q) + 1, GREEN)
        ctext(d, (xs[i], y - 95), f"#{i + 1}", 40, MUTED)
        ctext(d, (xs[i], y + 95), labels[i], 38, TEXT, bold=False)
    # 記録カード
    if t > 2.2:
        q = ease_out((t - 2.2) / 0.4)
        oy = int((1 - q) * 60)
        cy = DY + 440 + oy
        d.rounded_rectangle([150, cy, 930, cy + 200], radius=26, fill=PANEL, outline=BORDER, width=4)
        rows = [("いつ", "11/14 10:32"), ("誰が", "@tanaka"), ("何を", "バグ修正")]
        for i, (k, v) in enumerate(rows):
            d.text((200, cy + 45 + i * 55), k, font=font(38), fill=GREEN, anchor="lm")
            d.text((360, cy + 45 + i * 55), v, font=font(38, False), fill=TEXT, anchor="lm")


def diag_branch(d, t):
    ym, yb = DY + 430, DY + 170
    p = ease_out(t / 0.6)
    d.line([(110, ym), (110 + 860 * p, ym)], fill=GREEN, width=14)
    for i, x in enumerate([180, 380, 760, 940]):
        if 110 + 860 * p >= x:
            node(d, x, ym, 34, GREEN)
    d.text((110, ym + 80), "main（本番）", font=font(42), fill=GREEN, anchor="lm")
    if t > 0.5:
        q = ease_out((t - 0.5) / 0.9)
        pts = bezier((380, ym), (480, ym), (460, yb), (580, yb), upto=min(1, q * 1.6))
        d.line(pts, fill=PURPLE, width=14, joint="curve")
        if q > 0.6:
            q2 = (q - 0.6) / 0.4
            d.line([(580, yb), (580 + 340 * q2, yb)], fill=PURPLE, width=14)
            for x in (640, 840):
                if 580 + 340 * q2 >= x:
                    node(d, x, yb, 34, PURPLE)
            d.text((560, yb - 85), "feature（作業用）", font=font(42), fill=PURPLE, anchor="lm")
        node(d, 380, ym, 34, GREEN)
    if t > 2.6:
        q = ease_out((t - 2.6) / 0.4)
        ctext(d, (760, ym - 110 + int((1 - q) * 30)), "本番は無事", 40, GREEN)
        draw_check(d, 900, ym - 110, 22, GREEN, 9)


def diag_pr(d, t):
    y = DY + 130
    p = ease_out(t / 0.5)
    d.rounded_rectangle([90, y - 80, 410, y + 80], radius=28, fill=PANEL, outline=PURPLE, width=6)
    ctext(d, (250, y), "feature", 52, PURPLE)
    d.rounded_rectangle([670, y - 80, 990, y + 80], radius=28, fill=PANEL, outline=GREEN, width=6)
    ctext(d, (830, y), "main", 52, GREEN)
    ax = lerp(430, 650, p)
    d.line([(430, y), (ax, y)], fill=ORANGE, width=14)
    d.polygon([(ax, y - 30), (ax + 30, y), (ax, y + 30)], fill=ORANGE)
    ctext(d, (540, y - 70), "お願い", 38, ORANGE)
    # レビューコメント
    for i, (who, msg) in enumerate([("@sato", "いいね！"), ("@kim", "ここ直そう")]):
        q = ease_out((t - 1.6 - 0.6 * i) / 0.35)
        if q <= 0:
            continue
        cy = y + 150 + i * 140 + int((1 - q) * 40)
        d.rounded_rectangle([170, cy, 910, cy + 120], radius=24, fill=PANEL, outline=BORDER, width=4)
        d.ellipse([200, cy + 30, 260, cy + 90], fill=(55, 62, 71))
        d.text((290, cy + 60), f"{who}  {msg}", font=font(44, False), fill=TEXT, anchor="lm")
        if i == 0:
            draw_check(d, 860, cy + 60, 22, GREEN, 9)


def diag_merge(d, t):
    ym, yb = DY + 440, DY + 170
    d.line([(100, ym), (980, ym)], fill=GREEN, width=14)
    for x in (160, 330):
        node(d, x, ym, 34, GREEN)
    d.text((100, ym + 80), "main", font=font(42), fill=GREEN, anchor="lm")
    d.line(bezier((330, ym), (410, ym), (400, yb), (480, yb)), fill=PURPLE, width=14, joint="curve")
    d.line([(480, yb), (640, yb)], fill=PURPLE, width=14)
    for x in (520, 620):
        node(d, x, yb, 34, PURPLE)
    node(d, 330, ym, 34, GREEN)
    d.text((470, yb - 85), "feature", font=font(42), fill=PURPLE, anchor="lm")
    # 合流アニメ（合体テロップのタイミング=約1秒後）
    q = ease_out((t - 1.4) / 0.6)
    if q > 0:
        pts = bezier((640, yb), (730, yb), (720, ym), (800, ym), upto=q)
        d.line(pts, fill=PURPLE, width=14, joint="curve")
    if q >= 1:
        glow = 60 + 14 * math.sin(t * 8)
        d.ellipse([800 - glow, ym - glow, 800 + glow, ym + glow], outline=YELLOW, width=6)
        node(d, 800, ym, 44, YELLOW)
    if t > 5.0:
        q2 = ease_out((t - 5.0) / 0.3)
        ctext(d, (800, ym + 110), "完了", int(46 * q2) + 1, YELLOW)


SUMMARY = [("リポジトリ", "保管庫", BLUE), ("コミット", "セーブ", GREEN),
           ("ブランチ", "枝分かれ", PURPLE), ("プルリク", "お願い", ORANGE), ("マージ", "合体", YELLOW)]


def diag_summary(d, t):
    ctext(d, (540, 360), "まとめ", 96, TEXT)
    for i, (term, kw, col) in enumerate(SUMMARY):
        q = ease_out((t - 0.5 * i) / 0.35)
        if q <= 0:
            continue
        y = 490 + i * 125
        x = int((1 - q) * 300)
        d.rounded_rectangle([120 + x, y, 960 + x, y + 105], radius=26, fill=PANEL, outline=col, width=5)
        d.text((165 + x, y + 52), term, font=font(52), fill=TEXT, anchor="lm")
        d.text((560 + x, y + 52), "→", font=font(52), fill=MUTED, anchor="mm")
        d.text((630 + x, y + 52), kw, font=font(56), fill=col, anchor="lm")


DIAGRAMS = dict(hook=diag_hook, intro=diag_intro, repo=diag_repo, commit=diag_commit,
                branch=diag_branch, pr=diag_pr, merge=diag_merge, summary=diag_summary)


# ---------------------------------------------------------------- テロップ（縁取りポップ）
def make_telop(text):
    pad = 60
    tmp = Image.new("RGBA", (10, 10))
    size = 160
    while True:
        f = font(size)
        bbox = ImageDraw.Draw(tmp).multiline_textbbox((0, 0), text, font=f, stroke_width=22,
                                                      align="center", spacing=10)
        if bbox[2] - bbox[0] <= 1000 or size <= 60:
            break
        size -= 6
    w, h = int(bbox[2] - bbox[0] + pad * 2), int(bbox[3] - bbox[1] + pad * 2)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    org = (pad - bbox[0], pad - bbox[1])
    # 外側の白フチ → 黒フチ → 黄色文字（二重縁取り）
    d.multiline_text((org[0] + 8, org[1] + 10), text, font=f, fill=(0, 0, 0, 160),
                     stroke_width=24, stroke_fill=(0, 0, 0, 160), align="center", spacing=10)
    d.multiline_text(org, text, font=f, fill=TEXT, stroke_width=24, stroke_fill=(255, 255, 255),
                     align="center", spacing=10)
    d.multiline_text(org, text, font=f, fill=YELLOW, stroke_width=14, stroke_fill=(20, 20, 20),
                     align="center", spacing=10)
    return img


def pop_scale(dt):
    """0→1.25→0.95→1.0 のポップ"""
    if dt < 0.12:
        return lerp(0.2, 1.25, dt / 0.12)
    if dt < 0.22:
        return lerp(1.25, 0.95, (dt - 0.12) / 0.10)
    if dt < 0.30:
        return lerp(0.95, 1.0, (dt - 0.22) / 0.08)
    return 1.0


# ---------------------------------------------------------------- 字幕
def wrap(text, n=17):
    lines, cur = [], ""
    for part in text.split(" "):
        cand = (cur + " " + part).strip() if cur else part
        if len(cand) <= n:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            while len(part) > n:
                lines.append(part[:n])
                part = part[n:]
            cur = part
    if cur:
        lines.append(cur)
    return "\n".join(lines)


# ---------------------------------------------------------------- メイン
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        # 尺合わせ: 読み上げ速度を調整して約58.5秒に収める
        rate = 1.0
        for _ in range(4):
            clips = synth_all(tmp, rate)
            timeline, end = layout(clips)
            if 57.8 <= end <= 59.2:
                break
            speech = sum(len(c) for c in clips) / SR
            fixed = end - speech
            rate *= speech / (58.5 - fixed)
        print(f"speech rate={rate:.3f}  narration end={end:.2f}s")
        assert end <= TOTAL, "ナレーションが60秒を超えています"

        wav = os.path.join(tmp, "mix.wav")
        build_audio(clips, timeline, wav)

        # シーン区間
        scene_start = {}
        for ev in timeline:
            scene_start.setdefault(ev["scene"], ev["start"] - (LEAD_IN if ev["scene"] == 0 else 0.15))
        scene_start[0] = 0.0
        bounds = [scene_start[i] for i in range(len(SCENES))] + [TOTAL]

        bases = [base_frame(sc["title"]) for sc in SCENES]
        telops = {}
        for ev in timeline:
            tl = SCENES[ev["scene"]]["lines"][ev["line"]][2]
            if tl:
                telops[(ev["scene"], ev["line"])] = make_telop(tl)

        cmd = ["ffmpeg", "-y", "-loglevel", "error",
               "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
               "-i", wav,
               "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
               "-t", f"{TOTAL}", "-movflags", "+faststart", OUT_MP4]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)

        n_frames = int(TOTAL * FPS)
        for fi in range(n_frames):
            t = fi / FPS
            si = max(i for i in range(len(SCENES)) if bounds[i] <= t)
            st = t - bounds[si]
            img = bases[si].copy()
            d = ImageDraw.Draw(img)
            DIAGRAMS[SCENES[si]["key"]](d, st)

            # 現在の行（字幕）と、そのシーンで最後に出たテロップ
            cur = [e for e in timeline if e["scene"] == si and e["start"] <= t]
            if cur:
                ev = cur[-1]
                sub = SCENES[si]["lines"][ev["line"]][1]
                ctext(d, (540, 1660), wrap(sub), 54, TEXT, stroke=8, stroke_fill=(0, 0, 0))
                tl_ev = [e for e in cur if (si, e["line"]) in telops]
                if tl_ev:
                    te = tl_ev[-1]
                    timg = telops[(si, te["line"])]
                    s = pop_scale(t - te["start"])
                    tw, th = int(timg.width * s), int(timg.height * s)
                    if tw > 4 and th > 4:
                        r = timg.resize((tw, th), Image.LANCZOS)
                        img.paste(r, (540 - tw // 2, 1360 - th // 2), r)

            # シーン頭の短いフェードイン
            if si > 0 and st < 0.12:
                img = Image.blend(Image.new("RGB", (W, H), BG), img, st / 0.12)
            proc.stdin.write(img.tobytes())
        proc.stdin.close()
        proc.wait()
        if proc.returncode != 0:
            raise SystemExit("ffmpeg failed")

        print("--- timeline ---")
        for ev in timeline:
            ln = SCENES[ev["scene"]]["lines"][ev["line"]]
            print(f"{ev['start']:6.2f}-{ev['end']:6.2f}  [{SCENES[ev['scene']]['key']}] {ln[1]}"
                  + (f"   <テロップ: {ln[2]!r}>" if ln[2] else ""))
    print("wrote", OUT_MP4)


if __name__ == "__main__":
    main()
