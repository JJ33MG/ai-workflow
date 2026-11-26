import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { attachmentBlocks, AttachmentError } from "../src/lib/attachments.js";

const b64 = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

describe("attachmentBlocks: screenshots and PDFs for an agent", () => {
  it("turns a screenshot into an image block and a PDF into a document block", async () => {
    const blocks = await attachmentBlocks([
      { name: "shot.png", type: "image/png", data: b64(10) },
      { name: "invoice.pdf", type: "application/pdf", data: b64(10) },
    ]);
    expect(blocks[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: b64(10) } });
    expect(blocks[1]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" }, title: "invoice.pdf" });
  });

  it("refuses programs, files that are too large, and more than 5 files", async () => {
    await expect(attachmentBlocks([{ name: "a.exe", type: "application/x-msdownload", data: b64(10) }])).rejects.toThrow(AttachmentError);
    await expect(attachmentBlocks([{ name: "big.png", type: "image/png", data: b64(6 * 1024 * 1024) }])).rejects.toThrow(/te groot/);
    await expect(attachmentBlocks(Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, type: "image/png", data: b64(10) })))).rejects.toThrow(/maximaal 5/);
  });

  it("accepts no attachments", async () => {
    expect(await attachmentBlocks(undefined)).toEqual([]);
  });

  it("reads an Etsy CSV export as text, whatever type the browser gives it", async () => {
    const csv = "Sale Date,Item Name,Quantity\n11/20/26,Beekeeper Mug,1\n";
    const [block] = await attachmentBlocks([{ name: "EtsySoldOrders2026-11.csv", type: "application/vnd.ms-excel", data: Buffer.from(csv).toString("base64") }]);
    expect(block).toMatchObject({ type: "document", source: { type: "text", media_type: "text/plain" }, title: "EtsySoldOrders2026-11.csv" });
    expect((block as { source: { data: string } }).source.data).toContain("Beekeeper Mug");
  });

  it("turns an Excel file into CSV text per sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Stats");
    ws.addRow(["Day", "Visits"]);
    ws.addRow(["Mon", 12]);
    const data = Buffer.from(await wb.xlsx.writeBuffer()).toString("base64");
    const [block] = await attachmentBlocks([{ name: "stats.xlsx", type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", data }]);
    expect((block as { source: { data: string } }).source.data).toContain("Sheet: Stats");
    expect((block as { source: { data: string } }).source.data).toContain("Mon,12");
  });
});
