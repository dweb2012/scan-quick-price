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

// API conservée pour compat ; l'orientation est désormais figée en paysage.
export type LabelOrientation = "portrait" | "landscape";
const ORIENTATION_KEY = "labelOrientation";
export const getLabelOrientation = (): LabelOrientation => "landscape";
export const setLabelOrientation = (_o: LabelOrientation) => {
  localStorage.setItem(ORIENTATION_KEY, "landscape");
};

// Format physique de l'étiquette DYMO 11354 / 30334 : 57 x 32 mm (paysage).
const LABEL_W = 57;
const LABEL_H = 32;

const generateBarcodeCanvas = (value: string): HTMLCanvasElement | null => {
  if (!value) return null;
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: /^\d{13}$/.test(value) ? "EAN13" : "CODE128",
      width: 1,
      height: 30,
      fontSize: 8,
      displayValue: true,
      margin: 0,
    });
    return canvas;
  } catch {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, value, {
        format: "CODE128",
        width: 1,
        height: 30,
        fontSize: 8,
        displayValue: true,
        margin: 0,
      });
      return canvas;
    } catch {
      return null;
    }
  }
};

const fitText = (
  doc: jsPDF,
  text: string,
  maxWidth: number,
  fontSize: number,
  minFontSize = 5
) => {
  let size = fontSize;
  doc.setFontSize(size);
  while (size > minFontSize && doc.getTextWidth(text) > maxWidth) {
    size -= 0.25;
    doc.setFontSize(size);
  }
  if (doc.getTextWidth(text) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && doc.getTextWidth(`${out}…`) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
};

const wrapPdfText = (
  doc: jsPDF,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (doc.getTextWidth(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    lines[maxLines - 1] = fitText(doc, lines[maxLines - 1], maxWidth, doc.getFontSize());
  }
  return lines;
};

/**
 * Génère une étiquette DYMO 11354 / 30334 au format EXACT 57 × 32 mm paysage.
 * Layout 57 × 32 mm : textes en haut, code-barres à gauche, prix à droite.
 */
const buildLabelPdfDocument = async (product: DolibarrProduct): Promise<jsPDF> => {
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

  const cleaned = cleanLabel(product.label || "");

  // Format PDF EXACT 57 x 32 mm paysage, sans rotation du contenu.
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [32, 57],
    compress: true
  });

  doc.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true });

  const margin = 2;
  const contentW = LABEL_W - margin * 2;
  const barcodeValue = product.barcode || product.ref;
  const barcodeCanvas = generateBarcodeCanvas(barcodeValue);

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_W, LABEL_H, "F");
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(fitText(doc, `Réf: ${product.ref}`, contentW, 8), margin, 4);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.7);
  const labelLines = wrapPdfText(doc, cleaned, contentW, 2);
  labelLines.forEach((line, index) => {
    doc.text(line, margin, 8 + index * 3.2);
  });

  if (barcodeCanvas) {
    doc.addImage(barcodeCanvas.toDataURL("image/png"), "PNG", 2, 12, 30, 14, undefined, "FAST");
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text(fitText(doc, `HT: ${formatPrice(priceHt)}`, 19, 8), 36, 18);

  if (remisedHt != null) {
    doc.setTextColor(180, 30, 30);
    doc.text(fitText(doc, `Promo HT: ${formatPrice(remisedHt)}`, 19, 8), 36, 26);
  }

  doc.autoPrint();
  return doc;
};

export async function generateLabelPdf(product: DolibarrProduct): Promise<Blob> {
  const doc = await buildLabelPdfDocument(product);
  return doc.output("blob");
}

export async function printProductLabel(product: DolibarrProduct): Promise<void> {
  const doc = await buildLabelPdfDocument(product);
  const url = String(doc.output("bloburl"));
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
