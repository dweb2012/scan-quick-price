import jsPDF from "jspdf";
import QRCode from "qrcode";
import { buildAisleQrPayload } from "./aisle";

/**
 * Generate a printable A4 PDF with QR codes for a list of aisles.
 * Layout: 2 columns x 4 rows = 8 labels per A4 page.
 */
export async function generateAisleLabelsPdf(aisles: string[]) {
  const items = aisles.map((a) => a.trim()).filter(Boolean);
  if (items.length === 0) throw new Error("Aucune allée fournie");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const pageH = 297;
  const cols = 2;
  const rows = 4;
  const marginX = 10;
  const marginY = 10;
  const cellW = (pageW - marginX * 2) / cols;
  const cellH = (pageH - marginY * 2) / rows;
  const perPage = cols * rows;

  for (let i = 0; i < items.length; i++) {
    const name = items[i];
    const idxOnPage = i % perPage;
    if (i > 0 && idxOnPage === 0) doc.addPage();

    const col = idxOnPage % cols;
    const row = Math.floor(idxOnPage / cols);
    const x = marginX + col * cellW;
    const y = marginY + row * cellH;

    // Cell border (light grey, helpful for cutting)
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cellW, cellH);

    // QR
    const payload = buildAisleQrPayload(name);
    const dataUrl = await QRCode.toDataURL(payload, {
      margin: 1,
      width: 600,
      errorCorrectionLevel: "M",
    });
    const qrSize = Math.min(cellW, cellH) - 25;
    const qrX = x + (cellW - qrSize) / 2;
    const qrY = y + 6;
    doc.addImage(dataUrl, "PNG", qrX, qrY, qrSize, qrSize);

    // Header label
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("ALLÉE", x + cellW / 2, y + 5, { align: "center" });

    // Aisle name (big)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(name, x + cellW / 2, qrY + qrSize + 9, {
      align: "center",
      maxWidth: cellW - 6,
    });

    // Footer hint
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text("Scanner pour activer", x + cellW / 2, y + cellH - 3, {
      align: "center",
    });
    doc.setTextColor(0);
  }

  doc.autoPrint();
  const blobUrl = doc.output("bloburl");
  window.open(blobUrl, "_blank");
}