"""The Sticks, episode 1: their first date was a disaster. Voiced (ElevenLabs), music follows the story."""
import json, math, os, subprocess, sys, wave, urllib.request
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, "/tmp/claude-0/yt/cartoon")
import ep1
from ep1 import W, H, S, FPS, BG, INK, GREY, GROUND, STAND, font, line, circle, rect, text, figure, bubble, ease, tone, noise

DIR = "/tmp/claude-0/yt/cartoon/c"
os.makedirs(DIR, exist_ok=True)
WHITE = (255, 255, 255)
VOICES = {"N": "JBFqnCBsd6RMkjVDRZzb", "HIM": "bIHbv24MWmeRgasZH58o", "HER": "cgSgspJ2msm6clMCkdW9", "OLDHIM": "pqHfZKP75CvOlQylNhV4", "OLDHER": "EXAVITQu4vr4xnSDxMaL"}

# ---------- camera ----------
CAM = {"x": 540, "z": 1.35}
def P(x, y): return ((540 + (x - CAM["x"]) * CAM["z"]) * S, (GROUND + (y - GROUND) * CAM["z"]) * S)
ep1.P = P

def cam(x, z): CAM["x"], CAM["z"] = x, z; ep1.Z = z

# ---------- voice ----------
def say(key, who, line_text):
    path = f"{DIR}/{key}.mp3"
    if not os.path.exists(path):
        body = json.dumps({"text": line_text, "model_id": "eleven_multilingual_v2",
                           "voice_settings": {"stability": 0.35, "similarity_boost": 0.8, "style": 0.35, "use_speaker_boost": True}}).encode()
        req = urllib.request.Request(f"https://api.elevenlabs.io/v1/text-to-speech/{VOICES[who]}?output_format=mp3_44100_128", data=body,
                                     headers={"xi-api-key": "proxy-injected", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r: open(path, "wb").write(r.read())
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))

# ---------- characters ----------
def him(d, hip, pose=None, face="neutral", flip=1, lean=0, old=False, wet=False):
    f = figure(d, hip, pose, face=face, flip=flip, lean=lean)
    hx, hy = f["head"]
    col = (160, 160, 160) if old else INK
    for k in (-24, -8, 8, 24):  # spiky hair
        line(d, (hx + k, hy - 40 + abs(k) * 0.2), (hx + k * 1.25, hy - 64 + abs(k) * 0.4), w=6, fill=col)
    if wet:
        for k in (-30, 34): d.ellipse([P(hx + k - 5, hy + 30), P(hx + k + 5, hy + 44)], fill=INK)
    return f

def her(d, hip, pose=None, face="smile", flip=1, lean=0, old=False):
    f = figure(d, hip, pose, face=face, flip=flip, lean=lean)
    hx, hy = f["head"]
    col = (160, 160, 160) if old else INK
    for side in (-1, 1):  # long hair
        line(d, (hx + side * 40, hy - 18), (hx + side * 52, hy + 70), w=8, fill=col)
    d.arc([P(hx - 46, hy - 48), P(hx + 46, hy + 40)], 190, 350, fill=col, width=int(12 * S * CAM["z"]))
    if old:
        for dx in (-15, 15): circle(d, (hx + 8 * flip + dx, hy - 5), 12, w=4)
    return f

# ---------- props ----------
def rain(d, t, n=40, heavy=1.0):
    rng = np.random.default_rng(7)
    xs, ph = rng.uniform(-300, 1400, n), rng.uniform(0, 1, n)
    for x, p in zip(xs, ph):
        y = 300 + ((t * 1.6 * heavy + p) % 1) * 1000
        line(d, (x, y), (x - 10, y + 40), w=4, fill=(120, 120, 120))

SEAT = 1100
def bench(d, x0, x1):
    rect(d, (x0, SEAT - 6), (x1, SEAT + 18), w=7, fill=BG, radius=6)
    for x in (x0 + 25, x1 - 25): line(d, (x, SEAT + 18), (x, GROUND), w=8)

def lamppost(d, x):
    line(d, (x, GROUND), (x, 820), w=10); line(d, (x, 820), (x + 60, 820), w=8)
    d.polygon([P(x + 40, 820), P(x + 80, 820), P(x + 90, 850), P(x + 30, 850)], fill=INK)

