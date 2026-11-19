import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MIN_SECONDS, ffmpegArgs, makeListingVideo, videoLength } from "../src/lib/video.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
})();

const photo = (color: string, h = 1600) => sharp({ create: { width: 2000, height: h, channels: 3, background: color } }).png().toBuffer();

describe("listing video", () => {
  it("stays within Etsy's 5-15 seconds for 1 to 4 photos", () => {
    for (const n of [1, 2, 3, 4]) {
      expect(videoLength(n)).toBeGreaterThanOrEqual(MIN_SECONDS);
      expect(videoLength(n)).toBeLessThanOrEqual(15);
    }
  });

  it("chains a fade between every pair of photos, with no sound", () => {
    const args = ffmpegArgs(["a.jpg", "b.jpg", "c.jpg"], "out.mp4");
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph.match(/xfade/g)).toHaveLength(2);
    expect(graph).toContain("[out]");
    expect(args).toContain("-an");
    expect(ffmpegArgs(["a.jpg"], "o.mp4")[ffmpegArgs(["a.jpg"], "o.mp4").indexOf("-filter_complex") + 1]).toMatch(/\[out\]$/);
  });

  it.skipIf(!hasFfmpeg)("renders a square MP4 of the expected length", async () => {
    for (const n of [1, 4]) {
      const photos = await Promise.all(["#c33", "#3c3", "#33c", "#cc3"].slice(0, n).map((c, i) => photo(c, 1500 + i * 100)));
      const video = await makeListingVideo(photos);
      const file = join(mkdtempSync(join(tmpdir(), "vt-")), "v.mp4");
      writeFileSync(file, video);
      const [w, h, d] = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", file])
        .toString()
        .split(/[\n,]/)
        .filter(Boolean)
        .map(Number);
      expect([w, h]).toEqual([1080, 1080]);
      expect(Math.abs(d - videoLength(n))).toBeLessThan(0.3);
      expect(video.length).toBeLessThan(20 * 1024 * 1024);
    }
  }, 120_000);
});
