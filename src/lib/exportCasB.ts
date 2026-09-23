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

/** Une ligne existante d'un onglet du Google Sheet. */
export interface SheetRow {
  sheet: "A" | "B" | "C" | "D" | "E";
  row: number;
  ref: string;
  barcode: string;
  label: string;
  fournisseur: string;
  stock: string;
  emplacement: string;
  note: string;
  etat: string;
}

/** Liste les lignes déjà saisies dans les onglets A→E (recherche facultative). */
export async function listSheetRows(query?: string): Promise<SheetRow[]> {
  const { data, error } = await supabase.functions.invoke("export-cas-b", {
    body: { action: "listRows", query: query ?? "" },
  });
  if (error) throw new Error(error.message);
  if (data?.ok === false) throw new Error(data.error || "Lecture du Google Sheet impossible");
  return (data?.rows ?? []) as SheetRow[];
}

/** Modifie les champs d'une ligne existante du Google Sheet. */
export async function updateSheetRow(
  target: { sheet: string; row: number },
  fields: Partial<Pick<SheetRow, "label" | "fournisseur" | "stock" | "emplacement" | "note">>,
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("export-cas-b", {
    body: { action: "updateRow", sheet: target.sheet, row: target.row, ...fields },
  });
  if (error) throw new Error(error.message);
  if (data?.ok === false) throw new Error(data.error || "Mise à jour impossible");
}

/**
 * Met à jour la colonne Stock de la (ou des) ligne(s) existante(s) dans les
 * onglets A/B/D qui correspondent à la référence produit. Sans effet si aucune
 * ligne ne correspond (produit jamais scanné dans le Sheet).
 */
export async function updateStockInSheet(ref: string, newStock: number): Promise<number> {
  if (!ref) return 0;
  const { data, error } = await supabase.functions.invoke("export-cas-b", {
    body: { action: "updateStock", ref, stock: newStock },
  });
  if (error) throw new Error(error.message);
  if (data?.ok === false) throw new Error(data.error || "Échec de la mise à jour du Google Sheet");
  return Number(data?.updated ?? 0);
}

/**
 * Met à jour la colonne Emplacement des lignes existantes (onglets A/B/D)
 * correspondant à la référence produit.
 */
export async function updateEmplacementInSheet(ref: string, emplacement: string): Promise<void> {
  if (!ref) return;
  const user = await getCurrentUserLabel();
  const { data, error } = await supabase.functions.invoke("export-cas-b", {
    body: { action: "updateEmplacement", ref, emplacement, user },
  });
  if (error) throw new Error(error.message);
  if (data?.ok === false) throw new Error(data.error || "Écriture impossible");
  const failed: string[] = data?.failed ?? [];
  if (failed.length) throw new Error(`onglet${failed.length > 1 ? "s" : ""} ${failed.join(", ")}`);
}

/** Écrit l'emplacement dans le Sheet et prévient l'utilisateur en cas d'échec. */
export async function syncEmplacementWithNotice(ref: string, label: string, emplacement: string): Promise<void> {
  try {
    await updateEmplacementInSheet(ref, emplacement);
  } catch (e: any) {
    console.warn("updateEmplacementInSheet failed", e);
    const { toast } = await import("sonner");
    toast.error(`Emplacement non écrit dans le Google Sheet`, {
      description: `${ref} — ${label} : emplacement « ${emplacement} » à remettre (${e?.message ?? "erreur"}).`,
      duration: Infinity,
      closeButton: true,
      action: { label: "Réessayer", onClick: () => { void syncEmplacementWithNotice(ref, label, emplacement); } },
    });
  }
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