"""The Sticks, ep. 1 (montage): 'He never said I love you. He said it like this.' No voice: one warm track, small moments."""
import math, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/tmp/claude-0/yt/cartoon")
import ep1, ep_c, ep_c2
from ep1 import W, H, S, FPS, BG, INK, GROUND, STAND, font, line, circle, rect, text, ease
from ep_c import P, cam, CAM, rain, bench, fries, sit_pose, SEAT
from ep_c2 import him, her, heart, RED, jacket

DIR = "/tmp/claude-0/yt/cartoon/d"
os.makedirs(DIR, exist_ok=True)
SFX = "/tmp/claude-0/yt/cartoon/sfx"
WHITE = (255, 255, 255)

def top(d, s, y=250, size=64):
    text(d, (W / 2, y), s, font("Black", size), world=False)

def year(d, s):
    text(d, (W / 2, 1560), s, font("Bold", 46), fill=(140, 140, 140), world=False)

def snow(d, t, n=40):
    rng = np.random.default_rng(3)
    for x, p in zip(rng.uniform(-200, 1300, n), rng.uniform(0, 1, n)):
        y = 300 + ((t * 0.25 + p) % 1) * 1000
        d.ellipse([P(x + 12 * math.sin(t * 2 + p * 9) - 6, y - 6), P(x + 12 * math.sin(t * 2 + p * 9) + 6, y + 6)], fill=(170, 170, 170))

def mug(d, x, y, steam_t=None):
    rect(d, (x - 36, y - 76), (x + 36, y), w=7, fill=RED, radius=8)
    d.arc([P(x + 20, y - 60), P(x + 60, y - 20)], 270, 90, fill=INK, width=int(7 * S * CAM["z"]))
    if steam_t is not None:
        for k in (-12, 8):
            pts = [P(x + k + 8 * math.sin(steam_t * 4 + j + k), y - 70 - j * 18) for j in range(4)]
            d.line(pts, fill=(160, 160, 160), width=int(4 * S * CAM["z"]), joint="curve")

def car(d, x, snowy=0.0):
    d.polygon([P(x - 210, 1215), P(x - 210, 1120), P(x - 120, 1120), P(x - 70, 1050), P(x + 120, 1050), P(x + 170, 1120), P(x + 220, 1130), P(x + 220, 1215)],
              outline=INK, fill=BG, width=int(8 * S * CAM["z"]))
    rect(d, (x - 60, 1065), (x + 25, 1118), w=6, fill=(225, 225, 225) if snowy > 0.5 else None)
    rect(d, (x + 40, 1065), (x + 115, 1118), w=6, fill=(225, 225, 225) if snowy > 0 else None)
    for wx in (-120, 130): circle(d, (x + wx, 1218), 32, fill=BG)

def couch(d, x0=180, x1=760):
    rect(d, (x0, 1100), (x1, 1190), fill=BG, radius=26); rect(d, (x0 - 20, 990), (x0 + 40, 1190), fill=BG, radius=20); rect(d, (x1 - 40, 990), (x1 + 20, 1190), fill=BG, radius=20)
    line(d, (x0 + 40, 1190), (x0 + 40, GROUND)); line(d, (x1 - 40, 1190), (x1 - 40, GROUND))

# ---------- moments ----------
def m_jacket(d, t):
    cam(560, 1.55); rain(d, t)
    give = ease((t - 2.2) / 0.6)
    her(d, (640, STAND), {"ls": 25, "rs": -25}, face="smile" if give > 0.5 else "neutral", mood="happy" if give > 0.5 else "worried", flip=-1, coat=give > 0.5, wet=give < 0.5)
    him(d, (450 + 40 * give, STAND), {"rs": -60 - 50 * give, "re": 10, "ls": 30}, face="smile", mood="happy", coat=give <= 0.5, wet=give > 0.5)
    if 2.0 < t < 2.9: d.line([P(470 + 160 * give - 60, 860), P(470 + 160 * give + 60, 860)], fill=RED, width=int(30 * S * CAM["z"]))
    top(d, "He never said “I love you.”" if t < 2.6 else "He said it like this.")
    year(d, "Year 1")

def m_fries(d, t):
    cam(520, 1.8)
    bench(d, 300, 740)
    slide = ease((t - 1.0) / 0.7)
    him(d, (420, 1085), sit_pose(), face="o" if t < 2.0 else "smile", mood="up" if t < 2.0 else "happy")
    her(d, (620, 1085), sit_pose({"ls": 60, "le": 30}), face="smile", mood="happy", flip=-1)
    rect(d, (480, SEAT - 46), (560, SEAT - 4), w=6, fill=RED, radius=6)
    fx = 600 - 110 * slide
    line(d, (fx, SEAT - 50), (fx + 8, SEAT - 100), w=9)
    if t > 0.6: text(d, (520, 800), "the last fry", font("BoldItalic", 44))
    year(d, "Year 2")

def m_car(d, t):
    cam(560, 1.45); snow(d, t)
    car(d, 720, snowy=1 - ease((t - 0.2) / 1.6))
    scrape = 18 * math.sin(t * 9) if t < 1.9 else 0
    f = him(d, (540, STAND), {"rs": 110 + scrape, "re": -20, "ls": 20}, face="neutral", mood="worried" if t < 1.9 else "happy", flip=1)
    hx, hy = f["r"]; line(d, (hx, hy), (hx + 28, hy + 22), w=8)  # ice scraper
    out = ease((t - 1.8) / 1.0)
    her(d, (120 + 220 * out, STAND), {}, face="smile", mood="happy")
    text(d, (W / 2, 1480), "6:40 AM", font("Bold", 40), world=False)
    year(d, "Year 5")

