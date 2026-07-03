import { supabase } from "@/integrations/supabase/client";
import type { DolibarrProduct } from "./dolibarr";

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

/** Envoi manuel vers l'onglet B après validation utilisateur. */
export async function sendCasB(product: DolibarrProduct): Promise<void> {
  const payload = {
    sheet: "B",
    ref: product.ref,
    label: product.label,
    barcode: product.barcode,
    stock: product.stock_reel,
    emplacement: product.array_options?.options_emplacement || "",
    fournisseur: product.supplierName || "",
  };
  const { error } = await supabase.functions.invoke("export-cas-b", { body: payload });
  if (error) throw new Error(error.message);
}

/**
 * CAS C : produit introuvable dans Dolibarr mais scanné.
 * On envoie le code (ref ou barcode) dans l'onglet C.
 */
/** Envoi manuel vers l'onglet C après validation utilisateur. */
export async function sendCasC(code: string): Promise<void> {
  if (!code) return;
  const payload = {
    sheet: "C",
    ref: "",
    barcode: code,
    label: "",
    stock: "",
    emplacement: "",
    fournisseur: "",
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