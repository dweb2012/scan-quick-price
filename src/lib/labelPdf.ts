import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import { DolibarrProduct, getPriceHT, getSupplierDiscountForProduct, getProductPromos } from "./dolibarr";

const formatPrice = (n: number) =>
  n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

/**
 * Generate a 57x32mm label PDF for the DYMO LabelWriter 550.
 * Layout (top → bottom): Ref, Label, Location (if any), Prix HT, Prix remisé HT (if any), Barcode.
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

  // 57 x 32 mm label, landscape
  const W = 57;
  const H = 32;
  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape" });

  const margin = 1.5;
  let y = margin + 2;

  // Ref (top-left, bold)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(`Réf: ${product.ref}`, margin, y);

  // Emplacement (top-right)
  if (emplacement) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const txt = emplacement.length > 14 ? emplacement.slice(0, 14) : emplacement;
    doc.text(txt, W - margin, y, { align: "right" });
  }

  // Label (truncated if too long)
  y += 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const labelLines = doc.splitTextToSize(product.label || "", W - margin * 2);
  const lines = labelLines.slice(0, 2);
  doc.text(lines, margin, y);
  y += lines.length * 2.6;

  // Prices row
  y += 1;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`HT: ${formatPrice(priceHt)}`, margin, y);

  if (remisedHt != null) {
    y += 4;
    doc.setFontSize(10);
    doc.text(`Remisé: ${formatPrice(remisedHt)}`, margin, y);
  }

  // Barcode at the bottom
  const barcodeValue = product.barcode || product.ref;
  if (barcodeValue) {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, barcodeValue, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14,
        margin: 0,
        height: 40,
        width: 2,
      });
      const dataUrl = canvas.toDataURL("image/png");
      // Place barcode at the bottom, full width minus margins
      const bcH = 9;
      const bcW = W - margin * 2;
      doc.addImage(dataUrl, "PNG", margin, H - bcH - margin, bcW, bcH);
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