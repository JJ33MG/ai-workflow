// Files Jarne sends to an agent (dashboard chat or Telegram) as Claude content blocks: screenshots,
// PDFs, and the CSV, Excel, text and JSON files he downloads (Etsy exports, reports).
import type Anthropic from "@anthropic-ai/sdk";
import ExcelJS from "exceljs";

export interface Attachment {
  name: string;
  type: string;
  /** Base64, without a data: prefix. */
  data: string;
}

export class AttachmentError extends Error {}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const TEXT_EXT = /\.(csv|tsv|txt|json|md|html?|xml|log)$/i;
const EXCEL_EXT = /\.xlsx$/i;
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Enough for a big export; longer text is cut with a note. */
const MAX_TEXT_CHARS = 400_000;

const textDoc = (name: string, text: string): Anthropic.ContentBlockParam => ({
  type: "document",
  source: { type: "text", media_type: "text/plain", data: text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}\n…(rest cut off)` : text },
  title: name.slice(0, 200),
});

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : typeof v === "object" && "text" in (v as object) ? String((v as { text: unknown }).text) : typeof v === "object" && "result" in (v as object) ? String((v as { result: unknown }).result) : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function excelToText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const parts: string[] = [];
  wb.eachSheet((ws) => {
    const rows: string[] = [];
    ws.eachRow((row) => rows.push((row.values as unknown[]).slice(1).map(csvCell).join(",")));
    parts.push(`Sheet: ${ws.name}\n${rows.join("\n")}`);
  });
  return parts.join("\n\n");
}

export async function attachmentBlocks(atts: Attachment[] | undefined): Promise<Anthropic.ContentBlockParam[]> {
  if (!atts?.length) return [];
  if (atts.length > MAX_FILES) throw new AttachmentError(`Stuur maximaal ${MAX_FILES} bestanden tegelijk.`);
  const out: Anthropic.ContentBlockParam[] = [];
  for (const a of atts) {
    const bytes = Math.floor((a.data.length * 3) / 4);
    if (IMAGE_TYPES.has(a.type)) {
      if (bytes > MAX_IMAGE_BYTES) throw new AttachmentError(`${a.name} is te groot (max 5 MB per afbeelding).`);
      out.push({ type: "image", source: { type: "base64", media_type: a.type as "image/png", data: a.data } });
      continue;
    }
    if (bytes > MAX_FILE_BYTES) throw new AttachmentError(`${a.name} is te groot (max 20 MB).`);
    if (a.type === "application/pdf" || /\.pdf$/i.test(a.name)) {
      out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name.slice(0, 200) });
      continue;
    }
    if (EXCEL_EXT.test(a.name) || a.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      out.push(textDoc(a.name, await excelToText(Buffer.from(a.data, "base64")).catch(() => {
        throw new AttachmentError(`${a.name} kon niet als Excel-bestand gelezen worden.`);
      })));
      continue;
    }
    if (TEXT_EXT.test(a.name) || a.type.startsWith("text/") || a.type === "application/json") {
      out.push(textDoc(a.name, Buffer.from(a.data, "base64").toString("utf8")));
      continue;
    }
    throw new AttachmentError(`${a.name}: dit soort bestand kan ik niet lezen. Wel: afbeeldingen, PDF, CSV, Excel (.xlsx), tekst en JSON.`);
  }
  return out;
}
