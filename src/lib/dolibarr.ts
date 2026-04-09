import { supabase } from "@/integrations/supabase/client";

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

async function dolibarrFetch(endpoint: string): Promise<any> {
  const { baseUrl, apiKey } = await getSettings();
  if (!baseUrl || !apiKey) throw new Error("Configuration Dolibarr manquante");

  const url = `${baseUrl.replace(/\/+$/, "")}${endpoint}`;
  const res = await fetch(url, {
    headers: { DOLAPIKEY: apiKey, Accept: "application/json" },
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text();
    throw new Error(`Erreur API (${res.status}): ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Fetch product image as a Blob via Dolibarr documents API (authenticated).
 * Returns an object URL or undefined.
 */
export async function fetchProductImageBlob(product: DolibarrProduct): Promise<string | undefined> {
  try {
    // If image field is already an HTTP URL, use it directly
    if (product.image?.startsWith("http")) {
      return product.image;
    }

    const { baseUrl, apiKey } = await getSettings();
    if (!baseUrl || !apiKey) return undefined;

    // Get document list for this product
    const docs = await dolibarrFetch(
      `/api/index.php/documents?modulepart=produit&id=${product.id}`
    );

    if (!Array.isArray(docs) || docs.length === 0) return undefined;

    const img = docs.find((d: any) => /\.(jpe?g|png|gif|webp)$/i.test(d.name));
    if (!img) return undefined;

    // Download the file via the documents download endpoint
    const downloadUrl = `${baseUrl.replace(/\/+$/, "")}/api/index.php/documents/download?modulepart=produit&original_file=${encodeURIComponent(product.ref + "/" + img.name)}`;

    const res = await fetch(downloadUrl, {
      headers: { DOLAPIKEY: apiKey, Accept: "application/json" },
    });

    if (!res.ok) return undefined;

    const json = await res.json();

    // Dolibarr returns { filename, content (base64), content-type, ... }
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

    // Fallback: direct URL with auth (may not work with CORS)
    const directUrl = `${baseUrl.replace(/\/+$/, "")}/documents/produit/${product.ref}/${img.name}`;
    return directUrl;
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
    return supplierId; // Fallback to ID if fetch fails
  }
}

export async function searchProduct(value: string): Promise<DolibarrProduct | null> {
  // Try barcode first — verify exact match
  const byBarcode = await dolibarrFetch(
    `/api/index.php/products?sqlfilters=(barcode:=:'${encodeURIComponent(value)}')&limit=1`
  );
  if (Array.isArray(byBarcode) && byBarcode.length > 0) {
    const p = byBarcode[0];
    await enrichProduct(p);
    return p;
  }

  // Try reference — exact match
  const byRef = await dolibarrFetch(
    `/api/index.php/products?sqlfilters=(ref:=:'${encodeURIComponent(value)}')&limit=1`
  );
  if (Array.isArray(byRef) && byRef.length > 0) {
    const p = byRef[0];
    await enrichProduct(p);
    return p;
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

export function getDiscountedPrice(product: DolibarrProduct): { price: number; discount: number } | null {
  const priceHt = getPriceHT(product);
  const priceMinHt = getPriceMinHT(product);

  // Only use price_min if it's explicitly set and lower
  if (priceMinHt > 0 && priceMinHt < priceHt) {
    const discount = ((priceHt - priceMinHt) / priceHt) * 100;
    return { price: priceMinHt, discount: Math.round(discount) };
  }

  const discountPct = parseFloat(product.default_min_quantity_discount || "0");
  if (discountPct > 0) {
    return { price: priceHt * (1 - discountPct / 100), discount: Math.round(discountPct) };
  }

  return null;
}
