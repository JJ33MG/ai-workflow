"""The Sticks, episode 1 v2: 'The Plan'. Why the disaster date worked: he stayed. Brows, a red jacket, real sound."""
import math, os, subprocess, sys, textwrap
from PIL import Image, ImageDraw
sys.path.insert(0, "/tmp/claude-0/yt/cartoon")
import ep1, ep_c
from ep1 import W, H, S, FPS, BG, INK, GREY, GROUND, STAND, font, line, circle, rect, text, ease
from ep_c import P, cam, CAM, rain, bench, lamppost, restaurant, umbrella, fries_stand, fries, sit_pose, SEAT

DIR = "/tmp/claude-0/yt/cartoon/c2"
os.makedirs(DIR, exist_ok=True)
ep_c.DIR = DIR
SFX = "/tmp/claude-0/yt/cartoon/sfx"
RED = (206, 38, 38)
WHITE = (255, 255, 255)

def brows(d, head, flip, mood):
    hx, hy = head
    ex = hx + 8 * flip
    shape = {"neutral": (-24, -24), "worried": (-21, -31), "angry": (-31, -20), "happy": (-29, -27), "up": (-35, -35)}[mood]
    for side in (-1, 1):
        outer = (ex + side * 27, hy + shape[0]); inner = (ex + side * 5, hy + shape[1])
        line(d, outer, inner, w=5)

def neck_of(hip, lean, flip):
    a = math.radians(lean * flip)
    return (hip[0] + 150 * math.sin(a), hip[1] - 150 * math.cos(a))

def jacket(d, hip, lean=0, flip=1):
    n = neck_of(hip, lean, flip)
    d.line([P(hip[0] + (n[0] - hip[0]) * 0.05, hip[1] - 4), P(n[0], n[1] + 14)], fill=RED, width=int(30 * S * CAM["z"]))

def him(d, hip, pose=None, face="neutral", mood="neutral", flip=1, lean=0, old=False, wet=False, coat=False, bob=0.0):
    hip = (hip[0], hip[1] + bob)
    f = ep_c.him(d, hip, pose, face=face, flip=flip, lean=lean, old=old, wet=wet)
    if coat: jacket(d, hip, lean, flip); ep_c.him(d, hip, pose, face=face, flip=flip, lean=lean, old=old, wet=wet)
    brows(d, f["head"], flip, mood)
    return f

def her(d, hip, pose=None, face="smile", mood="neutral", flip=1, lean=0, old=False, coat=False, bob=0.0, wet=False):
    hip = (hip[0], hip[1] + bob)
    if coat: jacket(d, hip, lean, flip)
    f = ep_c.her(d, hip, pose, face=face, flip=flip, lean=lean, old=old)
    if coat:
        n = neck_of(hip, lean, flip)
        d.line([P(hip[0], hip[1] - 4), P(n[0], n[1] + 14)], fill=RED, width=int(30 * S * CAM["z"]))
        line(d, hip, n)
    brows(d, f["head"], flip, mood)
    if wet:
        hx, hy = f["head"]
        for k in (-56, 58): d.ellipse([P(hx + k - 5, hy + 70), P(hx + k + 5, hy + 84)], fill=INK)
    return f

def heart(d, x, y, s=1.0):
    d.ellipse([P(x - 22 * s, y - 14 * s), P(x, y + 8 * s)], fill=RED); d.ellipse([P(x, y - 14 * s), P(x + 22 * s, y + 8 * s)], fill=RED)
    d.polygon([P(x - 21 * s, y + 2 * s), P(x + 21 * s, y + 2 * s), P(x, y + 28 * s)], fill=RED)

def sub(d, s):
    for i, l in enumerate(textwrap.wrap(s, 24)):
        text(d, (W / 2, 1540 + i * 80), l, font("ExtraBold", 62), world=False)

def tag(d, s): text(d, (W / 2, 240), s, font("Black", 56), world=False)