def restaurant(d, x0=520, x1=1000, closed=0.0):
    rect(d, (x0, 860), (x1, GROUND), w=8, fill=BG)
    text(d, ((x0 + x1) / 2, 905), "LUIGI'S", font("Black", 44))
    rect(d, (x0 + 40, 1000), (x0 + 150, GROUND), w=7)
    sx, sy = x0 + 270, 1060
    flipw = abs(math.cos(math.pi * closed))
    rect(d, (sx - 90 * flipw, sy - 40), (sx + 90 * flipw, sy + 40), w=6, fill=WHITE, radius=8)
    if flipw > 0.3: text(d, (sx, sy), "OPEN" if closed < 0.5 else "CLOSED", font("Black", 40))

def umbrella(d, x, y, flipped=0.0):
    line(d, (x, y), (x, y + 120), w=6)
    k = 1 - 2 * ease(flipped)
    pts = [P(x - 90, y + 8 * k), P(x - 50, y - 36 * k), P(x, y - 48 * k), P(x + 50, y - 36 * k), P(x + 90, y + 8 * k)]
    d.line(pts, fill=INK, width=int(8 * S * CAM["z"]), joint="curve")
    d.line([pts[0], P(x, y), pts[-1]], fill=INK, width=int(5 * S * CAM["z"]))

def fries_stand(d, x):
    rect(d, (x - 110, 960), (x + 110, GROUND), w=8, fill=BG)
    rect(d, (x - 130, 900), (x + 130, 960), w=7, fill=INK)
    text(d, (x, 930), "FRIES", font("Black", 40), fill=WHITE)

def fries(d, x, y):
    for k in range(5): line(d, (x - 14 + k * 7, y), (x - 18 + k * 9, y - 34), w=4)
    d.polygon([P(x - 22, y), P(x + 22, y), P(x + 14, y + 40), P(x - 14, y + 40)], fill=INK)

def heart(d, x, y, s=1.0):
    d.ellipse([P(x - 22 * s, y - 14 * s), P(x, y + 8 * s)], fill=INK); d.ellipse([P(x, y - 14 * s), P(x + 22 * s, y + 8 * s)], fill=INK)
    d.polygon([P(x - 21 * s, y + 2 * s), P(x + 21 * s, y + 2 * s), P(x, y + 28 * s)], fill=INK)

def sub(d, s):  # spoken line as subtitle
    import textwrap
    for i, l in enumerate(textwrap.wrap(s, 24)):
        text(d, (W / 2, 1540 + i * 80), l, font("ExtraBold", 62), world=False)

def tag(d, s):  # small top label like a time stamp
    text(d, (W / 2, 240), s, font("Black", 56), world=False)

# ---------- shots ----------
def sit_pose(arm=None):
    p = {"lh": 38, "lk": -38, "rh": -38, "rk": 38, "ls": 22, "le": 12, "rs": -22, "re": -12}
    p.update(arm or {}); return p

def shot_hook(d, t):
    cam(540, 1.5); rain(d, t)
    bench(d, 330, 750)
    him(d, (470, 1085 - 0), sit_pose(), face="neutral", wet=True)
    her(d, (610, 1085 - 0), sit_pose(), face="neutral", flip=-1)
    fries(d, 540, SEAT - 8)
    tag(d, "THE STICKS · EP. 1")

def shot_early(d, t):
    cam(500, 1.45); lamppost(d, 330); restaurant(d)
    bow = 35 * ease((t - 2.0) / 0.4) if t > 2.0 else 0
    him(d, (430, STAND), {"rs": -30, "ls": 40 if t < 1.2 else 70, "le": 30}, face="smile", flip=-1, lean=bow)
    tag(d, "6:28 PM")

def shot_rain(d, t):
    cam(540, 1.45); lamppost(d, 330); restaurant(d)
    rain(d, t, n=int(10 + 50 * ease(t / 0.8)))
    flipped = ease((t - 1.6) / 0.25)
    f = him(d, (450, STAND), {"rs": -150, "re": 10}, face="o" if t > 1.6 else "neutral", flip=1)
    hx, hy = f["r"]
    umbrella(d, hx, hy - 120, flipped)

