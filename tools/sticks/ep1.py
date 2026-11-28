"""Pilot episode: a black-and-white stick figure growing up. Episode 1, age 22: first day at the first real job."""
import math, subprocess, wave, textwrap
import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, S, FPS = 1080, 1920, 2, 30
BG, INK, GREY = (250, 250, 246), (17, 17, 17), (150, 150, 150)
GROUND = 1250
DIR = "/tmp/claude-0/yt/cartoon"
F = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
fonts = {}
def font(w, s):
    k = (w, s)
    if k not in fonts: fonts[k] = ImageFont.truetype(F.format(w), s * S)
    return fonts[k]

Z = 1.35  # world zoom around the ground centre; header and caption are not zoomed
def P(x, y): return ((540 + (x - 540) * Z) * S, (GROUND + (y - GROUND) * Z) * S)
def PT(x, y): return (x * S, y * S)
def line(d, a, b, w=9, fill=INK):
    d.line([P(*a), P(*b)], fill=fill, width=int(w * S * Z))
    for q in (a, b): d.ellipse([P(q[0] - w / 2, q[1] - w / 2), P(q[0] + w / 2, q[1] + w / 2)], fill=fill)
def circle(d, c, r, w=9, fill=None):
    d.ellipse([P(c[0] - r, c[1] - r), P(c[0] + r, c[1] + r)], outline=INK, width=int(w * S * Z), fill=fill)
def rect(d, a, b, w=8, fill=None, radius=0):
    d.rounded_rectangle([P(*a), P(*b)], radius=radius * S * Z, outline=INK, width=int(w * S * Z), fill=fill)
def text(d, xy, s, f, fill=INK, anchor="mm", world=True):
    d.text(P(*xy) if world else PT(*xy), s, font=f, fill=fill, anchor=anchor)

def limb(start, angles, lengths):
    pts, a, cur = [start], 0, start
    for ang, L in zip(angles, lengths):
        a += ang
        cur = (cur[0] + L * math.sin(math.radians(a)), cur[1] + L * math.cos(math.radians(a)))
        pts.append(cur)
    return pts

def figure(d, hip, pose=None, face="neutral", lean=0, tie=False, glasses=False, flip=1):
    """Stick figure from its hip. Angles in degrees from straight down, positive = forward (towards +x * flip)."""
    p = {"ls": 20, "le": 10, "rs": -20, "re": -10, "lh": 8, "lk": 0, "rh": -8, "rk": 0}
    p.update(pose or {})
    f = lambda a: a * flip
    neck = (hip[0] + 150 * math.sin(math.radians(f(lean) + 180)) * -1, hip[1] - 150 * math.cos(math.radians(f(lean))))
    head = (neck[0] + 12 * math.sin(math.radians(f(lean))), neck[1] - 52)
    line(d, hip, neck)
    for s, e in (("ls", "le"), ("rs", "re")):
        a = limb(neck, [f(p[s]), f(p[e])], [80, 72]); line(d, a[0], a[1]); line(d, a[1], a[2])
    for h_, k in (("lh", "lk"), ("rh", "rk")):
        a = limb(hip, [f(p[h_]), f(p[k])], [98, 96]); line(d, a[0], a[1]); line(d, a[1], a[2])
    circle(d, head, 44, fill=BG)
    ex = head[0] + 8 * flip
    for dx in (-15, 15):
        d.ellipse([P(ex + dx - 5, head[1] - 10), P(ex + dx + 5, head[1])], fill=INK)
    m = (ex, head[1] + 16)
    if face == "smile": d.arc([P(m[0] - 16, m[1] - 14), P(m[0] + 16, m[1] + 8)], 20, 160, fill=INK, width=6 * S)
    elif face == "sad": d.arc([P(m[0] - 14, m[1] + 2), P(m[0] + 14, m[1] + 22)], 200, 340, fill=INK, width=6 * S)
    elif face == "o": circle(d, m, 7, w=5)
    elif face == "big": d.chord([P(m[0] - 18, m[1] - 10), P(m[0] + 18, m[1] + 16)], 0, 180, fill=INK)
    else: line(d, (m[0] - 10, m[1] + 4), (m[0] + 10, m[1] + 4), w=5)
    if tie:
        d.polygon([P(neck[0] - 9, neck[1] + 6), P(neck[0] + 9, neck[1] + 6), P(neck[0] + 4, neck[1] + 70), P(neck[0] - 4, neck[1] + 70)], fill=INK)
    hands = {k: limb(neck, [f(p[s]), f(p[e])], [80, 72])[2] for k, s, e in (("l", "ls", "le"), ("r", "rs", "re"))}
    return {"head": head, **hands}

