import jsPDF from "jspdf";
import { DolibarrProduct, getPriceHT, getSupplierDiscountForProduct, getProductPromos } from "./dolibarr";

const formatPrice = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/**
 * Clean a product label by removing inventory/batch prefixes such as
 * "14/03 BMY HEN" (date DD/MM optionally followed by uppercase tokens).
 */
const cleanLabel = (label: string): string => {
  if (!label) return "";
  let out = label;
  // Remove leading "DD/MM" or "DD/MM/YY(YY)" + following uppercase tokens (BMY HEN…)
  out = out.replace(/^\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+[A-Z0-9]{2,})*\s*[-:]?\s*/u, "");
  // Remove any remaining leading separators
  out = out.replace(/^[\s\-:|]+/, "");
  return out.trim();
};

/**
 * Generate a 32x57mm label PDF (portrait) for the DYMO LabelWriter 550
 * (DYMO S0722540 "Étiquettes polyvalentes 32 x 57 mm LW").
 * Layout (top → bottom): Ref + Emplacement, Label (max 2 lines),
 * Prix HT, Prix remisé HT (if any), Barcode.
 */
export async function generateLabelPdf(product: DolibarrProduct): Promise<Blob> {
  // Fetch best discounted price (supplier discount or promo, whichever is lower)
  const [discounted, promos] = await Promise.all([
    getSupplierDiscountForProduct(product),
    getProductPromos(product.id),
  ]);

  const priceHt = getPriceHT(product);
  const promoBest = promos.reduce<number | null>((acc, p) => {
    if (p.price == null) return acc;
    if (acc == null || p.price < acc) return p.price;
    return acc;
  }, null);
  const remisedHt =
    promoBest != null && (discounted == null || promoBest < discounted.price)
      ? promoBest
      : discounted?.price ?? null;

  const opts = product.array_options || {};
  const emplacement = opts.options_emplacement || "";

  // DYMO 30334 (S0722540) : étiquette physique 57 x 32 mm.
  // Le pilote DYMO LabelWriter attend la page en PORTRAIT (32 large × 57 haut).
  // Si on envoie un PDF paysage 57×32, il s'étale sur 2 étiquettes.
  // → On génère donc en portrait 32×57 et on dessine le contenu pivoté de 90°
  //   pour conserver une lecture en paysage sur l'étiquette.
  const PAGE_W = 32; // largeur page PDF (= petit côté étiquette)
  const PAGE_H = 57; // hauteur page PDF (= grand côté étiquette)
  const doc = new jsPDF({ unit: "mm", format: [PAGE_W, PAGE_H], orientation: "portrait" });

  // Espace de dessin "logique" en paysage (W large, H haut)
  const W = PAGE_H; // 57
  const H = PAGE_W; // 32
  const margin = 1.5;
  const contentW = W - margin * 2;

  // Conversion d'un point (x,y) du repère paysage vers le repère portrait du PDF.
  // Rotation 90° anti-horaire : (x, y)_paysage → (y, W - x)_portrait
  const tx = (_x: number, y: number) => y;
  const ty = (x: number, _y: number) => W - x;
  const ANGLE = 90; // jsPDF tourne le texte en degrés (anti-horaire)

  let y = margin + 2.2;

  // Réf (haut-gauche)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`Réf: ${product.ref}`, tx(margin, y), ty(margin, y), { angle: ANGLE });

  // Emplacement (haut-droite)
  if (emplacement) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const txt = emplacement.length > 22 ? emplacement.slice(0, 22) : emplacement;
    const xRight = W - margin;
    doc.text(txt, tx(xRight, y), ty(xRight, y), { angle: ANGLE, align: "right" });
  }

  // Libellé (nettoyé + max 2 lignes)
  y += 3.6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const cleaned = cleanLabel(product.label || "");
  const labelLines = doc.splitTextToSize(cleaned, contentW);
  const lines = labelLines.slice(0, 2) as string[];
  lines.forEach((line, i) => {
    const ly = y + i * 3.2;
    doc.text(line, tx(margin, ly), ty(margin, ly), { angle: ANGLE });
  });

  // Prix HT (gauche) et Remisé (droite) en bas
  const yBottom = H - margin - 2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`HT: ${formatPrice(priceHt)}`, tx(margin, yBottom), ty(margin, yBottom), { angle: ANGLE });

  if (remisedHt != null) {
    const xRight = W - margin;
    doc.text(
      `Remisé: ${formatPrice(remisedHt)}`,
      tx(xRight, yBottom),
      ty(xRight, yBottom),
      { angle: ANGLE, align: "right" }
    );
  }

  return doc.output("blob");
}

/**
 * Open the generated label PDF in a new tab so the user can print it
 * (DYMO LabelWriter 550 via system print dialog) or share/download it.
 */
export async function printProductLabel(product: DolibarrProduct): Promise<void> {
  const blob = await generateLabelPdf(product);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    // Fallback: trigger download
    const a = document.createElement("a");
    a.href = url;
    a.download = `etiquette-${product.ref}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}