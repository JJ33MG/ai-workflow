// Short product videos for Etsy listings, made from the listing's own photos: a slow zoom on each
// photo with a soft fade between them. Etsy wants 5-15 seconds; sound is not used, so there is none.
// Needs ffmpeg on the machine (installed in the Dockerfile).
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);

export const VIDEO_SIZE = 1080;
const FPS = 30;
const FADE = 0.6;
/** Etsy accepts 5 to 15 seconds. */
export const MIN_SECONDS = 5;
export const MAX_PHOTOS = 4;

/** Seconds each photo is on screen: one photo alone stays long enough to reach Etsy's minimum. */
export const secondsPerPhoto = (photos: number) => (photos <= 1 ? 7 : 3.2);

export function videoLength(photos: number): number {
  const n = Math.max(1, Math.min(photos, MAX_PHOTOS));
  return n * secondsPerPhoto(n) - (n - 1) * FADE;
}

/** The ffmpeg arguments: each photo zooms in slowly, then fades into the next. */
export function ffmpegArgs(inputs: string[], output: string): string[] {
  const n = inputs.length;
  const each = secondsPerPhoto(n);
  const frames = Math.round(each * FPS);
  const args = ["-y"];
  // One still per input: zoompan turns it into all the frames of its scene.
  for (const file of inputs) args.push("-i", file);

  // Zooming a 2x upscale keeps the motion smooth instead of jumping pixel by pixel.
  const parts = inputs.map(
    (_f, i) =>
      `[${i}:v]scale=${VIDEO_SIZE * 2}:${VIDEO_SIZE * 2},` +
      `zoompan=z='min(1+0.06*on/${frames},1.06)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${VIDEO_SIZE}x${VIDEO_SIZE}:fps=${FPS},` +
      `trim=duration=${each},setpts=PTS-STARTPTS,format=yuv420p[v${i}]`,
  );
  let last = "v0";
  for (let i = 1; i < n; i++) {
    const offset = (i * (each - FADE)).toFixed(2);
    const out = i === n - 1 ? "out" : `x${i}`;
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${FADE}:offset=${offset}[${out}]`);
    last = out;
  }
  if (n === 1) parts[0] = parts[0].replace("[v0]", "[out]");

  args.push(
    "-filter_complex", parts.join(";"),
    "-map", "[out]",
    "-an",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    output,
  );
  return args;
}

/** Square JPEG on white, so photos of any shape line up in the video. */
async function squareFrame(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize(VIDEO_SIZE, VIDEO_SIZE, { fit: "contain", background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** An MP4 from up to MAX_PHOTOS photos. */
export async function makeListingVideo(photos: Buffer[]): Promise<Buffer> {
  if (!photos.length) throw new Error("No photos to make a video from");
  const dir = await mkdtemp(join(tmpdir(), "listing-video-"));
  try {
    const inputs: string[] = [];
    for (const [i, photo] of photos.slice(0, MAX_PHOTOS).entries()) {
      const file = join(dir, `photo-${i}.jpg`);
      await writeFile(file, await squareFrame(photo));
      inputs.push(file);
    }
    const output = join(dir, "video.mp4");
    await run("ffmpeg", ffmpegArgs(inputs, output), { timeout: 180_000, maxBuffer: 10 * 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await run("ffmpeg", ["-version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
