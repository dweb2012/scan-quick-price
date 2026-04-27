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
 * Le pilote DYMO LabelWriter 550 attend la page PDF en PORTRAIT 32×57.
 * Si on envoie un PDF paysage 57×32, l'impression s'étale sur 2 étiquettes.
 *
 * → On génère TOUJOURS le PDF en portrait 32×57.
 *   - Mode "portrait" : contenu dessiné droit (lecture en hauteur).
 *   - Mode "landscape" : contenu pivoté de 90° (lecture en largeur).
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

  // Page PDF physique : toujours 32×57 portrait pour DYMO 30334.
  const PAGE_W = 32;
  const PAGE_H = 57;
  const doc = new jsPDF({ unit: "mm", format: [PAGE_W, PAGE_H], orientation: "portrait" });

  // Espace logique : on dessine dans (W,H) puis on transforme.
  // - landscape : W=57, H=32, rotation 90° → coords (x,y) → (y, W-x), angle=90.
  // - portrait  : W=32, H=57, identité.
  const isLandscape = orientation === "landscape";
  const W = isLandscape ? 57 : 32;
  const H = isLandscape ? 32 : 57;
  const margin = 1.5;
  const contentW = W - margin * 2;

  const tx = (x: number, y: number) => (isLandscape ? y : x);
  const ty = (x: number, y: number) => (isLandscape ? W - x : y);
  const ANGLE = isLandscape ? 90 : 0;

  const drawText = (text: string, x: number, y: number, opts2: any = {}) => {
    doc.text(text, tx(x, y), ty(x, y), { angle: ANGLE, ...opts2 });
  };

  const drawImage = (data: string, x: number, y: number, w: number, h: number) => {
    if (isLandscape) {
      // image rotated 90°: in PDF coords its origin is at (tx(x,y+h), ty(x,y+h))? simpler: use addImage with rotation.
      doc.addImage(data, "PNG", tx(x, y + h), ty(x, y + h), w, h, undefined, "FAST", -90);
    } else {
      doc.addImage(data, "PNG", x, y, w, h, undefined, "FAST");
    }
  };

  let y = margin + 2.2;

  // Réf (haut-gauche)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  drawText(`Réf: ${product.ref}`, margin, y);

  // Emplacement (haut-droite)
  if (emplacement) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const txt = emplacement.length > 22 ? emplacement.slice(0, 22) : emplacement;
    drawText(txt, W - margin, y, { align: "right" });
  }

  // Libellé (max 2 lignes)
  y += 3.6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const labelLines = doc.splitTextToSize(cleaned, contentW).slice(0, 2) as string[];
  labelLines.forEach((line, i) => {
    drawText(line, margin, y + i * 3.2);
  });
  y += labelLines.length * 3.2 + 1;

  // Code-barres (centre, hauteur fixe)
  const barcodeValue = product.barcode || product.ref;
  const bcDataUrl = generateBarcodeDataUrl(barcodeValue, contentW, 8);
  const bcH = 8;
  if (bcDataUrl) {
    const bcW = contentW;
    drawImage(bcDataUrl, margin, y, bcW, bcH);
    y += bcH + 1;
    // valeur sous le code-barres
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    drawText(barcodeValue, W / 2, y, { align: "center" });
  }

  // Prix HT (gauche) et Remisé (droite) en bas
  const yBottom = H - margin - 1;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(remisedHt != null ? 9 : 11);
  drawText(`HT: ${formatPrice(priceHt)}`, margin, yBottom);

  if (remisedHt != null) {
    doc.setTextColor(180, 30, 30);
    drawText(`Remisé: ${formatPrice(remisedHt)}`, W - margin, yBottom, { align: "right" });
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
