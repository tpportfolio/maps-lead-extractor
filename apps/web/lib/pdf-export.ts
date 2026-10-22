import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExportField } from "./export-schema";

export type PdfRow = {
  cells: Record<string, string>;
  thumbnail?: string;
};

export type PdfOptions = {
  title: string;
  subtitle: string;
  fields: ExportField[];
  rows: PdfRow[];
  includePhotos: boolean;
};

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN = 28;
const PHOTO_BOX = 46;

const INK = rgb(0.14, 0.16, 0.15);
const MUTED = rgb(0.42, 0.46, 0.44);
const LINE = rgb(0.82, 0.85, 0.83);
const HEAD_BG = rgb(0.94, 0.95, 0.94);
const ACCENT = rgb(0.0, 0.77, 0.25);

// Las fuentes standard de pdf-lib usan WinAnsi (CP1252). Cualquier
// caracter fuera de ese rango hace fallar el encode y rompe TODO el PDF
// (nombres en arabe, cirilico, chino, emoji...). Se eliminan.
const WINANSI_SPECIALS = new Set([0x85, 0x91, 0x92, 0x93, 0x94, 0x96, 0x97]);

function sanitizePdfText(value: string): string {
  let out = "";
  for (const ch of String(value ?? "")) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code <= 0x7e) {
      out += ch;
    } else if (code >= 0xa0 && code <= 0xff) {
      out += ch;
    } else if (WINANSI_SPECIALS.has(code)) {
      out += ch;
    }
    // resto (acentos no, >0xff, surrogados, emoji) se descartan
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
    } else {
      if (line) lines.push(line);
      // Palabra sola mas ancha que la celda: se parte por caracteres
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = "";
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk += ch;
          }
        }
        line = chunk;
      } else {
        line = word;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function fetchImage(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(`/api/leads/image?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/**
 * Dibuja la foto centrada dentro de una caja de tamano fijo, respetando
 * la proporcion (contain). Si la imagen no se puede cargar, dibuja un
 * placeholder con la inicial.
 */
async function drawThumbnail(
  page: PDFPage,
  bytes: Uint8Array | null,
  x: number,
  y: number,
  box: number,
  label: string,
  font: PDFFont
) {
  page.drawRectangle({
    x,
    y,
    width: box,
    height: box,
    borderColor: LINE,
    borderWidth: 0.6,
    color: rgb(0.97, 0.98, 0.97),
  });

  if (bytes && bytes.length > 10) {
    try {
      const doc = await PDFDocument.create();
      let image;
      try {
        image = await doc.embedJpg(bytes);
      } catch {
        image = await doc.embedPng(bytes);
      }
      const scale = Math.min(box / image.width, box / image.height);
      const w = image.width * scale;
      const h = image.height * scale;
      page.drawImage(image, {
        x: x + (box - w) / 2,
        y: y + (box - h) / 2,
        width: w,
        height: h,
      });
      return;
    } catch {
      // cae al placeholder
    }
  }

  const initial = (label || "?").trim().charAt(0).toUpperCase() || "?";
  page.drawText(sanitizePdfText(initial), {
    x: x + box / 2 - font.widthOfTextAtSize(initial, 14) / 2,
    y: y + box / 2 - 5,
    size: 14,
    font,
    color: MUTED,
  });
}

export async function buildLeadsPdf(options: PdfOptions): Promise<Uint8Array> {
  const { title, subtitle, fields, rows, includePhotos } = options;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Anchos proporcionales a partir de los pesos definidos en el esquema.
  const visible = fields.filter((f) => (f.weight ?? 0) > 0);
  const photoCol = includePhotos ? 1 : 0;
  const totalWeight = visible.reduce((acc, f) => acc + (f.weight ?? 1), 0) + photoCol * 1.1;
  const usableW = PAGE_W - MARGIN * 2;
  const colWidths = visible.map((f) => ((f.weight ?? 1) / totalWeight) * usableW);
  const photoW = includePhotos ? (1.1 / totalWeight) * usableW : 0;

  const cellPad = 5;
  const headH = 20;

  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const drawPageHeader = () => {
    page.drawRectangle({
      x: MARGIN,
      y: y - 22,
      width: 3,
      height: 26,
      color: ACCENT,
    });
    page.drawText(sanitizePdfText(title), {
      x: MARGIN + 10,
      y: y - 4,
      size: 13,
      font: fontBold,
      color: INK,
    });
    page.drawText(sanitizePdfText(subtitle), {
      x: MARGIN + 10,
      y: y - 17,
      size: 8.5,
      font,
      color: MUTED,
    });
    page.drawText(`${rows.length} leads`, {
      x: PAGE_W - MARGIN - 46,
      y: y - 4,
      size: 9,
      font: fontBold,
      color: MUTED,
    });
    y -= 30;
  };

  drawPageHeader();

  const drawTableHead = () => {
    page.drawRectangle({
      x: MARGIN,
      y: y - headH,
      width: usableW,
      height: headH,
      color: HEAD_BG,
    });
    let x = MARGIN;
    if (includePhotos) {
      page.drawText("FOTO", {
        x: x + 4,
        y: y - headH + 6,
        size: 7,
        font: fontBold,
        color: MUTED,
      });
      x += photoW;
    }
    visible.forEach((field, i) => {
      page.drawText(sanitizePdfText(field.label.toUpperCase()), {
        x: x + 4,
        y: y - headH + 6,
        size: 7,
        font: fontBold,
        color: MUTED,
      });
      x += colWidths[i];
    });
    page.drawLine({
      start: { x: MARGIN, y: y - headH },
      end: { x: MARGIN + usableW, y: y - headH },
      thickness: 0.8,
      color: LINE,
    });
    y -= headH;
  };

  drawTableHead();

  for (const row of rows) {
    // Calcula el alto necesario de la fila
    const cellLines: string[][] = [];
    visible.forEach((field, i) => {
      const text = row.cells[field.key] ?? "";
      cellLines.push(wrap(text, font, 8, colWidths[i] - cellPad * 2));
    });
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = Math.max(PHOTO_BOX, maxLines * 9.5 + cellPad * 2);

    if (y - rowH < MARGIN + 18) {
      page = pdf.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
      drawPageHeader();
      drawTableHead();
    }

    const rowTop = y;
    // Filete alternado muy suave para lectura horizontal
    if (rows.indexOf(row) % 2 === 1) {
      page.drawRectangle({
        x: MARGIN,
        y: rowTop - rowH,
        width: usableW,
        height: rowH,
        color: rgb(0.985, 0.99, 0.985),
      });
    }

    let x = MARGIN;
    if (includePhotos) {
      const bytes = row.thumbnail ? await fetchImage(row.thumbnail) : null;
      await drawThumbnail(
        page,
        bytes,
        x + 3,
        rowTop - PHOTO_BOX - 3,
        PHOTO_BOX,
        row.cells.nombre ?? "",
        fontBold
      );
      x += photoW;
    }

    visible.forEach((field, i) => {
      const lines = cellLines[i];
      const isKey = field.key === "nombre" || field.key === "dato_local";
      lines.forEach((line, li) => {
        page.drawText(sanitizePdfText(line), {
          x: x + cellPad,
          y: rowTop - 12 - li * 9.5,
          size: 8,
          font: isKey ? fontBold : font,
          color: INK,
        });
      });
      x += colWidths[i];
    });

    page.drawLine({
      start: { x: MARGIN, y: rowTop - rowH },
      end: { x: MARGIN + usableW, y: rowTop - rowH },
      thickness: 0.4,
      color: LINE,
    });

    y = rowTop - rowH;
  }

  // Pie de pagina con numeracion
  const total = pdf.getPageCount();
  pdf.getPages().forEach((p, i) => {
    p.drawText(sanitizePdfText(`${title} - pagina ${i + 1} de ${total}`), {
      x: MARGIN,
      y: 14,
      size: 7.5,
      font,
      color: MUTED,
    });
  });

  return pdf.save();
}
