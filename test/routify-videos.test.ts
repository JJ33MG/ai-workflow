import { describe, expect, it } from "vitest";
import { VideoPlanSchema, formatVideoPlan, launchPhase } from "../src/lib/routifyVideos.js";

const plan = VideoPlanSchema.parse({
  series: "teaser",
  title: "The app that checks every stop",
  hook: "ChatGPT invented this campsite.",
  durationSec: 18,
  scenes: [
    { sec: "0-2", visual: "Screen: a chatbot answer with a campsite name", onScreenText: "ChatGPT invented this campsite", voiceover: "" },
    { sec: "2-10", visual: "Routify globe turns and draws the route Ghent to Annecy", onScreenText: "Routify checks every stop", voiceover: "" },
  ],
  caption: "Coming in December. Follow so you do not miss it.",
  hashtags: ["roadtrip", "vanlife"],
  sound: "Trending upbeat travel sound",
  cta: "Follow for the launch",
  whyItWorks: "Pattern interrupt plus a clear problem every AI user knows.",
});

describe("Routify video plans", () => {
  it("formats a plan for Telegram with the hook, every scene and the caption", () => {
    const text = formatVideoPlan(plan, 1);
    expect(text).toContain("ChatGPT invented this campsite.");
    expect(text).toContain("0-2");
    expect(text).toContain("Routify checks every stop");
    expect(text).toContain("#roadtrip #vanlife");
  });

  it("knows the launch phase: teasers before the soft launch on 15 December, then live", () => {
    expect(launchPhase(new Date("2026-11-27T10:00:00Z"))).toBe("teaser");
    expect(launchPhase(new Date("2026-12-16T10:00:00Z"))).toBe("live");
  });
});
