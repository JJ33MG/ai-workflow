"""Pilot episode 1 (new): Age 21, moving out. Warm, a bit funny, and an ending that lands."""
import math, subprocess, wave, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/tmp/claude-0/yt/cartoon")
import ep1
from ep1 import (W, H, S, FPS, BG, INK, GREY, GROUND, STAND, font, P, line, circle, rect, text, figure, bubble, caption, ground, ease, tone, noise)

DIR = "/tmp/claude-0/yt/cartoon"
WHITE = (255, 255, 255)

def header(d):
    text(d, (W / 2, 210), "EPISODE 1", font("Bold", 34), fill=GREY, world=False)
    text(d, (W / 2, 290), "Age 21", font("Black", 92), world=False)

def dad(d, hip, pose=None, face="neutral", flip=1, lean=0):
    f = figure(d, hip, pose, face=face, flip=flip, lean=lean)
    hx, hy = f["head"]
    ex = hx + 8 * flip
    line(d, (ex - 17, hy + 7), (ex + 17, hy + 7), w=8)  # moustache
    d.arc([P(hx - 44, hy - 44), P(hx + 44, hy + 44)], 200, 340, fill=INK, width=int(14 * S * ep1.Z))  # short hair
    return f

def mom(d, hip, pose=None, face="smile", flip=1):
    f = figure(d, hip, pose, face=face, flip=flip)
    hx, hy = f["head"]
    circle(d, (hx - 34 * flip, hy - 34), 18, w=6, fill=INK)  # bun
    return f

def box(d, x, y, w=150, h=110, label=None):
    rect(d, (x, y - h), (x + w, y), w=7, fill=BG)
    line(d, (x, y - h + 20), (x + w, y - h + 20), w=4)
    if label: text(d, (x + w / 2, y - h / 2 + 10), label, font("Bold", 26))

def kid_drawing(d, cx, cy, scale=1.0):
    w, h = 300 * scale, 230 * scale
    rect(d, (cx - w / 2, cy - h / 2), (cx + w / 2, cy + h / 2), w=5, fill=WHITE, radius=6)
    for (x, s) in ((-55, 1.0), (40, 0.6)):  # a big figure and a small one holding hands
        bx, base = cx + x * scale, cy + 70 * scale
        hh = 120 * s * scale
        line(d, (bx, base), (bx, base - hh), w=4); circle(d, (bx, base - hh - 18 * s * scale), 18 * s * scale, w=4, fill=WHITE)
        line(d, (bx, base), (bx - 14 * s * scale, base + 30 * s * scale), w=4); line(d, (bx, base), (bx + 14 * s * scale, base + 30 * s * scale), w=4)
    line(d, (cx - 55 * scale, cy - 5 * scale), (cx + 40 * scale, cy + 20 * scale), w=4)
    text(d, (cx, cy - 85 * scale), "ME + DAD", font("Bold", int(30 * scale)))

def house(d, x0=120, x1=520):
    rect(d, (x0, 900), (x1, GROUND), w=8, fill=BG)
    d.polygon([P(x0 - 30, 905), P((x0 + x1) / 2, 720), P(x1 + 30, 905)], outline=INK, fill=BG, width=int(8 * S * ep1.Z))
    rect(d, (x0 + 40, 1010), (x0 + 140, GROUND), w=7)  # door
    rect(d, (x1 - 150, 960), (x1 - 50, 1050), w=6)  # window

def car(d, x, people=False):
    d.polygon([P(x - 210, 1215), P(x - 210, 1120), P(x - 120, 1120), P(x - 70, 1050), P(x + 120, 1050), P(x + 170, 1120), P(x + 220, 1130), P(x + 220, 1215)],
              outline=INK, fill=BG, width=int(8 * S * ep1.Z))
    rect(d, (x - 60, 1065), (x + 25, 1118), w=6); rect(d, (x + 40, 1065), (x + 115, 1118), w=6)
    if people: circle(d, (x + 78, 1098), 18, w=5, fill=BG)
    for wx in (-120, 130): circle(d, (x + wx, 1218), 32, fill=BG)

def toolbox(d, cx, base, w=120, h=70):
    rect(d, (cx - w / 2, base - h), (cx + w / 2, base), w=7, fill=INK, radius=6)
    d.arc([P(cx - 30, base - h - 30), P(cx + 30, base - h + 20)], 180, 360, fill=INK, width=int(7 * S * ep1.Z))

