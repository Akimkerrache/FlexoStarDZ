import PDFDocument from "pdfkit";

export interface PdfLine {
  description: string;
  quantity?: number;
  unit?: string;
  unitPriceMinor?: number;
  totalMinor?: number;
}

export interface PdfDoc {
  title: string;
  number?: string;
  meta?: [string, string][];
  party?: string[];
  lines?: PdfLine[];
  totals?: [string, string][];
  notes?: string;
}

export const money = (minor: number, currency = "DZD") =>
  `${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/**
 * Generic business document. Legal wording, tax mentions and numbering rules are intentionally NOT included:
 * they must be validated by Flexostar's accounting professional first (open decision #8).
 */
export function renderPdf(doc: PdfDoc, currency = "DZD"): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    pdf.fontSize(18).text("FLEXOSTAR GROUP ALGÉRIE", { align: "left" });
    pdf
      .moveDown(0.3)
      .fontSize(14)
      .text(`${doc.title}${doc.number ? ` ${doc.number}` : ""}`);
    pdf
      .moveDown(0.3)
      .fontSize(8)
      .fillColor("#a00")
      .text(
        "Document template pending validation of legal mentions and tax rules.",
      )
      .fillColor("black");
    pdf.moveDown();
    pdf.fontSize(10);
    for (const [k, v] of doc.meta ?? []) pdf.text(`${k}: ${v}`);
    if (doc.party?.length) {
      pdf.moveDown(0.5);
      doc.party.forEach((l) => pdf.text(l));
    }
    if (doc.lines?.length) {
      pdf.moveDown();
      const cols = [40, 280, 340, 400, 480];
      const y0 = pdf.y;
      pdf.font("Helvetica-Bold");
      ["Description", "Qty", "Unit", "Unit price", "Total"].forEach((h, i) =>
        pdf.text(h, cols[i], y0, { width: i === 0 ? 230 : 70 }),
      );
      pdf.font("Helvetica").moveDown(0.5);
      for (const l of doc.lines) {
        const y = pdf.y;
        pdf.text(l.description, cols[0], y, { width: 230 });
        const h = pdf.y;
        pdf.text(l.quantity != null ? String(l.quantity) : "", cols[1], y, {
          width: 55,
        });
        pdf.text(l.unit ?? "", cols[2], y, { width: 55 });
        pdf.text(
          l.unitPriceMinor != null ? money(l.unitPriceMinor, currency) : "",
          cols[3],
          y,
          { width: 75 },
        );
        pdf.text(
          l.totalMinor != null ? money(l.totalMinor, currency) : "",
          cols[4],
          y,
          { width: 80 },
        );
        pdf.y = Math.max(h, pdf.y) + 4;
        if (pdf.y > 760) pdf.addPage();
      }
    }
    if (doc.totals?.length) {
      pdf.moveDown();
      for (const [k, v] of doc.totals)
        pdf.text(`${k}: ${v}`, { align: "right" });
    }
    if (doc.notes) pdf.moveDown().text(`Notes: ${doc.notes}`);
    pdf.end();
  });
}

const FORMULA = /^[=+\-@\t\r]/;
/** CSV cell escaping, including neutralisation of spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (headers: string[], rows: unknown[][]) =>
  "\uFEFF" +
  [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
