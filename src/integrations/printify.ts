// Printify: a second print-on-demand supplier next to Printful (cheaper hoodies and sweaters, more
// products, print providers in Europe). Jarne connected Printify to the Etsy shop; this talks to its API.
import { config } from "../config.js";

const API = "https://api.printify.com/v1";

export const isPrintifyConfigured = () => Boolean(config.printify.token);

async function printify<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.printify.token}`,
      "user-agent": "ai-agency-brain",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Printify ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export interface PrintifyShop {
  id: number;
  title: string;
  sales_channel: string;
}

export const listShops = () => printify<PrintifyShop[]>("GET", "/shops.json");

export interface Blueprint {
  id: number;
  title: string;
  brand: string;
  model: string;
}

export const listBlueprints = () => printify<Blueprint[]>("GET", "/catalog/blueprints.json");

export interface PrintProvider {
  id: number;
  title: string;
  location?: { country?: string };
}

export const providersFor = (blueprintId: number) =>
  printify<PrintProvider[]>("GET", `/catalog/blueprints/${blueprintId}/print_providers.json`);

export const variantsFor = (blueprintId: number, providerId: number) =>
  printify<{ variants: { id: number; title: string; options: Record<string, string> }[] }>(
    "GET",
    `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`,
  );

export const shippingFor = (blueprintId: number, providerId: number) =>
  printify<{ handling_time?: { value: number; unit: string }; profiles: { variant_ids: number[]; first_item: { cost: number; currency: string }; countries: string[] }[] }>(
    "GET",
    `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/shipping.json`,
  );

/** One print provider with its address (the blueprint's provider list has only id and title). */
export const providerDetail = (providerId: number) =>
  printify<PrintProvider & { location?: { country?: string; city?: string } }>("GET", `/catalog/print_providers/${providerId}.json`);

export interface PrintifyProduct {
  id: string;
  title: string;
  description: string;
  tags: string[];
  blueprint_id: number;
  print_provider_id: number;
  visible: boolean;
  is_locked?: boolean;
  images: { src: string; variant_ids: number[]; position: string; is_default: boolean }[];
  variants: { id: number; price: number; cost?: number; is_enabled: boolean; title: string }[];
  print_areas?: { placeholders: { position: string; images: { id: string; x: number; y: number; scale: number; angle: number }[] }[] }[];
  external?: { id: string; handle: string } | null;
}

export const listProducts = (shopId: number) =>
  printify<{ data: PrintifyProduct[] }>("GET", `/shops/${shopId}/products.json?limit=50`).then((r) => r.data);
