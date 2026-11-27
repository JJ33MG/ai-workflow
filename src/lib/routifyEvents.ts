// Routify tells the Brain about tester feedback and server errors (27 Nov, ready for testers); the Brain passes
// them to Jarne on Telegram. Routify signs with the same token the Brain uses to read its numbers.
import { timingSafeEqual } from "node:crypto";

export function routifyTokenOk(header: unknown, configured: string): boolean {
  if (!configured || typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function routifyEventMessage(body: Record<string, unknown>): string | null {
  const message = clip(body.message, 1500);
  if (!message) return null;
  if (body.kind === "feedback") {
    const type = clip(body.type, 20) || "overig";
    const page = clip(body.page, 200);
    const email = clip(body.email, 120);
    return [`💬 RoamGem-feedback (${type})`, message, page && `Pagina: ${page}`, email && `Van: ${email}`].filter(Boolean).join("\n");
  }
  if (body.kind === "error") return `🚨 RoamGem-fout\n${message}`;
  return null;
}