def tear(d, x, y):
    d.polygon([P(x, y), P(x - 7, y + 16), P(x + 7, y + 16)], fill=INK)
    d.ellipse([P(x - 7, y + 10), P(x + 7, y + 24)], fill=INK)

# ---------- scenes ----------
def s_room(d, t):
    header(d); ground(d)
    rect(d, (150, 1130), (430, 1190), fill=BG, radius=12); line(d, (150, 1100), (150, GROUND)); line(d, (430, 1160), (430, GROUND))
    rect(d, (210, 820), (330, 960), w=6)  # old poster
    line(d, (240, 930), (300, 850), w=5); circle(d, (270, 880), 16, w=5)
    box(d, 600, GROUND, 160, 120); box(d, 620, GROUND - 120, 130, 100, "ROOM")
    tape = min(1, t / 1.4)
    figure(d, (500, STAND), {"ls": 80 + 15 * math.sin(t * 9), "le": 40, "rs": 70, "re": 50}, face="neutral", flip=1, lean=10)
    line(d, (630, GROUND - 220), (630 + 110 * tape, GROUND - 220), w=6)
    caption(d, "His last night in his childhood room.")

def s_drawing(d, t):
    header(d); ground(d)
    box(d, 600, GROUND, 160, 120, "OLD STUFF")
    figure(d, (330, STAND), {"ls": 115, "le": -25, "rs": 20, "re": 10}, face="o" if t < 2.2 else "neutral", lean=6)
    zoom = ease((t - 0.8) / 0.8)
    kid_drawing(d, 560 + 120 * zoom, 900 - 120 * zoom, 0.45 + 0.6 * zoom)
    caption(d, "Packing up 21 years takes longer than you think." if t < 3.3 else "Some things you don't pack.")

def s_carry(d, t):
    header(d); ground(d); house(d, 80, 420)
    car(d, 930)
    x = 400 + 230 * ease(t / 3.8)
    wob = 6 * math.sin(t * 25)
    f = dad(d, (x, STAND + 10), {"ls": 75, "le": 60, "rs": 70, "re": 65, "lh": 18 + wob, "rh": -18 - wob, "lk": -15, "rk": 15}, face="o", lean=-8)
    box(d, x + 20, STAND - 20, 170, 150, "BOOKS")
    sx = 150 + 200 * ease((t - 0.3) / 3.6)
    s = figure(d, (sx, STAND), {"ls": 60, "le": 70}, face="smile")
    lx, ly = s["l"]; line(d, (lx, ly), (lx, ly - 50), w=5); d.polygon([P(lx - 25, ly - 50), P(lx + 25, ly - 50), P(lx + 15, ly - 85), P(lx - 15, ly - 85)], outline=INK, fill=BG, width=int(5 * S * ep1.Z))
    if t > 1.6: bubble(d, (x - 60, 700), "It's not heavy.", (x - 10, 790), size=42, width=14)
    caption(d, "Dad insisted on carrying the heaviest box.")

def s_mom(d, t):
    header(d); ground(d); house(d, 80, 420)
    mom(d, (170, STAND), {"ls": 160 if t > 0.4 else 20, "le": 10}, face="smile")
    figure(d, (620, STAND), {}, face="neutral" if t < 2.6 else "smile", flip=-1)
    if t > 0.3: bubble(d, (360, 700), "Did you pack socks?", (220, 800), size=42, width=12)
    if t > 1.7: bubble(d, (790, 680), "Mom.", (660, 790), size=46)
    if t > 2.9: bubble(d, (380, 560), "WARM socks?", (230, 800), size=42, width=12)
    caption(d, "Mom had one question.")

def s_toolbox(d, t):
    header(d); ground(d); car(d, 870)
    give = ease((t - 0.6) / 1.0)
    f = dad(d, (360, STAND), {"ls": 30 + 25 * give, "le": 25, "rs": -20 if t < 3.2 else -120, "re": -10 if t < 3.2 else -50}, face="neutral", flip=1)
    figure(d, (590, STAND), {"ls": -60, "le": -20}, face="neutral" if t < 3.4 else "smile", flip=-1)
    hx, hy = f["l"]
    toolbox(d, hx + 30, hy + 10)
    if t > 1.2: bubble(d, (430, 700), "You'll need this.", (380, 800), size=44, width=14)
    caption(d, "Dad never said much." if t < 3.2 else "He didn't need to.")

