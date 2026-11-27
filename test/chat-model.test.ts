import { describe, expect, it } from "vitest";
import { chatModelFor } from "../src/lib/chatModel.js";

// Jarne, 27 Nov: cheaper chat, but advice must not get worse.
describe("chatModelFor", () => {
  const m = { top: "TOP", chat: "MID" };
  it("answers everyday questions on the cheaper model", () => {
    expect(chatModelFor("Hoeveel verkopen vandaag?", false, m)).toBe("MID");
  });
  it("uses the top model for files, long questions and when Jarne asks to think hard", () => {
    expect(chatModelFor("kijk hiernaar", true, m)).toBe("TOP");
    expect(chatModelFor("x".repeat(600), false, m)).toBe("TOP");
    expect(chatModelFor("Denk goed na: moeten we stoppen met eBay?", false, m)).toBe("TOP");
    expect(chatModelFor("Think hard about our pricing", false, m)).toBe("TOP");
  });
});
