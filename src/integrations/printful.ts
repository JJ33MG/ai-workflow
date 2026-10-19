import { config } from "../config.js";

const API = "https://api.printful.com";

export const isPrintfulConfigured = () =>
  Boolean(config.printful.token && config.printful.productId && config.printful.variantId);

async function printful<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${config.printful.token}` };
  if (config.printful.storeId) headers["X-PF-Store-Id"] = config.printful.storeId;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { code?: number; result?: T; error?: { message?: string } };
  if (!res.ok) throw new Error(`Printful ${method} ${path} failed: ${res.status} ${json.error?.message ?? ""}`);
  return json.result as T;
}

export interface CatalogProduct {
  product: { id: number; title: string; type: string };
  variants: { id: number; name: string; size: string; color: string; price: string }[];
}

export const getCatalogProduct = (productId: number) => printful<CatalogProduct>("GET", `/products/${productId}`);

export interface PrintfileInfo {
  printfiles: { printfile_id: number; width: number; height: number; dpi: number }[];
  variant_printfiles: { variant_id: number; placements: Record<string, number> }[];
}

export const getPrintfiles = (productId: number) =>
  printful<PrintfileInfo>("GET", `/mockup-generator/printfiles/${productId}`);

/** Generates a product mockup from a public design URL. Polls until done (max ~2 min). */
export async function generateMockup(designUrl: string): Promise<string[]> {
  const { task_key } = await printful<{ task_key: string }>(
    "POST",
    `/mockup-generator/create-task/${config.printful.productId}`,
    {
      variant_ids: [config.printful.variantId],
      format: "jpg",
      files: [{ placement: config.printful.placement, image_url: designUrl }],
    },
  );
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const task = await printful<{ status: string; error?: string; mockups?: { mockup_url: string }[] }>(
      "GET",
      `/mockup-generator/task?task_key=${encodeURIComponent(task_key)}`,
    );
    if (task.status === "completed") return (task.mockups ?? []).map((m) => m.mockup_url);
    if (task.status === "failed") throw new Error(`Printful mockup failed: ${task.error ?? "unknown"}`);
  }
  throw new Error("Printful mockup timed out");
}

export interface OrderRecipient {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state_code?: string;
  country_code: string;
  zip: string;
}

export interface DraftOrder {
  id: number;
  status: string;
  costs: { total: string; currency: string };
}

/** Creates a draft order. Nothing is charged until confirmOrder is called. */
export async function createDraftOrder(input: {
  externalId: string;
  recipient: OrderRecipient;
  items: { variantId: number; quantity: number; fileUrl: string }[];
}): Promise<DraftOrder> {
  return printful<DraftOrder>("POST", "/orders", {
    external_id: input.externalId,
    recipient: input.recipient,
    items: input.items.map((i) => ({
      variant_id: i.variantId,
      quantity: i.quantity,
      files: [{ type: config.printful.placement, url: i.fileUrl }],
    })),
  });
}

export const confirmOrder = (orderId: number) => printful<DraftOrder>("POST", `/orders/${orderId}/confirm`);
