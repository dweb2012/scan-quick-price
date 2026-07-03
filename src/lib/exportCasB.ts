import { supabase } from "@/integrations/supabase/client";
import type { DolibarrProduct } from "./dolibarr";

/**
 * CAS B : si le libellé du produit scanné ne contient pas "BMY",
 * ajouter une ligne dans le Google Sheet de suivi.
 * Exécuté en tâche de fond — les erreurs ne bloquent pas l'UI.
 */
export function exportCasBIfNeeded(product: DolibarrProduct): void {
  const label = (product.label || "").toUpperCase();
  if (label.includes("BMY")) return; // CAS A -> rien à faire

  const payload = {
    ref: product.ref,
    label: product.label,
    barcode: product.barcode,
    stock: product.stock_reel,
    emplacement: product.array_options?.options_emplacement || "",
    fournisseur: product.supplierName || "",
    photo: product.imageUrl || "",
  };

  supabase.functions
    .invoke("export-cas-b", { body: payload })
    .then(({ error }) => {
      if (error) console.warn("Export CAS B échoué:", error.message);
    })
    .catch((e) => console.warn("Export CAS B échoué:", e));
}