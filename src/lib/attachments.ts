// Screenshots and PDFs Jarne sends to an agent (dashboard chat or Telegram), as Claude content blocks.
import type Anthropic from "@anthropic-ai/sdk";

export interface Attachment {
  name: string;
  type: string;
  /** Base64, without a data: prefix. */
  data: string;
}

export class AttachmentError extends Error {}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_FILES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export function attachmentBlocks(atts: Attachment[] | undefined): Anthropic.ContentBlockParam[] {
  if (!atts?.length) return [];
  if (atts.length > MAX_FILES) throw new AttachmentError(`Stuur maximaal ${MAX_FILES} bestanden tegelijk.`);
  return atts.map((a) => {
    const bytes = Math.floor((a.data.length * 3) / 4);
    if (IMAGE_TYPES.has(a.type)) {
      if (bytes > MAX_IMAGE_BYTES) throw new AttachmentError(`${a.name} is te groot (max 5 MB per afbeelding).`);
      return { type: "image", source: { type: "base64", media_type: a.type as "image/png", data: a.data } };
    }
    if (a.type === "application/pdf") {
      if (bytes > MAX_PDF_BYTES) throw new AttachmentError(`${a.name} is te groot (max 20 MB per PDF).`);
      return { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data }, title: a.name.slice(0, 200) };
    }
    throw new AttachmentError(`${a.name}: alleen afbeeldingen (PNG, JPG, WebP, GIF) en PDF's.`);
  });
}