def s_wave(d, t):
    header(d); ground(d); house(d, 60, 360)
    cx = 640 + 700 * ease((t - 0.4) / 2.4)
    car(d, cx, people=True)
    waving = t < 5.0
    arm = -150 + 25 * math.sin(t * 7) if waving else -150 + 140 * ease((t - 5.0) / 0.8)
    dad(d, (430, STAND), {"rs": arm, "re": -20 if waving else -5, "ls": 15}, face="smile" if t < 3 else "neutral", flip=1)
    if t > 4.0:
        mx = 260 + 60 * ease((t - 4.0) / 0.6)
        m = mom(d, (mx, STAND), {"rs": -10, "ls": 95, "le": -5}, face="smile")
    caption(d, "He waved until the car was gone." if t < 3.6 else "...and a little longer.")

def s_note(d, t):
    header(d); ground(d)
    box(d, 120, GROUND, 150, 110); box(d, 140, GROUND - 110, 120, 90); box(d, 760, GROUND, 170, 120)
    f = figure(d, (420, GROUND - 12), {"lh": 88, "lk": 0, "rh": 82, "rk": 0, "ls": 60, "le": 20, "rs": 50, "re": 30}, face="neutral" if t < 2.4 else "smile")
    toolbox(d, 640, GROUND)
    op = ease((t - 0.8) / 0.7)
    if op > 0:
        cx, cy = 560, 720
        rect(d, (cx - 230 * op, cy - 90 * op), (cx + 230 * op, cy + 90 * op), w=5, fill=WHITE, radius=6)
        if op > 0.9:
            text(d, (cx, cy - 20), "Proud of you.", font("BoldItalic", 46))
            text(d, (cx + 80, cy + 45), "- Dad", font("Italic", 36))
    if t > 2.6: hx, hy = f["head"]; tear(d, hx + 22, hy + 2 + 40 * ease((t - 2.6) / 1.2))
    if t < 3.8: caption(d, "First night in his own place.")
    else: caption(d, "Follow to watch him grow up.")

SCENES = [(4.6, s_room), (5.6, s_drawing), (5.2, s_carry), (5.0, s_mom), (5.2, s_toolbox), (7.0, s_wave), (6.8, s_note)]

def render():
    out = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", f"{DIR}/mv_v.mp4"], stdin=subprocess.PIPE)
    for dur, fn in SCENES:
        for i in range(int(dur * FPS)):
            t = i / FPS
            img = Image.new("RGB", (W * S, H * S), BG)
            fn(ImageDraw.Draw(img), t)
            img = img.resize((W, H), Image.LANCZOS)
            fade = min(1, t / 0.2, (dur - t) / 0.2)
            if fade < 1: img = Image.blend(Image.new("RGB", (W, H), BG), img, max(0, fade))
            out.stdin.write(img.tobytes())
    out.stdin.close(); out.wait()

def sfx(total):
    SR = 44100
    mix = np.zeros(int((total + 1) * SR))
    def put(at, snd, vol=1.0):
        i = int(at * SR); mix[i:i + len(snd)] += vol * snd[: len(mix) - i]
    starts = np.cumsum([0] + [d for d, _ in SCENES])
    put(starts[0] + 0.1, noise(1.2, 0.18))                       # tape
    put(starts[1] + 0.8, noise(0.4, 0.12))                       # paper
    for k in range(6): put(starts[2] + 0.3 + k * 0.6, tone([90, 70], 0.12, "sine", 0.35))  # heavy steps
    for k, at in enumerate((0.3, 1.7, 2.9)): put(starts[3] + at, tone([600, 900], 0.07, "sine", 0.3))
    put(starts[4] + 0.7, tone([140, 90], 0.2, "sine", 0.5))      # toolbox handed over
    put(starts[5] + 0.3, noise(2.6, 0.12))                       # car leaves
    put(starts[6] + 0.7, tone([2000], 0.03, "square", 0.15))     # latch
    mix = np.clip(mix, -1, 1)
    with wave.open(f"{DIR}/mv_sfx.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())

if __name__ == "__main__":
    total = sum(d for d, _ in SCENES)
    render(); sfx(total)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{DIR}/mv_v.mp4", "-i", f"{DIR}/music/546.mp3", "-i", f"{DIR}/mv_sfx.wav", "-filter_complex",
                    f"[1:a]atrim=0:{total},afade=t=in:d=1,volume=0.55,afade=t=out:st={total - 2}:d=2[m];[2:a]atrim=0:{total}[s];[m][s]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", f"{DIR}/episode1_moving_out.mp4"], check=True)
    print("ok", total)
