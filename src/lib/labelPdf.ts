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

  // Découpe horizontale : ~62% texte à gauche, ~38% code-barres à droite.
  const leftW = 34;
  const rightX = leftW + 0.6;
  const rightW = W - rightX - margin;

  // ---- Colonne gauche ----
  let y = margin + 2.8;
  ctx.textAlign = "left";

  // Réf (bold)
  setCanvasFont(ctx, 8.5, "bold");
  ctx.fillText(ellipsize(ctx, `Réf: ${product.ref}`, leftW - margin), margin, y);

  // Libellé (max 2 lignes, 8pt)
  y += 3.2;
  setCanvasFont(ctx, 7.5);
  const labelLines = wrapText(ctx, cleaned, leftW - margin, 2);
  labelLines.forEach((line, i) => {
    ctx.fillText(line, margin, y + i * 2.9);
  });
  y += labelLines.length * 2.9;

  // Emplacement
  if (emplacement) {
    y += 2.6;
    setCanvasFont(ctx, 6.5);
    ctx.fillText(ellipsize(ctx, `📍 ${emplacement}`, leftW - margin), margin, y);
  }

  // Prix en bas du bloc gauche
  const yPrice = H - margin - 1;
  setCanvasFont(ctx, remisedHt != null ? 8 : 10, "bold");
  ctx.fillStyle = "#000000";
  ctx.textAlign = "left";
  ctx.fillText(`HT ${formatPrice(priceHt)}`, margin, yPrice);

  if (remisedHt != null) {
    setCanvasFont(ctx, 8, "bold");
    ctx.fillStyle = "#b41e1e";
    ctx.fillText(`Promo ${formatPrice(remisedHt)}`, margin, yPrice - 3.4);
  }

  // ---- Colonne droite : code-barres ----
  ctx.fillStyle = "#000000";
  const barcodeValue = product.barcode || product.ref;
  const barcodeCanvas = generateBarcodeCanvas(barcodeValue);
  if (barcodeCanvas) {
    const bcH = 14; // hauteur max 14 mm comme demandé
    const bcY = margin + 1;
    ctx.drawImage(barcodeCanvas, rightX, bcY, rightW, bcH);
    setCanvasFont(ctx, 5.5);
    ctx.textAlign = "center";
    ctx.fillText(
      ellipsize(ctx, barcodeValue, rightW),
      rightX + rightW / 2,
      bcY + bcH + 2.4
    );
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