def shot_arrive(d, t):
    cam(540, 1.45); restaurant(d); rain(d, t)
    run = ease(t / 0.9)
    her(d, (1150 - 450 * run, STAND), {"ls": 170, "le": 10, "rs": -170, "re": -10}, face="big", flip=-1, lean=8 if t < 0.9 else 0)
    f = him(d, (420, STAND), {"rs": -60, "re": 10}, face="smile" if t > 1.8 else "neutral", wet=True)
    umbrella(d, f["r"][0], f["r"][1] - 120, 1.0)

def shot_closed(d, t):
    cam(760, 1.9); rain(d, t)
    restaurant(d, closed=ease((t - 0.3) / 0.5))

def shot_fries(d, t, ruined=False):
    cam(540, 1.45 if not ruined else 1.75); rain(d, t, heavy=0.6)
    fries_stand(d, 900); bench(d, 300, 700)
    him(d, (430, 1085 - 0), sit_pose({"rs": 60, "re": 60}), face="sad" if ruined else "neutral", wet=True)
    her(d, (580, 1085 - 0), sit_pose(), face="neutral", flip=-1)
    fries(d, 505, SEAT - 8)

def shot_best(d, t):
    cam(500, 1.85); rain(d, t, heavy=0.5)
    bench(d, 300, 700)
    lean = 14 * ease((t - 1.6) / 0.6)
    him(d, (430, 1085 - 0), sit_pose({"rs": 60, "re": 60}), face="o" if t < 2.4 else "smile", wet=True)
    her(d, (580 - 20 * ease((t - 1.6) / 0.6), 1085 - 0), sit_pose(), face="smile", flip=-1, lean=lean)
    if t > 2.6: heart(d, 505, 790 - 40 * ease((t - 2.6) / 0.8), 1.0 + 0.3 * math.sin(t * 6))

def shot_years(d, t):
    text(d, (W / 2, 900), "30 YEARS", font("Black", 130), world=False)
    text(d, (W / 2, 1040), "LATER", font("Black", 130), world=False)

def shot_old(d, t):
    cam(540, 1.45); rain(d, t)
    fries_stand(d, 900); bench(d, 300, 700)
    f = him(d, (430, 1085 - 0), sit_pose({"rs": -150, "re": 10}), face="big" if t > 1.4 else "smile", old=True)
    umbrella(d, f["r"][0], f["r"][1] - 120, ease((t - 1.1) / 0.25))
    line(d, (360, 1060), (335, GROUND), w=6)  # cane
    her(d, (580, 1085 - 0), sit_pose(), face="big" if t > 1.4 else "smile", flip=-1, old=True)
    if t > 1.4:
        text(d, (430, 760), "ha ha", font("Bold", 34)); text(d, (600, 740), "ha!", font("Bold", 34))

def shot_end(d, t):
    shot_old(d, t + 4)
    text(d, (W / 2, 330), "Follow The Sticks", font("Black", 64), world=False)

# script: (shot, [(who, line, start)], extra seconds after the last line, music cue)
SCRIPT = [
    (shot_hook, [("N", "Their first date was a disaster.", 0.2), ("N", "Here's why it worked.", None)], 0.5, "quirky"),
    (shot_early, [("N", "He showed up thirty minutes early.", 0.1), ("HIM", "Hi. Hey... Hello, madam.", None)], 0.6, "quirky"),
    (shot_rain, [("N", "Then it started to rain.", 0.2)], 1.4, "quirky"),
    (shot_arrive, [("HER", "Hi! Sorry I'm late!", 0.6), ("HIM", "No, no. I just got here.", None)], 0.6, "quirky"),
    (shot_closed, [("N", "The restaurant was closed.", 0.3)], 1.0, "quirky"),
    (shot_fries, [("N", "So they got fries.", 0.2)], 0.6, "quirky"),
    (lambda d, t: shot_fries(d, t, True), [("HIM", "I'm sorry. I ruined it.", 0.4)], 1.0, "silence"),
    (shot_best, [("HER", "Are you kidding? Best date I've ever had.", 0.4)], 1.4, "warm"),
    (shot_years, [], 1.6, "warm"),
    (shot_old, [("OLDHIM", "Best date ever?", 2.0), ("OLDHER", "Still.", None)], 0.8, "warm"),
    (shot_end, [("N", "Some things never change.", 0.2)], 1.6, "warm"),
]