def bubble(d, xy, s, tail, size=46, width=16):
    f = font("Bold", int(size * Z))
    lines = textwrap.wrap(s, width)
    lh = size * 1.25
    w = max(d.textlength(l, font=f) for l in lines) / (S * Z) + 60
    h = lh * len(lines) + 40
    x0, y0 = xy[0] - w / 2, xy[1] - h / 2
    d.polygon([P(tail[0] - 18, y0 + h - 4), P(tail[0] + 18, y0 + h - 4), P(*tail)], fill=INK)
    rect(d, (x0, y0), (x0 + w, y0 + h), w=6, fill=(255, 255, 255), radius=34)
    d.polygon([P(tail[0] - 12, y0 + h - 8), P(tail[0] + 12, y0 + h - 8), P(tail[0], tail[1] - 14)], fill=(255, 255, 255))
    for i, l in enumerate(lines): text(d, (xy[0], y0 + 20 + lh * i + lh / 2), l, f)

def caption(d, s, y=1520):
    for i, l in enumerate(textwrap.wrap(s, 22)): text(d, (W / 2, y + i * 82), l, font("ExtraBold", 66), world=False)

def header(d):
    text(d, (W / 2, 210), "EPISODE 1", font("Bold", 34), fill=GREY, world=False)
    text(d, (W / 2, 290), "Age 22", font("Black", 92), world=False)

def ground(d): line(d, (-100, GROUND), (1200, GROUND), w=5)

ease = lambda x: 0.5 - 0.5 * math.cos(math.pi * max(0, min(1, x)))
STAND = GROUND - 190

# ---------- scenes: (duration, draw(d, t)) ----------
def s1(d, t):  # alarm, jumps out of bed
    header(d); ground(d)
    rect(d, (190, 1120), (540, 1190), fill=BG, radius=14); line(d, (190, 1090), (190, GROUND)); line(d, (540, 1150), (540, GROUND))
    rect(d, (640, 1130), (750, GROUND), fill=BG)
    shake = 8 * math.sin(t * 70) if t < 1.3 else 0
    circle(d, (695 + shake, 1085), 38); line(d, (695 + shake, 1085), (695 + shake, 1062), w=5); line(d, (695 + shake, 1085), (722 + shake, 1092), w=5)
    if t < 1.3:
        for k in range(3):
            a = -40 + k * 40
            r1, r2 = 60, 85
            line(d, (695 + r1 * math.sin(math.radians(a)), 1085 - r1 * math.cos(math.radians(a))), (695 + r2 * math.sin(math.radians(a)), 1085 - r2 * math.cos(math.radians(a))), w=6)
        # lying in bed
        line(d, (280, 1100), (480, 1100)); circle(d, (245, 1090), 40, fill=BG)
        d.rectangle([P(300, 1060), P(530, 1118)], fill=BG); rect(d, (300, 1060), (530, 1118), w=6, radius=20)
        text(d, (300, 990), "z z z", font("Bold", 52))
    else:
        j = min(1, (t - 1.3) / 0.35)
        hop = 160 * math.sin(math.pi * j) if j < 1 else 0
        figure(d, (400, STAND - hop), {"ls": 150, "rs": -150, "le": 20, "re": -20} if j < 1 else {"ls": 160, "rs": -160}, face="big")
        text(d, (400, STAND - hop - 300), "!", font("Black", 110))
    caption(d, "First day at his first real job.")

