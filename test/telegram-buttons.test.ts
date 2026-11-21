import { describe, expect, it } from "vitest";
import { approvalButtons, parseButton } from "../src/lib/telegram.js";

describe("Telegram approval buttons", () => {
  it("puts approve and reject buttons under every approval, and approve-all under publications", () => {
    expect(approvalButtons("abc", "etsy_publish")).toEqual([
      [{ text: "✅ Goedkeuren", callback_data: "approve:abc" }, { text: "❌ Afwijzen", callback_data: "reject:abc" }],
      [{ text: "✅ Alles goedkeuren (alle publicaties)", callback_data: "approve:alles" }],
    ]);
  });

  it("keeps money decisions one by one: no approve-all button", () => {
    expect(approvalButtons("xyz", "printful_order_confirm")).toEqual([
      [{ text: "✅ Goedkeuren", callback_data: "approve:xyz" }, { text: "❌ Afwijzen", callback_data: "reject:xyz" }],
    ]);
  });

  it("turns a tapped button back into a command, and ignores anything else", () => {
    expect(parseButton("approve:abc")).toEqual({ command: "approve", args: ["abc"] });
    expect(parseButton("reject:abc")).toEqual({ command: "reject", args: ["abc"] });
    expect(parseButton("approve:alles")).toEqual({ command: "approve", args: ["alles"] });
    expect(parseButton("run:etsy-pod")).toBeNull();
    expect(parseButton(undefined)).toBeNull();
  });
});
