import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
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

  // 57 x 32 mm label (DYMO S0722540), paysage — 57mm large, 32mm haut
  const W = 57;
  const H = 32;
  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape" });

  const margin = 1.5;

  // Colonne gauche : infos texte / Colonne droite : code-barres
  const leftW = 34; // largeur zone texte
  const rightX = leftW + 0.5;
  const rightW = W - rightX - margin;

  let y = margin + 2.2;

  // Ref (haut-gauche, bold)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text(`Réf: ${product.ref}`, margin, y);

  // Emplacement (à droite de la même ligne, dans la zone gauche)
  if (emplacement) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    const txt = emplacement.length > 14 ? emplacement.slice(0, 14) : emplacement;
    doc.text(txt, leftW - 0.5, y, { align: "right" });
  }

  // Libellé (nettoyé + max 2 lignes)
  y += 3.2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const cleaned = cleanLabel(product.label || "");
  const labelLines = doc.splitTextToSize(cleaned, leftW - margin);
  const lines = labelLines.slice(0, 2);
  doc.text(lines, margin, y);
  y += lines.length * 2.8;

  // Prix
  y += 1.2;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(`HT: ${formatPrice(priceHt)}`, margin, y);

  if (remisedHt != null) {
    y += 4.2;
    doc.setFontSize(9);
    doc.text(`Remisé: ${formatPrice(remisedHt)}`, margin, y);
  }

  // Code-barres à droite, occupe toute la hauteur de l'étiquette
  const barcodeValue = product.barcode || product.ref;
  if (barcodeValue) {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, barcodeValue, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14,
        margin: 0,
        height: 60,
        width: 2,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const bcH = H - margin * 2;
      const bcW = rightW;
      doc.addImage(dataUrl, "PNG", rightX, margin, bcW, bcH);
    } catch (e) {
      console.warn("Barcode generation failed", e);
    }
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