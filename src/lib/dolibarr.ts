import { supabase } from "@/integrations/supabase/client";

/**
 * Call Dolibarr API via the edge function proxy (server-side).
 * Bypasses CORS and keeps the API key secure.
 */
async function dolibarrProxy(endpoint: string, method: string, payload?: any): Promise<any> {
  const { data, error } = await supabase.functions.invoke("dolibarr-proxy", {
    body: { endpoint, method, payload },
  });

  if (error) throw new Error(error.message || "Erreur proxy Dolibarr");
  if (data?.ok === false) throw new Error(data.error || "Erreur proxy Dolibarr");

  return data;
}

export interface DolibarrProduct {
  id: number;
  ref: string;
  label: string;
  barcode: string;
  price: string;
  price_ttc: string;
  price_min: string;
  price_min_ttc: string;
  tva_tx: string;
  stock_reel: number;
  image?: string;
  photo?: string;
  default_min_quantity_discount?: string;
  array_options?: Record<string, string>;
  imageUrl?: string;
  /** Resolved supplier name (filled after fetch) */
  supplierName?: string;
}

/** Retourne le prix HT */
export function getPriceHT(product: DolibarrProduct): number {
  return parseFloat(product.price) || 0;
}

export function getPriceMinHT(product: DolibarrProduct): number {
  return parseFloat(product.price_min) || 0;
}

export interface DolibarrSettings {
  baseUrl: string;
  apiKey: string;
}

export interface SupplierDiscount {
  id: string;
  supplier_name: string;
  discount_percent: number;
  socid: string;
}

function toNumericId(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeProduct(rawProduct: any): DolibarrProduct {
  return {
    ...rawProduct,
    id: toNumericId(rawProduct?.id),
    stock_reel:
      rawProduct?.stock_reel == null ? 0 : toNumericId(rawProduct.stock_reel),
  };
}

// In-memory cache to avoid repeated DB reads during a session
let cachedSettings: DolibarrSettings | null = null;

export async function getSettings(): Promise<DolibarrSettings> {
  if (cachedSettings) return cachedSettings;

  const { data, error } = await supabase
    .from("connection_settings")
    .select("base_url, api_key")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    return { baseUrl: "", apiKey: "" };
  }

  cachedSettings = { baseUrl: data.base_url, apiKey: data.api_key };
  return cachedSettings;
}

export async function saveSettings(settings: DolibarrSettings): Promise<void> {
  const { data: existing } = await supabase
    .from("connection_settings")
    .select("id")
    .limit(1)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("connection_settings")
      .update({ base_url: settings.baseUrl, api_key: settings.apiKey })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("connection_settings")
      .insert({ base_url: settings.baseUrl, api_key: settings.apiKey });
  }

  cachedSettings = { ...settings };
}

// --- Supplier discounts ---

export async function getSupplierDiscounts(): Promise<SupplierDiscount[]> {
  const { data } = await supabase
    .from("supplier_discounts")
    .select("id, supplier_name, discount_percent, socid")
    .order("supplier_name");
  return (data as SupplierDiscount[]) || [];
}

export async function saveSupplierDiscount(name: string, percent: number, socid: string): Promise<void> {
  const { data: existing } = await supabase
    .from("supplier_discounts")
    .select("id")
    .eq("supplier_name", name)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("supplier_discounts")
      .update({ discount_percent: percent, socid })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("supplier_discounts")
      .insert({ supplier_name: name, discount_percent: percent, socid });
  }
}

export async function deleteSupplierDiscount(id: string): Promise<void> {
  await supabase.from("supplier_discounts").delete().eq("id", id);
}

// --- Dolibarr API ---