def s2(d, t):  # runs for the bus, misses it
    header(d); ground(d)
    line(d, (820, GROUND), (820, 980), w=7); rect(d, (775, 930), (865, 990), fill=BG, radius=10); text(d, (820, 960), "BUS", font("Black", 40))
    bx = 640 + 1200 * ease((t - 0.5) / 1.6)
    rect(d, (bx - 230, 1030), (bx + 230, 1215), fill=BG, radius=26)
    for k in range(4): rect(d, (bx - 200 + k * 105, 1055), (bx - 120 + k * 105, 1115), w=6, radius=8)
    for wx in (-140, 140): circle(d, (bx + wx, 1220), 30, fill=BG)
    if 0.5 < t < 2.2:
        for k in range(3): line(d, (bx - 290 - k * 40, 1080 + k * 50), (bx - 250 - k * 40, 1080 + k * 50), w=5)
    run = min(1, t / 2.2)
    x = 190 + 480 * run
    if t < 2.2:
        ph = t * 14
        a, b = 38 * math.sin(ph), 38 * math.sin(ph + math.pi)
        figure(d, (x, STAND - 8 * abs(math.sin(ph))), {"lh": a, "lk": -30 if a < 0 else -5, "rh": b, "rk": -30 if b < 0 else -5, "ls": -b, "rs": -a, "le": 60, "re": 60}, face="o", lean=14)
    else:
        figure(d, (x, STAND), {"ls": 6, "rs": -6, "le": 0, "re": 0}, face="sad")
        if t > 2.5:
            for k in range(4): line(d, (x - 60 + k * 40, 790 + ((t * 300 + k * 37) % 60)), (x - 66 + k * 40, 810 + ((t * 300 + k * 37) % 60)), w=4)
            d.ellipse([P(x - 110, 700), P(x + 110, 770)], fill=(200, 200, 200))
    caption(d, "He planned everything." if t < 2.3 else "...except the bus.")

def s3(d, t):  # the boss and the laptop
    header(d); ground(d)
    bx = 760
    figure(d, (bx, STAND), {"ls": 30, "le": 40, "rs": -15, "re": -10}, face="smile", tie=True, flip=-1)
    wx = 200 + 240 * ease(t / 0.9)
    ph = t * 10
    walking = t < 0.9
    pose = {"lh": 25 * math.sin(ph), "rh": -25 * math.sin(ph), "ls": -20 * math.sin(ph), "rs": 20 * math.sin(ph)} if walking else {}
    figure(d, (wx, STAND), pose, face="smile" if t < 2.4 else "o")
    if 0.5 < t < 2.3: bubble(d, (640, 720), "Welcome to the team!", (bx - 20, 860), size=44, width=13)
    if t >= 2.3: bubble(d, (620, 690), "Your laptop arrives... next week.", (bx - 20, 860), size=44, width=13)
    caption(d, "Day one.")

def s4(d, t):  # 8 hours of looking busy
    header(d); ground(d)
    line(d, (440, 1080), (880, 1080), w=10); line(d, (470, 1080), (470, GROUND)); line(d, (850, 1080), (850, GROUND))
    cx, cy = 740, 800
    circle(d, (cx, cy), 85, fill=(255, 255, 255))
    for k in range(12):
        a = math.radians(k * 30); line(d, (cx + 80 * math.sin(a), cy - 80 * math.cos(a)), (cx + 88 * math.sin(a), cy - 88 * math.cos(a)), w=4)
    hm = math.radians(t * 900); hh = math.radians(t * 75)
    line(d, (cx, cy), (cx + 70 * math.sin(hm), cy - 70 * math.cos(hm)), w=6); line(d, (cx, cy), (cx + 45 * math.sin(hh), cy - 45 * math.cos(hh)), w=9)
    # chair and sitting figure typing on nothing
    line(d, (250, 1130), (370, 1130), w=8); line(d, (260, 1130), (260, GROUND)); line(d, (360, 1130), (360, GROUND)); line(d, (260, 1130), (245, 960), w=8)
    tap = 18 * math.sin(t * 22)
    figure(d, (315, 1118), {"lh": 90, "lk": -90, "rh": 85, "rk": -85, "ls": 70, "le": 30 + tap, "rs": 60, "re": 40 - tap}, face="neutral")
    if t > 2: d.polygon([P(375, 850), P(365, 878), P(385, 878)], fill=INK)
    caption(d, "Eight hours of looking busy.")

def s5(d, t):  # home, mom asks
    header(d); ground(d)
    rect(d, (220, 1100), (700, 1190), fill=BG, radius=26); rect(d, (200, 990), (260, 1190), fill=BG, radius=20); rect(d, (660, 990), (720, 1190), fill=BG, radius=20)
    line(d, (260, 1190), (260, GROUND)); line(d, (660, 1190), (660, GROUND))
    drop = 1 - ease(t / 0.4)
    fig = figure(d, (430, 1090 - 260 * drop), {"lh": 80, "lk": -60, "rh": 75, "rk": -55, "ls": 140, "le": 30, "rs": -20, "re": -10}, face="neutral" if t < 3.2 else "smile", lean=-12)
    if t > 0.4: hx, hy = fig["l"]; rect(d, (hx - 18, hy - 50), (hx + 18, hy + 8), w=6, fill=INK, radius=8)
    if 0.9 < t: bubble(d, (720, 720), "Mom: So?? How was it?", (590, 860), size=42, width=12)
    if 2.4 < t: bubble(d, (300, 740), "Loved it.", (390, 840), size=46)
    caption(d, "Tomorrow: the laptop arrives. Probably." if t < 4.4 else "Follow to watch him grow up.")

