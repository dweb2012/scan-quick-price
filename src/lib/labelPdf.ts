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
export const getLabelOrientation = (): LabelOrientation => "portrait";
export const setLabelOrientation = (_o: LabelOrientation) => {
  localStorage.setItem(ORIENTATION_KEY, "portrait");
};

// Étiquette Dymo LD-99015 / S0722440 imprimée en PORTRAIT : 54 × 70 mm.
const LABEL_W = 54;
const LABEL_H = 70;

const generateBarcodeCanvas = (value: string): HTMLCanvasElement | null => {
  if (!value) return null;
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: /^\d{13}$/.test(value) ? "EAN13" : "CODE128",
      width: 3,
      height: 80,
      fontSize: 18,
      displayValue: true,
      margin: 0,
      textMargin: 1,
    });
    return canvas;
  } catch {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, value, {
        format: "CODE128",
        width: 3,
        height: 80,
        fontSize: 18,
        displayValue: true,
        margin: 0,
        textMargin: 1,
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
 * Génère une étiquette au format EXACT 70 × 54 mm paysage.
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

  // Format PDF EXACT 70 x 54 mm paysage.
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [LABEL_W, LABEL_H],
    compress: true
  });

  doc.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true });

  const barcodeValue = product.barcode || product.ref;
  const barcodeCanvas = generateBarcodeCanvas(barcodeValue);

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_W, LABEL_H, "F");

  const innerW = LABEL_W - 4; // 2mm padding chaque côté
  const centerX = LABEL_W / 2;

  // ========= Zone 1 — En-tête =========
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(85, 85, 85);
  doc.text(`Réf: ${product.ref}`, centerX, 9, { align: "center" });

  // Emplacement (si renseigné)
  const emplacement = (product.array_options?.options_emplacement || "").trim();
  if (emplacement) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 64, 175);
    doc.text(`Allée ${emplacement}`, centerX, 13, { align: "center" });
  }

  // ========= Zone 2 — Désignation =========
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  const designationLines = (doc.splitTextToSize(cleaned, innerW) as string[]).slice(0, 3);
  const lastIdx = designationLines.length - 1;
  if (lastIdx >= 0 && doc.getTextWidth(designationLines[lastIdx]) > innerW) {
    designationLines[lastIdx] = fitText(doc, designationLines[lastIdx], innerW, 12, 7);
  }
  const designationStartY = emplacement ? 19 : 15;
  const lineHeight = 4.5;
  doc.text(designationLines, centerX, designationStartY, { align: "center", lineHeightFactor: 1.15 });
  const designationEndY = designationStartY + (designationLines.length - 1) * lineHeight;

  // ========= Zone 3 — Code-barres =========
  let barcodeEndY = designationEndY + 4;
  if (barcodeCanvas) {
    const bcW = 48;
    const bcH = 20;
    const bcX = (LABEL_W - bcW) / 2;
    const bcY = designationEndY + 5;
    doc.addImage(
      barcodeCanvas.toDataURL("image/png"),
      "PNG",
      bcX, bcY, bcW, bcH,
      undefined,
      "SLOW"
    );
    barcodeEndY = bcY + bcH;
  }

  // ========= Zone 4 — Prix (bas) =========
  const hasPromo = remisedHt != null && remisedHt < priceHt;

  const formatEuro = (n: number) =>
    `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  if (hasPromo) {
    // a) Prix normal BARRÉ (haut)
    const normalText = `${formatEuro(priceHt)} HT`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(14);
    doc.setTextColor(136, 136, 136);
    const yNormal = 55;
    doc.text(normalText, centerX, yNormal, { align: "center" });
    const normalW = doc.getTextWidth(normalText);
    doc.setDrawColor(136, 136, 136);
    doc.setLineWidth(0.5);
    doc.line(centerX - normalW / 2, yNormal - 1.5, centerX + normalW / 2, yNormal - 1.5);

    // b+c) Badge -% + Prix PROMO, groupe centré
    const pct = Math.round((1 - remisedHt! / priceHt) * 100);
    const promoText = `${formatEuro(remisedHt!)} HT`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    const promoW = doc.getTextWidth(promoText);
    const badgeW = pct > 0 ? 13 : 0;
    const badgeH = 6.5;
    const gap = pct > 0 ? 2 : 0;
    const groupW = badgeW + gap + promoW;
    const groupX = (LABEL_W - groupW) / 2;
    const yCenter = 65;
    if (pct > 0) {
      const badgeY = yCenter - badgeH / 2;
      doc.setFillColor(0, 0, 0);
      doc.rect(groupX, badgeY, badgeW, badgeH, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.text(`-${pct}%`, groupX + badgeW / 2, badgeY + badgeH / 2 + 1.3, { align: "center" });
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.setTextColor(0, 0, 0);
    doc.text(promoText, groupX + badgeW + gap, yCenter + 2, { align: "left" });
  } else {
    // Pas de promo : prix normal en gros, centré
    doc.setFont("helvetica", "bold");
    doc.setFontSize(30);
    doc.setTextColor(0, 0, 0);
    const normalText = `${formatEuro(priceHt)} HT`;
    doc.text(normalText, centerX, 66, { align: "center" });
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
