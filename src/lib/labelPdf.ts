import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import { DolibarrProduct, getPriceHT, getSupplierDiscountForProduct, getProductPromos } from "./dolibarr";

const formatPrice = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

const cleanLabel = (label: string): string => {
  if (!label) return "";
  let out = label;
  out = out.replace(/^\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?(?:\s+[A-Z0-9]{2,})*\s*[-:]?\s*/u, "");
  out = out.replace(/^[\s\-:|]+/, "");
  return out.trim();
};

export type LabelOrientation = "portrait" | "landscape";

const ORIENTATION_KEY = "labelOrientation";

export const getLabelOrientation = (): LabelOrientation => {
  const v = localStorage.getItem(ORIENTATION_KEY);
  return v === "landscape" ? "landscape" : "portrait";
};

export const setLabelOrientation = (o: LabelOrientation) => {
  localStorage.setItem(ORIENTATION_KEY, o);
};

const generateBarcodeDataUrl = (value: string, width: number, height: number): string | null => {
  if (!value) return null;
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: "CODE128",
      width: 2,
      height: 60,
      displayValue: false,
      margin: 0,
    });
    // Resize via target canvas to fit pdf area (jsPDF will scale anyway with width/height args)
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
};

/**
 * Génère une étiquette DYMO 30334 (57×32 mm).
 *
 * La taille du PDF doit correspondre EXACTEMENT au format papier configuré
 * dans le pilote DYMO, sinon la page est répartie sur deux étiquettes.
 *
 *  - "portrait"  → page PDF 32 × 57 mm (étiquette debout)
 *  - "landscape" → page PDF 57 × 32 mm (étiquette couchée)
 *
 * Le contenu est dessiné droit dans la page (pas de rotation interne).
 */
export async function generateLabelPdf(product: DolibarrProduct): Promise<Blob> {
  const orientation = getLabelOrientation();

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
  const cleaned = cleanLabel(product.label || "");

  // Le format PDF correspond EXACTEMENT au papier choisi dans le pilote.
  const isLandscape = orientation === "landscape";
  const W = isLandscape ? 57 : 32; // largeur page mm
  const H = isLandscape ? 32 : 57; // hauteur page mm

  const doc = new jsPDF({
    unit: "mm",
    format: [W, H],
    orientation: isLandscape ? "landscape" : "portrait",
  });

  const margin = 1.5;
  const contentW = W - margin * 2;

  // Layouts adaptés à chaque format : on calcule des tailles relatives.
  const refSize = isLandscape ? 9 : 7.5;
  const empSize = isLandscape ? 8 : 6.5;
  const labelSize = isLandscape ? 8.5 : 7;
  const labelLineH = isLandscape ? 3.4 : 2.8;
  const bcH = isLandscape ? 9 : 7;
  const priceSize = isLandscape ? (remisedHt != null ? 9 : 11) : (remisedHt != null ? 7.5 : 9);
  const empMaxChars = isLandscape ? 22 : 14;

  let y = margin + (isLandscape ? 2.6 : 2.2);

  // Réf (haut-gauche)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(refSize);
  doc.text(`Réf: ${product.ref}`, margin, y);

  // Emplacement (haut-droite)
  if (emplacement) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(empSize);
    const txt = emplacement.length > empMaxChars ? emplacement.slice(0, empMaxChars) : emplacement;
    doc.text(txt, W - margin, y, { align: "right" });
  }

  // Libellé (max 2 lignes)
  y += isLandscape ? 3.8 : 3.2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(labelSize);
  const labelLines = doc.splitTextToSize(cleaned, contentW).slice(0, 2) as string[];
  labelLines.forEach((line, i) => {
    doc.text(line, margin, y + i * labelLineH);
  });
  y += labelLines.length * labelLineH + 1;

  // Code-barres (centre)
  const barcodeValue = product.barcode || product.ref;
  const bcDataUrl = generateBarcodeDataUrl(barcodeValue, contentW, bcH);
  if (bcDataUrl) {
    doc.addImage(bcDataUrl, "PNG", margin, y, contentW, bcH, undefined, "FAST");
    y += bcH + 0.6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.text(barcodeValue, W / 2, y, { align: "center" });
  }

  // Prix HT (gauche) et Remisé (droite) en bas
  const yBottom = H - margin - 0.8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(priceSize);
  doc.text(`HT: ${formatPrice(priceHt)}`, margin, yBottom);

  if (remisedHt != null) {
    doc.setTextColor(180, 30, 30);
    doc.text(`Remisé: ${formatPrice(remisedHt)}`, W - margin, yBottom, { align: "right" });
    doc.setTextColor(0, 0, 0);
  }

  return doc.output("blob");
}

export async function printProductLabel(product: DolibarrProduct): Promise<void> {
  const blob = await generateLabelPdf(product);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `etiquette-${product.ref}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
