// Finds everything the Etsy agent needs from Printful, so nothing has to be looked up by hand:
// the API store to order through, the 11 oz White Glossy Mug, its variant, and the exact
// print-file size. Saved in the database and loaded at every startup.
import { getSetting, setSetting } from "../db.js";
import {
  getCatalogProduct,
  getPrintfiles,
  listCatalog,
  listStores,
  pf,
  type CatalogProduct,
  type PrintfileInfo,
  type PrintfulStore,
} from "../integrations/printful.js";
import { setPrintSize } from "./design.js";

const KEY = "printful.setup";
const MUG_TITLE = /white glossy mug/i;
const MUG_SIZE = /11\s*oz/i;

export interface PrintfulSetup {
  storeId: string;
  storeName: string;
  productId: number;
  variantId: number;
  placement: string;
  printWidth: number;
  printHeight: number;
}

/** Orders are placed through a Manual order / API store ("native"), never through the Etsy-linked store. */
export function pickStore(stores: PrintfulStore[]): PrintfulStore | null {
  return stores.find((s) => s.type === "native") ?? null;
}

export function pickMugProduct(catalog: { id: number; title: string }[]): { id: number; title: string } | null {
  return catalog.find((p) => MUG_TITLE.test(p.title)) ?? null;
}

export function pickMugVariant(product: CatalogProduct): CatalogProduct["variants"][number] | null {
  return product.variants.find((v) => MUG_SIZE.test(v.size) || MUG_SIZE.test(v.name)) ?? null;
}

export function printfileFor(info: PrintfileInfo, variantId: number): { placement: string; width: number; height: number } | null {
  const placements = info.variant_printfiles.find((v) => v.variant_id === variantId)?.placements ?? {};
  const placement = "default" in placements ? "default" : Object.keys(placements)[0];
  if (!placement) return null;
  const file = info.printfiles.find((f) => f.printfile_id === placements[placement]);
  return file ? { placement, width: file.width, height: file.height } : null;
}

function apply(s: PrintfulSetup) {
  pf.storeId = s.storeId;
  pf.productId = s.productId;
  pf.variantId = s.variantId;
  pf.placement = s.placement;
  setPrintSize(s.printWidth, s.printHeight);
}

/** Loads a saved setup at startup. Returns false when it still has to be looked up. */
export async function loadPrintfulSetup(): Promise<boolean> {
  const saved = await getSetting<PrintfulSetup>(KEY);
  if (saved) apply(saved);
  return Boolean(saved);
}

/** Asks Printful for the store, product, variant and print size, saves and applies them. */
export async function findPrintfulSetup(): Promise<PrintfulSetup> {
  const stores = await listStores();
  const store = pickStore(stores);
  if (!store) {
    throw new Error(
      `No Manual order / API store found in Printful (stores: ${stores.map((s) => `${s.name} (${s.type})`).join(", ") || "none"}). ` +
        "Create one under Stores → Connect → Manual order platform / API, or use a token made for that store.",
    );
  }
  pf.storeId = String(store.id); // needed for the catalogue calls below with an account-level token
  const product = pickMugProduct(await listCatalog());
  if (!product) throw new Error("Could not find the White Glossy Mug in the Printful catalogue");
  const detail = await getCatalogProduct(product.id);
  const variant = pickMugVariant(detail);
  if (!variant) throw new Error(`No 11 oz variant found for ${product.title}`);
  const file = printfileFor(await getPrintfiles(product.id), variant.id);
  if (!file) throw new Error(`No print-file size found for ${variant.name}`);

  const setup: PrintfulSetup = {
    storeId: String(store.id),
    storeName: store.name,
    productId: product.id,
    variantId: variant.id,
    placement: file.placement,
    printWidth: file.width,
    printHeight: file.height,
  };
  await setSetting(KEY, setup);
  apply(setup);
  return setup;
}