PLAN = ["1. Be early", "2. Fancy dinner", "3. Be cool"]
def plan(d, struck, t, tick=False, newest=None):
    """Close-up of his note; `struck` items are crossed out in red, the newest one animates."""
    x0, y0, x1, y1 = 170, 560, 910, 1240
    d.rounded_rectangle([(x0 * S, y0 * S), (x1 * S, y1 * S)], radius=18 * S, fill=WHITE, outline=INK, width=8 * S)
    text(d, (540, 660), "THE PLAN", font("Black", 72), world=False)
    for i, item in enumerate(PLAN):
        y = 810 + i * 140
        text(d, (230, y), item, font("BoldItalic", 64), anchor="lm", world=False)
        if i in struck:
            k = ease(t / 0.35) if i == newest else 1
            w = d.textlength(item, font=font("BoldItalic", 64)) / S
            d.line([(220 * S, (y + 4) * S), ((220 + (w + 20) * k) * S, (y - 6) * S)], fill=RED, width=12 * S)
        if tick and i == 0:
            d.line([((260 + d.textlength(item, font=font("BoldItalic", 64)) / S) * S, y * S), ((280 + d.textlength(item, font=font("BoldItalic", 64)) / S) * S, (y + 22) * S),
                    ((320 + d.textlength(item, font=font("BoldItalic", 64)) / S) * S, (y - 30) * S)], fill=INK, width=10 * S, joint="curve")

# ---------- shots ----------
def s_hook(d, t):
    cam(540, 1.55); rain(d, t)
    bench(d, 330, 750)
    him(d, (470, 1085), sit_pose(), face="neutral", mood="worried", wet=True, bob=2 * math.sin(t * 3))
    her(d, (610, 1085), sit_pose(), face="smile", mood="happy", flip=-1, coat=True, bob=2 * math.sin(t * 3 + 1))
    fries(d, 540, SEAT - 8)
    tag(d, "THE STICKS · EP. 1")

def s_plan(d, t): plan(d, [], t)

def s_early(d, t):
    cam(500, 1.5); lamppost(d, 330); restaurant(d)
    bow = 35 * ease((t - 1.9) / 0.35) if t > 1.9 else 0
    him(d, (430, STAND), {"rs": -30, "ls": 40 if t < 1.2 else 75, "le": 30}, face="smile", mood="happy", flip=-1, lean=bow, coat=True, bob=3 * math.sin(t * 3))
    tag(d, "6:28 PM")

def s_tick(d, t): plan(d, [], t, tick=True)

def s_rain(d, t):
    cam(540, 1.6); lamppost(d, 330); restaurant(d)
    rain(d, t, n=int(10 + 50 * ease(t / 0.8)))
    look = ease((t - 0.3) / 0.4)
    him(d, (450, STAND), {"rs": -20, "ls": 20}, face="o" if t > 0.8 else "neutral", mood="worried", lean=-8 * look, coat=True, bob=2 * math.sin(t * 6))

def s_arrive(d, t):
    cam(560, 1.5); restaurant(d); rain(d, t)
    run = ease(t / 0.9)
    give = ease((t - 2.6) / 0.6)
    her(d, (1150 - 420 * run, STAND), {"ls": 170, "le": 10, "rs": -170, "re": -10} if t < 1.0 else {"ls": 25, "rs": -25}, face="big" if t < 2.6 else "smile",
        mood="up" if t < 2.6 else "happy", flip=-1, lean=8 if t < 0.9 else 0, coat=give > 0.5, wet=True)
    him(d, (440 + 60 * give, STAND), {"rs": -60 - 50 * give, "re": 10, "ls": 30}, face="smile", mood="happy" if t < 2.6 else "neutral", coat=give <= 0.5, wet=give > 0.5)
    if 2.4 < t < 3.4:
        x = 470 + 220 * give
        d.line([P(x - 60, 860), P(x + 60, 860)], fill=RED, width=int(30 * S * CAM["z"]))

def s_closed(d, t):
    cam(760, 1.9); rain(d, t)
    restaurant(d, closed=ease((t - 0.2) / 0.5))

def s_strike2(d, t): plan(d, [1], t, newest=1)

def s_umbrella(d, t):
    cam(540, 1.6); rain(d, t)
    flipped = ease((t - 1.0) / 0.2)
    f = him(d, (420, STAND), {"rs": -150, "re": 10}, face="big" if t > 1.0 else "smile", mood="up" if t > 1.0 else "happy", wet=True)
    umbrella(d, f["r"][0], f["r"][1] - 120, flipped)
    her(d, (640, STAND), {"ls": 20 + (60 if t > 1.4 else 0), "le": 80 if t > 1.4 else 10}, face="big" if t > 1.4 else "smile", mood="happy", flip=-1, coat=True)

