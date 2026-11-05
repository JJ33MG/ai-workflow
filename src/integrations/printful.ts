import { config } from "../config.js";

const API = "https://api.printful.com";

/**
 * Which store, product and variant the agent orders. Set by hand (PRINTFUL_* variables) or,
 * normally, found automatically by findPrintfulSetup() and loaded from the database at startup.
 */
export const pf = {
  storeId: config.printful.storeId,
  productId: config.printful.productId,
  variantId: config.printful.variantId,
  placement: config.printful.placement,
};

export const hasPrintfulToken = () => Boolean(config.printful.token);
export const isPrintfulConfigured = () => Boolean(config.printful.token && pf.productId && pf.variantId);

async function printful<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${config.printful.token}` };
  if (pf.storeId) headers["X-PF-Store-Id"] = pf.storeId;
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

export interface PrintfulStore {
  id: number;
  name: string;
  type: string; // "native" is a Manual order / API store; others are platform integrations (etsy, shopify…)
}

/** Stores the token can see (an account-level token sees all; a store token sees one). */
export const listStores = () => printful<PrintfulStore[]>("GET", "/stores");

/** The whole Printful catalogue (id, title, type of every product). */
export const listCatalog = () => printful<{ id: number; title: string; type: string }[]>("GET", "/products");

export interface PrintfileInfo {
  printfiles: { printfile_id: number; width: number; height: number; dpi: number }[];
  variant_printfiles: { variant_id: number; placements: Record<string, number> }[];
}

export const getPrintfiles = (productId: number) =>
  printful<PrintfileInfo>("GET", `/mockup-generator/printfiles/${productId}`);

/** Generates a product mockup from a public design URL. Polls until done (max ~2 min). */
/** `size` is the full print file in pixels; the design covers the whole print area. */
export async function generateMockup(designUrl: string, size: { width: number; height: number }): Promise<string[]> {
  const { task_key } = await printful<{ task_key: string }>(
    "POST",
    `/mockup-generator/create-task/${pf.productId}`,
    {
      variant_ids: [pf.variantId],
      format: "jpg",
      files: [
        {
          placement: pf.placement,
          image_url: designUrl,
          position: { area_width: size.width, area_height: size.height, width: size.width, height: size.height, top: 0, left: 0 },
        },
      ],
    },
  );
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const task = await printful<{
      status: string;
      error?: string;
      mockups?: { mockup_url: string; extra?: { url: string }[] }[];
    }>(
      "GET",
      `/mockup-generator/task?task_key=${encodeURIComponent(task_key)}`,
    );
    // Each mockup has its main photo plus "extra" angles (left, right, in use).
    if (task.status === "completed") {
      return (task.mockups ?? []).flatMap((m) => [m.mockup_url, ...(m.extra ?? []).map((e) => e.url)]).filter(Boolean);
    }
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
      files: [{ type: pf.placement, url: i.fileUrl }],
    })),
  });
}

export const confirmOrder = (orderId: number) => printful<DraftOrder>("POST", `/orders/${orderId}/confirm`);
