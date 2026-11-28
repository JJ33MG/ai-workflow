# The Sticks: prototype renderer (28 Nov 2026)

A stick-figure family channel (second income stream, not RoamGem). These Python scripts draw the figures with code
(Pillow, 1080×1920, 2× supersampled) so characters look identical every episode, and mix voice, music and effects with ffmpeg.

- `ep1.py`: drawing kit (figure with poses, bubbles, captions, simple synth effects). The others import it.
- `ep_c.py`: voiced version (ElevenLabs, key injected by the cloud proxy as `xi-api-key`); voices in `VOICES`.
- `ep_c2.py`: "The Plan" (brows, red jacket accent, real Mixkit effects).
- `ep_d.py`: the montage format Jarne liked best so far: "He never said I love you. He said it like this." 28 s, music only, ends with "Who does this for you? Tag them."
- `ep_moving.py`: earlier test.

Assets (free Mixkit licence), downloaded to /tmp/claude-0/yt/cartoon/{music,sfx}:
- music: https://assets.mixkit.co/music/ID/ID.mp3 with 545 "Rebecca on the Shore" (montage, start at 6 s), 544, 546, 595 "Quirky".
- effects: https://assets.mixkit.co/active_storage/sfx/ID/ID-preview.mp3 with 2393 light rain, 1263 rain on umbrella,
  2364 pop, 2894 boing, 744 sad trombone, 2885 giggle, 2256 bells, 1489 whoosh.

What we learned: top family animations (4.9M views, ItsMinidoodle) are 25–38 s montages of small relatable moments on one
emotional track, no narration, ending with a question. Next step: Jarne picks the format, then build the daily pipeline in
the Brain (script → render → quality check → Telegram approval → post).
