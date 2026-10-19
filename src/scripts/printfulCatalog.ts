// Look up the Printful variant id and print-file size for a catalog product:
//   npm run printful:catalog -- <productId>
import { getCatalogProduct, getPrintfiles } from "../integrations/printful.js";

const productId = Number(process.argv[2]);
if (!productId) {
  console.error("Usage: npm run printful:catalog -- <productId>  (find ids at https://www.printful.com/api)");
  process.exit(1);
}

const { product, variants } = await getCatalogProduct(productId);
console.log(`${product.id} ${product.title} (${product.type})\n`);
for (const v of variants) console.log(`variant ${v.id}  ${v.name}  base price ${v.price}`);

const files = await getPrintfiles(productId);
console.log("\nPrint files (use for POD_DESIGN_WIDTH / POD_DESIGN_HEIGHT):");
for (const f of files.printfiles) console.log(`printfile ${f.printfile_id}: ${f.width}x${f.height} @ ${f.dpi}dpi`);
for (const vp of files.variant_printfiles.slice(0, 5)) {
  console.log(`variant ${vp.variant_id} placements: ${JSON.stringify(vp.placements)}`);
}
