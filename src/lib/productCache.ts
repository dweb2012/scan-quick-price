import { DolibarrProduct } from "./dolibarr";

const CACHE_KEY = "chr_product_cache";
const MAX_CACHED = 50;

interface CachedProduct {
  product: DolibarrProduct;
  cachedAt: number;
}

function readCache(): CachedProduct[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCache(items: CachedProduct[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(items.slice(0, MAX_CACHED)));
  } catch {
    // Storage full — clear and retry
    localStorage.removeItem(CACHE_KEY);
  }
}

/** Cache a product after a successful API fetch */
export function cacheProduct(product: DolibarrProduct) {
  const items = readCache();
  const filtered = items.filter(
    (c) => c.product.id !== product.id
  );
  // Store without blob URLs (they won't survive refresh)
  const toCache = { ...product, imageUrl: undefined };
  writeCache([{ product: toCache, cachedAt: Date.now() }, ...filtered]);
}

/** Look up a product from cache by barcode or ref */
export function findCachedProduct(value: string): DolibarrProduct | null {
  const items = readCache();
  const v = value.trim().toLowerCase();
  const match = items.find(
    (c) =>
      c.product.barcode?.toLowerCase() === v ||
      c.product.ref?.toLowerCase() === v
  );
  return match?.product ?? null;
}

/** Get count of cached products */
export function getCachedCount(): number {
  return readCache().length;
}
