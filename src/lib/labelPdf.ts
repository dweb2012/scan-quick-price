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
      width: 1.2,
      height: 35,
      fontSize: 10,
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
        width: 1.2,
        height: 35,
        fontSize: 10,
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

  const barcodeValue = product.barcode || product.ref;
  const barcodeCanvas = generateBarcodeCanvas(barcodeValue);

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, LABEL_W, LABEL_H, "F");

  // ========= Zone 1 — En-tête (y = 0 à 8mm) =========
  // Réf
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6);
  doc.setTextColor(85, 85, 85); // #555
  doc.text(`Réf: ${product.ref}`, 2, 3);

  // Désignation : 9pt bold, wrap sur 2 lignes max (largeur 53mm)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const designationLines = (doc.splitTextToSize(cleaned, 53) as string[]).slice(0, 2);
  // Tronquer la 2e ligne si besoin
  if (designationLines.length === 2 && doc.getTextWidth(designationLines[1]) > 53) {
    designationLines[1] = fitText(doc, designationLines[1], 53, 9, 7);
  }
  doc.text(designationLines, 2, 7);

  const isTwoLines = designationLines.length === 2;

  // ========= Zone 2 — Code-barres (gauche) =========
  // Si désignation sur 2 lignes : y=11mm, hauteur réduite à 12mm
  if (barcodeCanvas) {
    const bcY = isTwoLines ? 13 : 9;
    const bcH = isTwoLines ? 12 : 14;
    doc.addImage(
      barcodeCanvas.toDataURL("image/png"),
      "PNG",
      2, bcY, 28, bcH,
      undefined,
      "FAST"
    );
  }

  // ========= Zone 3 — Prix (droite) =========
  const hasPromo = remisedHt != null && remisedHt < priceHt;

  const formatEuro = (n: number) =>
    `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

  if (hasPromo) {
    // a) Prix normal BARRÉ — 10pt gris
    const normalText = `${formatEuro(priceHt)} HT`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(136, 136, 136); // #888
    const xNormal = 33;
    const yNormal = 14;
    doc.text(normalText, xNormal, yNormal);
    const normalW = doc.getTextWidth(normalText);
    doc.setDrawColor(136, 136, 136);
    doc.setLineWidth(0.3);
    doc.line(xNormal, yNormal - 1.2, xNormal + normalW, yNormal - 1.2);

    // b) Prix PROMO en gros
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    const promoText = formatEuro(remisedHt!);
    doc.text(promoText, 33, 22);
    const promoW = doc.getTextWidth(promoText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(" HT", 33 + promoW, 22);

    // c) Badge -%
    const pct = Math.round((1 - remisedHt! / priceHt) * 100);
    if (pct > 0) {
      doc.setFillColor(0, 0, 0);
      doc.rect(42, 26, 12, 4, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(`-${pct}%`, 48, 29, { align: "center" });
    }
  } else {
    // Pas de promo : prix normal en gros
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    const normalText = formatEuro(priceHt);
    doc.text(normalText, 33, 20);
    const w = doc.getTextWidth(normalText);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(" HT", 33 + w, 20);
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
