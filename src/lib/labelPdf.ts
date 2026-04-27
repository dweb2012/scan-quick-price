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
const PX_PER_MM = 24;
const PT_TO_MM = 0.352777778;

const setCanvasFont = (
  ctx: CanvasRenderingContext2D,
  pt: number,
  weight: "normal" | "bold" = "normal"
) => {
  ctx.font = `${weight} ${pt * PT_TO_MM}px Arial, Helvetica, sans-serif`;
};

const ellipsize = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) {
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxWidth);
  }
  return lines;
};

const generateBarcodeCanvas = (value: string): HTMLCanvasElement | null => {
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
    return canvas;
  } catch {
    return null;
  }
};

/**
 * Génère une étiquette DYMO 11354 / 30334 au format EXACT 57 × 32 mm paysage.
 * Layout horizontal : bloc gauche (Réf + libellé + emplacement + prix),
 * code-barres collé à droite.
 */
export async function generateLabelPdf(product: DolibarrProduct): Promise<Blob> {
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

  const W = LABEL_W;
  const H = LABEL_H;

  const layoutCanvas = document.createElement("canvas");
  layoutCanvas.width = W * PX_PER_MM;
  layoutCanvas.height = H * PX_PER_MM;
  const ctx = layoutCanvas.getContext("2d")!;
  ctx.scale(PX_PER_MM, PX_PER_MM);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  const margin = 1.2;
  const contentW = W - margin * 2;

  // ---- Ligne 1 : Réf (gauche) + libellé (droite, sur 2 lignes max) ----
  let y = margin + 2.6;
  ctx.textAlign = "left";
  setCanvasFont(ctx, 8, "bold");
  const refText = `Réf: ${product.ref}`;
  const refW = Math.min(ctx.measureText(refText).width + 1.2, contentW * 0.45);
  ctx.fillText(ellipsize(ctx, refText, refW), margin, y);

  // Libellé à droite de la réf, peut passer sur 2 lignes
  setCanvasFont(ctx, 7.5);
  const labelX = margin + refW + 1;
  const labelMaxW = W - margin - labelX;
  const labelLines = wrapText(ctx, cleaned, labelMaxW, 2);
  labelLines.forEach((line, i) => {
    ctx.fillText(line, labelX, y + i * 2.8);
  });

  // ---- Ligne 2 : Code-barres centré ----
  const bcY = margin + 6;
  const bcH = 13;
  const barcodeValue = product.barcode || product.ref;
  const barcodeCanvas = generateBarcodeCanvas(barcodeValue);
  if (barcodeCanvas) {
    ctx.drawImage(barcodeCanvas, margin, bcY, contentW, bcH);
    setCanvasFont(ctx, 5);
    ctx.textAlign = "center";
    ctx.fillText(
      ellipsize(ctx, barcodeValue, contentW),
      W / 2,
      bcY + bcH + 2.2
    );
  }

  // ---- Ligne 3 : Prix HT (gauche) + Promo HT (droite) ----
  const yPrice = H - margin - 0.6;
  setCanvasFont(ctx, 9, "bold");
  ctx.fillStyle = "#000000";
  ctx.textAlign = "left";
  ctx.fillText(`HT: ${formatPrice(priceHt)}`, margin, yPrice);

  if (remisedHt != null) {
    ctx.fillStyle = "#b41e1e";
    ctx.textAlign = "right";
    ctx.fillText(`Promo HT: ${formatPrice(remisedHt)}`, W - margin, yPrice);
  }

  // Format PDF EXACT 57 x 32 mm paysage, sans rescale par le viewer.
  const doc = new jsPDF({
    unit: "mm",
    format: [LABEL_W, LABEL_H],
    orientation: "landscape",
    precision: 4,
    putOnlyUsedFonts: true,
    compress: true,
  });

  doc.viewerPreferences({ PrintScaling: "None", PickTrayByPDFSize: true });
  doc.addImage(
    layoutCanvas.toDataURL("image/png"),
    "PNG",
    0,
    0,
    LABEL_W,
    LABEL_H,
    undefined,
    "FAST"
  );

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
