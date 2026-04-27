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
const PHYSICAL_LABEL_W = 32;
const PHYSICAL_LABEL_H = 57;
const PX_PER_MM = 18;
const PT_TO_MM = 0.352777778;

export const getLabelOrientation = (): LabelOrientation => {
  const v = localStorage.getItem(ORIENTATION_KEY);
  return v === "landscape" ? "landscape" : "portrait";
};

export const setLabelOrientation = (o: LabelOrientation) => {
  localStorage.setItem(ORIENTATION_KEY, o);
};

const setCanvasFont = (ctx: CanvasRenderingContext2D, pt: number, weight: "normal" | "bold" = "normal") => {
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

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] => {
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

  // La page PDF correspond EXACTEMENT au format papier choisi.
  // - portrait  : 32 × 57 mm
  // - landscape : 57 × 32 mm (page native, sans rotation d'image)
  const isLandscape = orientation === "landscape";
  const W = isLandscape ? PHYSICAL_LABEL_H : PHYSICAL_LABEL_W;
  const H = isLandscape ? PHYSICAL_LABEL_W : PHYSICAL_LABEL_H;

  const layoutCanvas = document.createElement("canvas");
  layoutCanvas.width = W * PX_PER_MM;
  layoutCanvas.height = H * PX_PER_MM;
  const ctx = layoutCanvas.getContext("2d")!;
  ctx.scale(PX_PER_MM, PX_PER_MM);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

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
  setCanvasFont(ctx, refSize, "bold");
  ctx.textAlign = "left";
  ctx.fillText(ellipsize(ctx, `Réf: ${product.ref}`, contentW * 0.58), margin, y);

  // Emplacement (haut-droite)
  if (emplacement) {
    setCanvasFont(ctx, empSize);
    ctx.textAlign = "right";
    const txt = emplacement.length > empMaxChars ? emplacement.slice(0, empMaxChars) : emplacement;
    ctx.fillText(ellipsize(ctx, txt, contentW * 0.38), W - margin, y);
  }

  // Libellé (max 2 lignes)
  y += isLandscape ? 3.8 : 3.2;
  setCanvasFont(ctx, labelSize);
  ctx.textAlign = "left";
  const labelLines = wrapText(ctx, cleaned, contentW, 2);
  labelLines.forEach((line, i) => {
    ctx.fillText(line, margin, y + i * labelLineH);
  });
  y += labelLines.length * labelLineH + 1;

  // Code-barres (centre)
  const barcodeValue = product.barcode || product.ref;
  const barcodeCanvas = generateBarcodeCanvas(barcodeValue);
  if (barcodeCanvas) {
    ctx.drawImage(barcodeCanvas, margin, y, contentW, bcH);
    y += bcH + 0.6;
    setCanvasFont(ctx, 5.5);
    ctx.textAlign = "center";
    ctx.fillText(ellipsize(ctx, barcodeValue, contentW), W / 2, y);
  }

  // Prix HT (gauche) et promo HT (droite) en bas
  const yBottom = H - margin - 0.8;
  setCanvasFont(ctx, priceSize, "bold");
  ctx.textAlign = "left";
  ctx.fillStyle = "#000000";
  ctx.fillText(`HT: ${formatPrice(priceHt)}`, margin, yBottom);

  if (remisedHt != null) {
    ctx.fillStyle = "#b41e1e";
    ctx.textAlign = "right";
    ctx.fillText(`Promo HT: ${formatPrice(remisedHt)}`, W - margin, yBottom);
  }

  const doc = new jsPDF({
    unit: "mm",
    format: [W, H],
    orientation: isLandscape ? "landscape" : "portrait",
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
    W,
    H,
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
