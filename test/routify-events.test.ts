import { describe, expect, it } from "vitest";
import { routifyEventMessage, routifyTokenOk } from "../src/lib/routifyEvents.js";

// Routify reports tester feedback and server errors; the Brain passes them to Jarne on Telegram (27 Nov).
describe("routifyTokenOk", () => {
  it("accepts only the shared stats token", () => {
    expect(routifyTokenOk("abc", "abc")).toBe(true);
    expect(routifyTokenOk("abd", "abc")).toBe(false);
    expect(routifyTokenOk(undefined, "abc")).toBe(false);
    expect(routifyTokenOk("abc", "")).toBe(false);
  });
});

describe("routifyEventMessage", () => {
  it("turns feedback into a Telegram message with kind, page and contact", () => {
    expect(routifyEventMessage({ kind: "feedback", type: "bug", message: "Map is empty on day 2", page: "/trips/x", email: "t@example.com" }))
      .toBe("💬 Routify-feedback (bug)\nMap is empty on day 2\nPagina: /trips/x\nVan: t@example.com");
  });
  it("turns an error into an alert, and refuses anything else", () => {
    expect(routifyEventMessage({ kind: "error", message: "Prisma P1001: database unreachable" })).toBe("🚨 Routify-fout\nPrisma P1001: database unreachable");
    expect(routifyEventMessage({ kind: "spam", message: "x" })).toBeNull();
    expect(routifyEventMessage({ kind: "feedback", message: "" })).toBeNull();
  });
});