def m_fight(d, t):
    cam(540, 1.6)
    line(d, (380, 1080), (700, 1080), w=10); line(d, (410, 1080), (410, GROUND)); line(d, (670, 1080), (670, GROUND))  # table
    calm = ease((t - 2.0) / 0.6)
    her(d, (760, STAND), {"ls": 60, "le": 70, "rs": -20}, face="neutral" if calm < 0.5 else "smile", mood="angry" if calm < 0.5 else "happy", flip=1)
    him(d, (330 + 230 * ease((t - 1.0) / 0.8), STAND), {"rs": -70 if t > 1.0 else -20, "re": -10}, face="neutral", mood="angry" if t < 1.0 else "worried", flip=1 if t > 1.0 else -1)
    if t > 1.6: mug(d, 610, 1074, t)
    if t < 1.2:
        for k in range(3): circle(d, (540 + 40 * k - 40, 660 + 8 * math.sin(t * 12 + k)), 24, w=5)
    year(d, "Year 9")

def m_blanket(d, t):
    cam(580, 1.45)
    couch(d)
    rect(d, (820, 900), (1020, 1060), w=8, fill=(40, 40, 40)); line(d, (920, 1060), (920, GROUND), w=8)  # tv
    if t < 2.4:
        for k in range(3): line(d, (840, 930 + k * 40), (1000, 930 + k * 40), w=3, fill=(120, 120, 120))
    him(d, (420, 1095), {"lh": 80, "lk": -60, "rh": 75, "rk": -55, "ls": 30, "rs": -20}, face="neutral", mood="neutral", lean=-30)
    text(d, (420 + 60, 760), "z z z", font("Bold", 40))
    cover = ease((t - 0.9) / 0.9)
    if cover > 0:
        d.polygon([P(330, 1000 + 60 * (1 - cover)), P(560, 1010 + 60 * (1 - cover)), P(580, 1110), P(310, 1110)], fill=RED)
    her(d, (640 - 30 * cover, STAND), {"ls": 60 + 40 * cover, "le": 40, "rs": 50, "re": 40}, face="smile", mood="happy", flip=-1)
    year(d, "Year 14")

def m_old(d, t):
    cam(520, 1.7); rain(d, t, heavy=0.6)
    bench(d, 300, 740)
    give = ease((t - 0.8) / 0.9)
    him(d, (430, 1085), sit_pose({"rs": 20 + 50 * give, "re": 40}), face="smile", mood="happy", old=True, coat=give < 0.5)
    line(d, (350, 1060), (330, GROUND), w=6)
    her(d, (600, 1085), sit_pose(), face="smile", mood="happy" if give > 0.5 else "worried", flip=-1, old=True, coat=give >= 0.5)
    if t > 2.4: heart(d, 515, 740 - 30 * ease((t - 2.4) / 0.8), 1.1)
    year(d, "Year 30")

def m_end(d, t):
    top(d, "Who does this", y=820, size=96); top(d, "for you?", y=940, size=96)
    if t > 0.9: text(d, (W / 2, 1110), "Tag them.", font("Black", 70), fill=RED, world=False)
    text(d, (W / 2, 1560), "The Sticks", font("Bold", 46), fill=(140, 140, 140), world=False)

MOMENTS = [(4.6, m_jacket), (3.6, m_fries), (3.7, m_car), (3.8, m_fight), (3.7, m_blanket), (5.0, m_old), (3.2, m_end)]

def render():
    out = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", f"{DIR}/v.mp4"], stdin=subprocess.PIPE)
    for dur, fn in MOMENTS:
        for i in range(int(dur * FPS)):
            t = i / FPS
            img = Image.new("RGB", (W * S, H * S), BG)
            fn(ImageDraw.Draw(img), t)
            img = img.resize((W, H), Image.LANCZOS)
            fade = min(1, t / 0.15, (dur - t) / 0.15)
            if fade < 1: img = Image.blend(Image.new("RGB", (W, H), BG), img, max(0, fade))
            out.stdin.write(img.tobytes())
    out.stdin.close(); out.wait()

if __name__ == "__main__":
    render()
    total = sum(d for d, _ in MOMENTS)
    st = np.cumsum([0] + [d for d, _ in MOMENTS])
    cues = [(f"{SFX}/2393.mp3", st[0], 0.25), (f"{SFX}/1489.mp3", st[0] + 2.2, 0.35), (f"{SFX}/1263.mp3", st[5], 0.25),
            (f"{SFX}/2256.mp3", st[5] + 2.4, 0.25)]
    inputs = ["-i", f"{DIR}/v.mp4", "-ss", "6", "-i", "/tmp/claude-0/yt/cartoon/music/545.mp3"]
    fc = [f"[1:a]atrim=0:{total},afade=t=in:d=0.6,afade=t=out:st={total - 2}:d=2,volume=0.9[m]"]
    labels = ["[m]"]
    for k, (p, at, vol) in enumerate(cues):
        inputs += ["-i", p]
        fc.append(f"[{k + 2}:a]atrim=0:{min(4.5, total - at)},afade=t=out:st={min(4.5, total - at) - 1}:d=1,volume={vol},adelay={int(at * 1000)}:all=1[c{k}]")
        labels.append(f"[c{k}]")
    fc.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=first,atrim=0:{total},loudnorm=I=-14:TP=-1.5[a]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", f"{DIR}/the_sticks_he_said_it_like_this.mp4"], check=True)
    print("ok", total)
