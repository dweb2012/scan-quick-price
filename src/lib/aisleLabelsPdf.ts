import jsPDF from "jspdf";
import QRCode from "qrcode";
import { buildAisleQrPayload } from "./aisle";
import { getAisleEntry, type AisleEntry } from "./aisleCatalog";

export type AisleLabelOrientation = "portrait" | "landscape";
export type AisleLabelPerPage = 4 | 6 | 8;

export interface AisleLabelOptions {
  orientation?: AisleLabelOrientation;
  perPage?: AisleLabelPerPage;
}

/** Grid (cols x rows) for each per-page count, depending on orientation. */
function getGrid(perPage: AisleLabelPerPage, orientation: AisleLabelOrientation): { cols: number; rows: number } {
  if (orientation === "portrait") {
    if (perPage === 4) return { cols: 2, rows: 2 };
    if (perPage === 6) return { cols: 2, rows: 3 };
    return { cols: 2, rows: 4 }; // 8
  } else {
    if (perPage === 4) return { cols: 2, rows: 2 };
    if (perPage === 6) return { cols: 3, rows: 2 };
    return { cols: 4, rows: 2 }; // 8
  }
}

/**
 * Generate a printable A4 PDF with QR codes for a list of aisles.
 * Layout configurable: orientation (portrait/landscape) and per page (4/6/8).
 */
export async function generateAisleLabelsPdf(
  aisles: (string | AisleEntry)[],
  options: AisleLabelOptions = {},
) {
  const orientation: AisleLabelOrientation = options.orientation ?? "portrait";
  const perPage: AisleLabelPerPage = options.perPage ?? 8;
  // Normalise en AisleEntry-like : { code, zoneName }
  const items = aisles
    .map((a) => {
      if (typeof a === "string") {
        const trimmed = a.trim();
        if (!trimmed) return null;
        const entry = getAisleEntry(trimmed);
        return entry
          ? { code: entry.code, zoneName: entry.zoneName }
          : { code: trimmed, zoneName: "" };
      }
      return { code: a.code, zoneName: a.zoneName };
    })
    .filter((x): x is { code: string; zoneName: string } => !!x);
  if (items.length === 0) throw new Error("Aucune allée fournie");

  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = orientation === "portrait" ? 210 : 297;
  const pageH = orientation === "portrait" ? 297 : 210;
  const { cols, rows } = getGrid(perPage, orientation);
  const marginX = 10;
  const marginY = 10;
  const cellW = (pageW - marginX * 2) / cols;
  const cellH = (pageH - marginY * 2) / rows;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = item.code;
    const zoneName = item.zoneName;
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
    const qrSize = Math.min(cellW, cellH) - 28;
    const qrX = x + (cellW - qrSize) / 2;
    const qrY = y + 6;
    doc.addImage(dataUrl, "PNG", qrX, qrY, qrSize, qrSize);

    // Header label
    doc.setTextColor(0);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("ALLÉE", x + cellW / 2, y + 5, { align: "center" });

    // Aisle code (big)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text(name, x + cellW / 2, qrY + qrSize + 9, {
      align: "center",
      maxWidth: cellW - 6,
    });

    // Zone name (small, grey)
    if (zoneName) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(110);
      doc.text(zoneName, x + cellW / 2, qrY + qrSize + 15, {
        align: "center",
        maxWidth: cellW - 6,
      });
      doc.setTextColor(0);
    }

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