SCENES = [(3.2, s1), (4.0, s2), (4.6, s3), (4.2, s4), (5.8, s5)]

def render():
    out = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", f"{DIR}/ep1_v.mp4"], stdin=subprocess.PIPE)
    for dur, fn in SCENES:
        n = int(dur * FPS)
        for i in range(n):
            t = i / FPS
            img = Image.new("RGB", (W * S, H * S), BG)
            fn(ImageDraw.Draw(img), t)
            img = img.resize((W, H), Image.LANCZOS)
            fade = min(1, t / 0.12, (dur - t) / 0.12)
            if fade < 1: img = Image.blend(Image.new("RGB", (W, H), BG), img, max(0, fade))
            out.stdin.write(img.tobytes())
    out.stdin.close(); out.wait()

# ---------- sound effects ----------
SR = 44100
def tone(freqs, dur, kind="sine", vol=0.5):
    t = np.arange(int(dur * SR)) / SR
    f = np.interp(t, np.linspace(0, dur, len(freqs)), freqs)
    ph = 2 * np.pi * np.cumsum(f) / SR
    w = np.sin(ph) if kind == "sine" else (np.sign(np.sin(ph)) * 0.6 if kind == "square" else 2 * (ph / (2 * np.pi) % 1) - 1)
    env = np.minimum(1, np.minimum(t / 0.01, (dur - t) / 0.05))
    return w * env * vol
def noise(dur, vol=0.3):
    n = np.random.default_rng(1).standard_normal(int(dur * SR))
    n = np.convolve(n, np.ones(30) / 30, mode="same")
    t = np.arange(len(n)) / SR
    return n * np.sin(np.pi * t / dur) * vol * 3

def sfx():
    total = sum(d for d, _ in SCENES) + 0.5
    mix = np.zeros(int(total * SR))
    def put(at, snd):
        i = int(at * SR); mix[i:i + len(snd)] += snd[: len(mix) - i]
    for k in range(5): put(0.05 + k * 0.24, tone([1800], 0.12, "square", 0.22))   # alarm
    put(1.3, tone([300, 900, 500, 700], 0.35, "sine", 0.45))                        # boing
    put(3.2 + 0.5, noise(1.4, 0.25))                                                 # bus leaves
    put(3.2 + 2.35, tone([392, 380], 0.35, "saw", 0.18)); put(3.2 + 2.75, tone([370, 300], 0.7, "saw", 0.18))  # wah wah
    put(7.2 + 0.5, tone([600, 900], 0.08, "sine", 0.4)); put(7.2 + 2.3, tone([600, 900], 0.08, "sine", 0.4))   # bubble pops
    for k in range(int(4.2 / 0.12)): put(12.0 + k * 0.12, tone([2400], 0.015, "square", 0.12))                 # fast ticking
    put(16.0, tone([110, 60], 0.25, "sine", 0.7))                                    # thud on the couch
    put(16.0 + 0.9, tone([1320], 0.12, "sine", 0.35)); put(16.0 + 1.03, tone([1760], 0.2, "sine", 0.35))       # message
    put(16.0 + 2.4, tone([1320], 0.1, "sine", 0.3))
    mix = np.clip(mix, -1, 1)
    with wave.open(f"{DIR}/sfx.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())
    return total

if __name__ == "__main__":
    render()
    total = sfx()
    dur = sum(d for d, _ in SCENES)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", f"{DIR}/ep1_v.mp4", "-i", f"{DIR}/music/595.mp3", "-i", f"{DIR}/sfx.wav", "-filter_complex",
                    f"[1:a]atrim=0:{dur},volume=0.35,afade=t=out:st={dur - 1}:d=1[m];[2:a]atrim=0:{dur}[s];[m][s]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", f"{DIR}/episode1_age22.mp4"], check=True)
    print("ok", dur)