def build():
    timeline, t0, n = [], 0.0, 0
    for shot, lines, tail, cue in SCRIPT:
        cur, spoken = 0.0, []
        for who, s, start in lines:
            n += 1
            dur = say(f"l{n:02d}", who, s)
            at = start if start is not None else cur + 0.25
            spoken.append((f"{DIR}/l{n:02d}.mp3", t0 + at, at, at + dur, s))
            cur = at + dur
        length = max(cur + tail, 1.6)
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
    SR = 44100
    mix = np.zeros(int((total + 1) * SR))
    def put(at, snd, vol=1.0):
        i = int(at * SR); mix[i:i + len(snd)] += vol * snd[: len(mix) - i]
    st = {s.__name__ if hasattr(s, "__name__") else str(k): (start, length) for k, (s, start, length, _, _) in enumerate(timeline)}
    starts = [start for _, start, _, _, _ in timeline]
    put(starts[1] - 0.5, np.linspace(1, 0, int(0.5 * SR)) * np.sin(np.linspace(0, 900, int(0.5 * SR)) ** 1.3) * 0.25)  # rewind
    put(starts[2] + 0.2, noise(2.5, 0.1)); put(starts[2] + 1.6, tone([300, 900, 500, 700], 0.35, "sine", 0.45))  # rain + umbrella boing
    put(starts[3] + 0.0, noise(0.8, 0.12))  # running splashes
    put(starts[4] + 0.3, tone([500, 800], 0.08, "sine", 0.3)); put(starts[4] + 0.9, tone([392, 380], 0.35, "saw", 0.16)); put(starts[4] + 1.3, tone([370, 300], 0.8, "saw", 0.16))
    put(starts[7] + 2.6, tone([1320], 0.15, "sine", 0.3)); put(starts[7] + 2.75, tone([1760], 0.3, "sine", 0.3))  # heart
    put(starts[8] + 0.1, tone([880, 1320], 0.6, "sine", 0.25))  # time jump chime
    put(starts[9] + 1.1, tone([300, 900, 500, 700], 0.35, "sine", 0.45))  # umbrella again
    mix = np.clip(mix, -1, 1)
    with wave.open(f"{DIR}/sfx.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((mix * 32767).astype(np.int16).tobytes())

    # music: quirky until the apology, silence, then warm from her answer
    silence_at = next(start for _, start, _, _, cue in timeline if cue == "silence")
    warm_at = next(start for _, start, _, _, cue in timeline if cue == "warm")
    inputs = ["-i", f"{DIR}/v.mp4", "-i", "/tmp/claude-0/yt/cartoon/music/595.mp3", "-i", "/tmp/claude-0/yt/cartoon/music/544.mp3", "-i", f"{DIR}/sfx.wav"]
    voices = [(p, at) for _, start, _, spoken, _ in timeline for p, at, _, _, _ in spoken]
    for p, _ in voices: inputs += ["-i", p]
    fc = [f"[1:a]atrim=0:{silence_at + 0.3},afade=t=out:st={silence_at - 0.2}:d=0.5,volume=0.28[q]",
          f"[2:a]atrim=0:{total - warm_at},afade=t=in:d=1.2,afade=t=out:st={total - warm_at - 2}:d=2,volume=0.45,adelay={int(warm_at * 1000)}:all=1[w]",
          "[3:a]volume=1[s]"]
    labels = ["[q]", "[w]", "[s]"]
    for k, (_, at) in enumerate(voices):
        fc.append(f"[{4 + k}:a]adelay={int(at * 1000)}:all=1,volume=1.6[v{k}]"); labels.append(f"[v{k}]")
    fc.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0:duration=longest,atrim=0:{total},loudnorm=I=-14:TP=-1.5[a]")
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(fc), "-map", "0:v", "-map", "[a]",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", f"{DIR}/the_sticks_ep1.mp4"], check=True)

if __name__ == "__main__":
    tl, total = build()
    print("length", round(total, 1))
    render(tl)
    audio(tl, total)
    print("done")
