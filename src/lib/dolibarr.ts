export interface DolibarrProduct {
  id: number;
  ref: string;
  label: string;
  barcode: string;
  price_ttc: string;
  price_min_ttc: string;
  stock_reel: number;
  image?: string;
  photo?: string;
  default_min_quantity_discount?: string;
}

export interface DolibarrSettings {
  baseUrl: string;
  apiKey: string;
}

export function getSettings(): DolibarrSettings {
  return {
    baseUrl: localStorage.getItem("dolibarr_url") || "",
    apiKey: localStorage.getItem("dolibarr_apikey") || "",
  };
}

export function saveSettings(settings: DolibarrSettings) {
  localStorage.setItem("dolibarr_url", settings.baseUrl);
  localStorage.setItem("dolibarr_apikey", settings.apiKey);
}

async function dolibarrFetch(endpoint: string): Promise<any> {
  const { baseUrl, apiKey } = getSettings();
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

export async function searchProduct(value: string): Promise<DolibarrProduct | null> {
  // Try barcode first
  const byBarcode = await dolibarrFetch(
    `/api/index.php/products?barcode=${encodeURIComponent(value)}&limit=1`
  );
  if (Array.isArray(byBarcode) && byBarcode.length > 0) return byBarcode[0];

  // Try reference
  const byRef = await dolibarrFetch(
    `/api/index.php/products?sqlfilters=(ref:=:'${encodeURIComponent(value)}')&limit=1`
  );
  if (Array.isArray(byRef) && byRef.length > 0) return byRef[0];

  return null;
}

export async function testConnection(): Promise<boolean> {
  const data = await dolibarrFetch("/api/index.php/status");
  return !!data;
}

export function getDiscountedPrice(product: DolibarrProduct): { price: number; discount: number } | null {
  const priceTtc = parseFloat(product.price_ttc) || 0;
  const priceMinTtc = parseFloat(product.price_min_ttc) || 0;

  if (priceMinTtc > 0 && priceMinTtc < priceTtc) {
    const discount = ((priceTtc - priceMinTtc) / priceTtc) * 100;
    return { price: priceMinTtc, discount: Math.round(discount) };
  }

  const discountPct = parseFloat(product.default_min_quantity_discount || "0");
  if (discountPct > 0) {
    return { price: priceTtc * (1 - discountPct / 100), discount: Math.round(discountPct) };
  }

  return null;
}