def s_strike3(d, t): plan(d, [1, 2], t, newest=2)

def s_confess(d, t):
    cam(500, 1.8); rain(d, t, heavy=0.6)
    bench(d, 300, 700)
    him(d, (430, 1085), sit_pose({"rs": -10}), face="sad", mood="worried", wet=True, bob=2 * math.sin(t * 2.5))
    her(d, (580, 1085), sit_pose(), face="neutral", mood="neutral", flip=-1, coat=True, bob=2 * math.sin(t * 2.5 + 1))
    fries(d, 505, SEAT - 8)

def s_answer(d, t, start_lean=5.6):
    cam(510, 1.95); rain(d, t, heavy=0.5)
    bench(d, 300, 700)
    lean = 14 * ease((t - start_lean) / 0.7)
    him(d, (430, 1085), sit_pose({"rs": -10}), face="o" if t < start_lean + 0.6 else "smile", mood="up" if t < start_lean + 0.6 else "happy", wet=True)
    her(d, (580 - 22 * ease((t - start_lean) / 0.7), 1085), sit_pose(), face="smile", mood="happy", flip=-1, lean=lean, coat=True)
    if t > start_lean + 0.9: heart(d, 505, 760 - 40 * ease((t - start_lean - 0.9) / 0.8), 1.1 + 0.25 * math.sin(t * 6))

def s_years(d, t):
    text(d, (W / 2, 900), "30 YEARS", font("Black", 130), world=False)
    text(d, (W / 2, 1040), "LATER", font("Black", 130), world=False)

def s_old(d, t):
    cam(500, 1.6); rain(d, t)
    fries_stand(d, 900); bench(d, 300, 700)
    give = ease((t - 0.6) / 0.8)
    him(d, (430, 1085), sit_pose({"rs": 20 + 40 * give, "re": 40}), face="smile", mood="happy", old=True, coat=give < 0.5)
    line(d, (350, 1060), (330, GROUND), w=6)
    her(d, (580, 1085), sit_pose(), face="smile", mood="happy" if t > 1.4 else "worried", flip=-1, old=True, coat=give >= 0.5)
    if t > 4.0: heart(d, 505, 760 - 30 * ease((t - 4.0) / 0.8), 1.0)

def s_end(d, t):
    s_old(d, t + 6)
    text(d, (W / 2, 330), "Follow The Sticks", font("Black", 64), world=False)

SCRIPT = [
    (s_hook, [("N", "Their first date was a disaster.", 0.2), ("N", "It's the reason they're still together.", None)], 0.4, "quirky"),
    (s_plan, [("HIM", "Be early. Fancy dinner. Be cool. Easy.", 0.2)], 0.3, "quirky"),
    (s_early, [("HIM", "Hi. Hey... Hello, madam.", 0.4)], 0.5, "quirky"),
    (s_tick, [], 0.9, "quirky"),
    (s_rain, [("HIM", "It's fine. It's fine.", 1.0)], 0.4, "quirky"),
    (s_arrive, [("HER", "Hi! Sorry I'm late! I didn't bring a jacket.", 0.5)], 1.2, "quirky"),
    (s_closed, [], 1.3, "quirky"),
    (s_strike2, [("HIM", "Oh no.", 0.4)], 0.3, "quirky"),
    (s_umbrella, [], 2.0, "quirky"),
    (s_strike3, [], 1.0, "quirky"),
    (s_confess, [("HIM", "I had a whole plan. I just wanted to impress you.", 0.5)], 1.0, "silence"),
    (s_answer, [("HER", "You stood in the rain for thirty minutes. Then you gave me your jacket.", 0.3),
                ("HER", "I don't need impressive. I need someone who stays.", None)], 1.6, "warm"),
    (s_years, [], 1.5, "warm"),
    (s_old, [("OLDHER", "Still not impressive.", 1.8), ("OLDHIM", "Still here.", None)], 1.0, "warm"),
    (s_end, [("N", "Some plans fail. The right people stay.", 0.2)], 1.8, "warm"),
]

