import { supabase } from "@/integrations/supabase/client";
import type { DolibarrProduct } from "./dolibarr";

/** Récupère le nom d'affichage de l'utilisateur courant (fallback: email). */
async function getCurrentUserLabel(): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return "";
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .maybeSingle();
  return profile?.display_name || user.email || "";
}

/**
 * CAS B : si le libellé du produit scanné ne contient pas "BMY",
 * ajouter une ligne dans le Google Sheet de suivi.
 * Exécuté en tâche de fond — les erreurs ne bloquent pas l'UI.
 */
/** Détermine si un produit relève du CAS B (libellé sans "BMY"). */
export function isCasB(product: DolibarrProduct): boolean {
  const label = (product.label || "").toUpperCase();
  return !label.includes("BMY");
}

/** Envoi vers l'onglet A (produit BMY trouvé dans Dolibarr — cas nominal). */
export async function sendCasA(product: DolibarrProduct): Promise<void> {
  const userLabel = await getCurrentUserLabel();
  const payload = {
    sheet: "A",
    ref: product.ref,
    label: product.label,
    barcode: product.barcode,
    stock: product.stock_reel,
    emplacement: product.array_options?.options_emplacement || "",
    fournisseur: product.supplierName || "",
    user: userLabel,
  };
  const { error } = await supabase.functions.invoke("export-cas-b", { body: payload });
  if (error) throw new Error(error.message);
}

/** Envoi manuel vers l'onglet B après validation utilisateur. */
export async function sendCasB(product: DolibarrProduct): Promise<void> {
  const userLabel = await getCurrentUserLabel();
  const payload = {
    sheet: "B",
    ref: product.ref,
    label: product.label,
    barcode: product.barcode,
    stock: product.stock_reel,
    emplacement: product.array_options?.options_emplacement || "",
    fournisseur: product.supplierName || "",
    user: userLabel,
  };
  const { error } = await supabase.functions.invoke("export-cas-b", { body: payload });
  if (error) throw new Error(error.message);
}

export { getCurrentUserLabel };

/**
 * Met à jour la colonne Stock de la (ou des) ligne(s) existante(s) dans les
 * onglets A/B/D qui correspondent à la référence produit. Sans effet si aucune
 * ligne ne correspond (produit jamais scanné dans le Sheet).
 */
export async function updateStockInSheet(ref: string, newStock: number): Promise<void> {
  if (!ref) return;
  const { error } = await supabase.functions.invoke("export-cas-b", {
    body: { action: "updateStock", ref, stock: newStock },
  });
  if (error) throw new Error(error.message);
}

/**
 * CAS C : produit introuvable dans Dolibarr mais scanné.
 * On envoie le code (ref ou barcode) dans l'onglet C.
 */
/** Envoi manuel vers l'onglet C après validation utilisateur. */
export async function sendCasC(
  code: string,
  extras?: {
    label?: string;
    fournisseur?: string;
    stock?: string;
    emplacement?: string;
    note?: string;
    user?: string;
  },
): Promise<void> {
  if (!code) return;
  const payload = {
    sheet: "C",
    ref: code,
    barcode: "",
    label: extras?.label ?? "",
    stock: extras?.stock ?? "",
    emplacement: extras?.emplacement ?? "",
    fournisseur: extras?.fournisseur ?? "",
    note: extras?.note ?? "",
    user: extras?.user ?? "",
  };
  const { error } = await supabase.functions.invoke("export-cas-b", { body: payload });
  if (error) throw new Error(error.message);
}

/** Envoi CAS E : produit sans code ni référence, absent de Dolibarr. */
export async function sendCasE(payload: {
  description: string;
  emplacement?: string;
  quantite?: string;
  note?: string;
  user?: string;
  imageDataUrl?: string;
}): Promise<void> {
  const { error } = await supabase.functions.invoke("export-cas-b", {
    body: { sheet: "E", ...payload },
  });
  if (error) throw new Error(error.message);
}

/**
 * CAS D : produit présent dans Dolibarr mais dont le carton n'a ni référence
 * ni code-barre visible. Le magasinier recherche le produit puis prend une
 * photo du carton (obligatoire) et éventuellement une note.
 */
export async function sendCasD(payload: {
  product: DolibarrProduct;
  emplacement?: string;
  note?: string;
  user?: string;
  imageDataUrl: string;
}): Promise<void> {
  const { product, emplacement, note, user, imageDataUrl } = payload;
  const body = {
    sheet: "D",
    ref: product.ref,
    label: product.label,
    barcode: product.barcode,
    stock: product.stock_reel,
    emplacement: emplacement || product.array_options?.options_emplacement || "",
    fournisseur: product.supplierName || "",
    note: note || "",
    user: user || "",
    imageDataUrl,
  };
  const { error } = await supabase.functions.invoke("export-cas-b", { body });
  if (error) throw new Error(error.message);
}