async function dolibarrFetch(endpoint: string, options?: RequestInit): Promise<any> {
  const { baseUrl, apiKey } = await getSettings();
  if (!baseUrl || !apiKey) throw new Error("Configuration Dolibarr manquante");

  const url = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      DOLAPIKEY: apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`Erreur API (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Create a stock movement for a product.
 * @param productId Dolibarr product ID
 * @param qty Positive = add stock, negative = remove stock
 * @param warehouseId Dolibarr warehouse ID
 * @param label Optional movement label
 */
export async function updateProductStock(
  productId: number,
  qty: number,
  warehouseId: number,
  label = "Mise à jour depuis CHR Elite Scan"
): Promise<void> {
  await dolibarrProxy(`/api/index.php/stockmovements`, "POST", {
    product_id: productId,
    warehouse_id: warehouseId,
    qty,
    label,
  });
}

/**
 * Update product extrafields (e.g. emplacement).
 */
export async function updateProductExtrafields(
  productId: number,
  extrafields: Record<string, string>
): Promise<void> {
  await dolibarrProxy(`/api/index.php/products/${productId}`, "PUT", {
    array_options: extrafields,
  });
}

/**
 * Get list of warehouses from Dolibarr.
 */
export async function getWarehouses(): Promise<{ id: number; label: string; ref: string }[]> {
  const data = await dolibarrFetch(`/api/index.php/warehouses?limit=100`);
  if (!Array.isArray(data)) return [];
  return data.map((w: any) => ({ id: parseInt(w.id), label: w.label || w.ref, ref: w.ref }));
}

/**
 * Fetch product image as a Blob via Dolibarr documents API (authenticated).
 */
export async function fetchProductImageBlob(product: DolibarrProduct): Promise<string | undefined> {
  try {
    if (product.image?.startsWith("http")) {
      return product.image;
    }

    const { baseUrl, apiKey } = await getSettings();
    if (!baseUrl || !apiKey) return undefined;

    const docs = await dolibarrFetch(
      `/api/index.php/documents?modulepart=produit&id=${product.id}`
    );

    if (!Array.isArray(docs) || docs.length === 0) return undefined;

    const img = docs.find((d: any) => /\.(jpe?g|png|gif|webp)$/i.test(d.name));
    if (!img) return undefined;

    const downloadUrl = `${baseUrl.replace(/\/+$/, "")}/api/index.php/documents/download?modulepart=produit&original_file=${encodeURIComponent(product.ref + "/" + img.name)}`;

    const res = await fetch(downloadUrl, {
      headers: { DOLAPIKEY: apiKey, Accept: "application/json" },
    });

    if (!res.ok) return undefined;

    const json = await res.json();

    if (json?.content) {
      const contentType = json["content-type"] || json.contenttype || "image/jpeg";
      const binary = atob(json.content);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: contentType });
      if (blob.size > 0) {
        return URL.createObjectURL(blob);
      }
    }

    return `${baseUrl.replace(/\/+$/, "")}/documents/produit/${product.ref}/${img.name}`;
  } catch (e) {
    console.error("Erreur chargement image produit:", e);
    return undefined;
  }
}

/**
 * Resolve supplier name from its ID via Dolibarr thirdparties API.
 */
async function resolveSupplierName(supplierId: string): Promise<string> {
  if (!supplierId || supplierId === "0") return "";
  try {
    const data = await dolibarrFetch(`/api/index.php/thirdparties/${supplierId}`);
    return data?.name || data?.nom || supplierId;
  } catch {
    return supplierId;
  }
}

export async function searchProduct(value: string): Promise<DolibarrProduct | null> {
  const byBarcode = await dolibarrProxy(
    `/api/index.php/products?sqlfilters=${encodeURIComponent(`(barcode:=:'${value}') AND (t.tosell:=:1)`)}&limit=1`,
    "GET"
  );
  if (Array.isArray(byBarcode) && byBarcode.length > 0) {
    const product = normalizeProduct(byBarcode[0]);
    await enrichProduct(product);
    return product;
  }

  const byRef = await dolibarrProxy(
    `/api/index.php/products?sqlfilters=${encodeURIComponent(`(ref:=:'${value}') AND (t.tosell:=:1)`)}&limit=1`,
    "GET"
  );
  if (Array.isArray(byRef) && byRef.length > 0) {
    const product = normalizeProduct(byRef[0]);
    await enrichProduct(product);
    return product;
  }

  return null;
}

/** Enrich product with supplier name */
async function enrichProduct(product: DolibarrProduct): Promise<void> {
  const opts = product.array_options || {};
  const fournisseurId = opts.options_fournisseur || "";
  if (fournisseurId) {
    product.supplierName = await resolveSupplierName(fournisseurId);
  }
}

export async function testConnection(): Promise<boolean> {
  const data = await dolibarrFetch("/api/index.php/status");
  return !!data;
}

/**
 * Get the supplier discount for a product.
 * Matches supplier name (case-insensitive) from the supplier_discounts table.
 */
export async function getSupplierDiscountForProduct(product: DolibarrProduct): Promise<{ price: number; discount: number } | null> {
  const opts = product.array_options || {};
  const fournisseurId = opts.options_fournisseur || "";
  const supplierName = product.supplierName || "";

  const discounts = await getSupplierDiscounts();

  // Match by socid first (most reliable), then fallback to name
  const match = discounts.find((d) => {
    if (d.socid && fournisseurId && d.socid === fournisseurId) return true;
    if (d.supplier_name && supplierName && d.supplier_name.toLowerCase() === supplierName.toLowerCase()) return true;
    return false;
  });

  if (!match || match.discount_percent <= 0) return null;

  const priceHt = getPriceHT(product);
  const discountedPrice = priceHt * (1 - match.discount_percent / 100);
  return { price: discountedPrice, discount: match.discount_percent };
}

/**
 * price_min = prix d'achat dans Dolibarr (ne plus l'utiliser comme remise).
 * La remise vient uniquement de la table supplier_discounts.
 */
export function getDiscountedPrice(_product: DolibarrProduct): { price: number; discount: number } | null {
  // Deprecated sync version — use getSupplierDiscountForProduct instead
  return null;
}

export interface PromoPrice {
  id: number;
  label: string;
  discount: number | null;
  price: number | null;
  price_ttc: number | null;
  date_begin: string | null;
  date_end: string | null;
}

/**
 * Fetch active promos for a product via the dolibarr-promos edge function (PHP script).
 */
export async function getProductPromos(productId: number): Promise<PromoPrice[]> {
  try {
    const normalizedProductId = toNumericId(productId);
    if (!normalizedProductId) return [];

    const { data, error } = await supabase.functions.invoke("dolibarr-promos", {
      body: { product_id: normalizedProductId },
    });
    if (error || !data?.ok) return [];
    return data.promos || [];
  } catch {
    return [];
  }
}

/**
 * Autocomplete search: returns products matching a partial ref or label.
 * Uses LIKE filter on ref and label fields.
 */
export async function autocompleteProducts(query: string): Promise<DolibarrProduct[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) return [];

  const buildSqlFilterUrl = (field: "ref" | "label") => {
    const sqlFilter = `(${field}:like:'%${trimmedQuery}%') AND (t.tosell:=:1)`;
    return `/api/index.php/products?sqlfilters=${encodeURIComponent(sqlFilter)}&limit=8`;
  };

  const byRef = await dolibarrProxy(buildSqlFilterUrl("ref"), "GET");
  const byLabel = await dolibarrProxy(buildSqlFilterUrl("label"), "GET");

  const results: DolibarrProduct[] = [];
  const seen = new Set<number>();

  for (const list of [byRef, byLabel]) {
    if (Array.isArray(list)) {
      for (const p of list) {
        const product = normalizeProduct(p);
        if (!seen.has(product.id)) {
          seen.add(product.id);
          results.push(product);
        }
      }
    }
  }

  return results.slice(0, 10);
}