def build():
    timeline, t0, n = [], 0.0, 0
    for shot, lines, tail, cue in SCRIPT:
        cur, spoken = 0.0, []
        for who, s, start in lines:
            n += 1
            dur = ep_c.say(f"l{n:02d}", who, s)
            at = start if start is not None else cur + 0.35
            spoken.append((f"{DIR}/l{n:02d}.mp3", t0 + at, at, at + dur, s))
            cur = at + dur
        length = max(cur + tail, 1.2)
        timeline.append((shot, t0, length, spoken, cue))
        t0 += length
    return timeline, t0

def render(timeline):
    out = subprocess.Popen(["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", f"{DIR}/v.mp4"], stdin=subprocess.PIPE)
    for shot, start, length, spoken, _ in timeline:
        for i in range(int(round(length * FPS))):
            t = i / FPS
            img = Image.new("RGB", (W * S, H * S), BG)
            d = ImageDraw.Draw(img)
            shot(d, t)
            for _, _, a, b, s in spoken:
                if a - 0.05 <= t <= b + 0.25: sub(d, s)
            out.stdin.write(img.resize((W, H), Image.LANCZOS).tobytes())
    out.stdin.close(); out.wait()

def audio(timeline, total):
    st = [start for _, start, _, _, _ in timeline]
    cues = [  # (file, at, volume)
        (f"{SFX}/1489.mp3", st[1] - 0.25, 0.6),            # whoosh into the flashback
        (f"{SFX}/2364.mp3", st[3] + 0.1, 0.8),             # tick
        (f"{SFX}/2393.mp3", st[4] + 0.1, 0.5),             # rain starts
        (f"{SFX}/1489.mp3", st[5] + 2.5, 0.5),             # jacket swish
        (f"{SFX}/744.mp3", st[6] + 0.5, 0.6),              # sad trombone
        (f"{SFX}/2364.mp3", st[7] + 0.05, 0.8),            # strike
        (f"{SFX}/2894.mp3", st[8] + 1.0, 0.8),             # boing
        (f"{SFX}/2885.mp3", st[8] + 1.4, 0.45),            # she giggles
        (f"{SFX}/2364.mp3", st[9] + 0.05, 0.8),            # strike
        (f"{SFX}/2256.mp3", st[11] + 6.5, 0.35),           # heart bells
        (f"{SFX}/1489.mp3", st[12] - 0.2, 0.6),            # time jump
        (f"{SFX}/1263.mp3", st[13], 0.35),                 # rain on the bench, years later
    ]
    rain_loop = (f"{SFX}/2393.mp3", st[4] + 1.0, total - st[4] - 1.0)
    silence_at = next(s for _, s, _, _, c in timeline if c == "silence")
    warm_at = next(s for _, s, _, _, c in timeline if c == "warm")
    voices = [(p, at) for _, _, _, spoken, _ in timeline for p, at, _, _, _ in spoken]
    inputs = ["-i", f"{DIR}/v.mp4", "-i", "/tmp/claude-0/yt/cartoon/music/595.mp3", "-i", "/tmp/claude-0/yt/cartoon/music/544.mp3",
              "-stream_loop", "-1", "-i", rain_loop[0]]
    fc = [f"[1:a]atrim=0:{silence_at + 0.3},afade=t=out:st={silence_at - 0.3}:d=0.6,volume=0.22[q]",
          f"[2:a]atrim=0:{total - warm_at},afade=t=in:d=1.5,afade=t=out:st={total - warm_at - 2}:d=2,volume=0.42,adelay={int(warm_at * 1000)}:all=1[w]",
          f"[3:a]atrim=0:{rain_loop[2]},volume=0.18,afade=t=in:d=1,adelay={int(rain_loop[1] * 1000)}:all=1[r]"]
    labels = ["[q]", "[w]", "[r]"]
    k = 4
    for path, at, vol in cues:
        inputs += ["-i", path]; fc.append(f"[{k}:a]volume={vol},adelay={int(at * 1000)}:all=1[e{k}]"); labels.append(f"[e{k}]"); k += 1
    for path, at in voices:
        inputs += ["-i", path]; fc.append(f"[{k}:a]volume=1.7,adelay={int(at * 1000)}:all=1[e{k}]"); labels.append(f"[e{k}]"); k += 1
    fc.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{total},loudnorm=I=-14:TP=-1.5[a]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", f"{DIR}/the_sticks_ep1_v2.mp4"], check=True)

if __name__ == "__main__":
    tl, total = build()
    print("length", round(total, 1))
    render(tl)
    audio(tl, total)
    print("done")
