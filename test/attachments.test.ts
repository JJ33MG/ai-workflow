import { describe, expect, it } from "vitest";
import { attachmentBlocks, AttachmentError } from "../src/lib/attachments.js";

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

describe("attachmentBlocks: screenshots and PDFs for an agent", () => {
  it("turns a screenshot into an image block and a PDF into a document block", () => {
    const blocks = attachmentBlocks([
      { name: "shot.png", type: "image/png", data: b64(10) },
      { name: "invoice.pdf", type: "application/pdf", data: b64(10) },
    ]);
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: b64(10) } });
    expect(blocks[1]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" }, title: "invoice.pdf" });
  });

  it("refuses other file types, files that are too large, and more than 5 files", () => {
    expect(() => attachmentBlocks([{ name: "a.exe", type: "application/x-msdownload", data: b64(10) }])).toThrow(AttachmentError);
    expect(() => attachmentBlocks([{ name: "big.png", type: "image/png", data: b64(6 * 1024 * 1024) }])).toThrow(/te groot/);
    expect(() => attachmentBlocks(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, type: "image/png", data: b64(10) })))).toThrow(/maximaal 5/);
  });

  it("accepts no attachments", () => {
    expect(attachmentBlocks(undefined)).toEqual([]);
  });
});
