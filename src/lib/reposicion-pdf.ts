import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import type { ReposicionLinea } from '@/lib/reposicion-neon';

const MARGIN = 50;
const LOGO_PATH = path.join(process.cwd(), 'public', 'Logo-Hospital-neg-MANACOR.jpg');
const LOGO_H = 40;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const USABLE_W = PAGE_W - MARGIN * 2;

/** Recorta con puntos suspensivos midiendo el ancho real de la fuente. */
function fitLine(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (font.widthOfTextAtSize(`${text.slice(0, mid)}...`, size) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low).trimEnd()}...`;
}

/** Reparte el texto en como máximo `maxLines` líneas sin salirse de la columna. */
function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const clean = text.trim();
  if (!clean) return [''];
  if (maxLines <= 1) return [fitLine(clean, font, size, maxWidth)];

  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(fitLine(word, font, size, maxWidth));
      current = '';
    }

    if (lines.length === maxLines - 1) {
      const resto = [current, ...words.slice(i + 1)].filter(Boolean).join(' ');
      if (resto) lines.push(fitLine(resto, font, size, maxWidth));
      return lines;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function safe(text: string): string {
  return text.replace(/[^\x00-\xFF]/g, '');
}

class PageWriter {
  private page: PDFPage;
  private y: number;
  private readonly doc: PDFDocument;
  private readonly regular: PDFFont;
  private readonly bold: PDFFont;

  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN + 40) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
  }

  moveDown(pts: number) {
    this.y -= pts;
  }

  image(img: PDFImage, x: number, width: number, height: number) {
    this.page.drawImage(img, { x, y: this.y - height, width, height });
  }

  line(color = rgb(0.8, 0.8, 0.8), thickness = 0.5) {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness,
      color,
    });
  }

  text(
    content: string,
    x: number,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; maxWidth?: number } = {}
  ) {
    const font = opts.font ?? this.regular;
    const size = opts.size ?? 10;
    const color = opts.color ?? rgb(0, 0, 0);
    const disp = opts.maxWidth ? fitLine(content, font, size, opts.maxWidth) : content;
    this.page.drawText(disp, { x, y: this.y, size, font, color });
  }

  textRight(
    content: string,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {}
  ) {
    const font = opts.font ?? this.regular;
    const size = opts.size ?? 10;
    const width = font.widthOfTextAtSize(content, size);
    this.page.drawText(content, {
      x: PAGE_W - MARGIN - width,
      y: this.y,
      size,
      font,
      color: opts.color ?? rgb(0, 0, 0),
    });
  }

  get cursorY(): number {
    return this.y;
  }

  set cursorY(value: number) {
    this.y = value;
  }

  textRow(
    cols: {
      text: string;
      x: number;
      maxWidth?: number;
      align?: 'left' | 'right';
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      maxLines?: number;
    }[],
    rowH = 16
  ) {
    const celdas = cols.map((col) => {
      const font = col.font ?? this.regular;
      const size = col.size ?? 9;
      const lineas = col.maxWidth
        ? wrapText(col.text, font, size, col.maxWidth, col.maxLines ?? 1)
        : [col.text];
      return { col, font, size, lineas, lineH: size + 2.5 };
    });

    const altoExtra = Math.max(
      ...celdas.map((celda) => (celda.lineas.length - 1) * celda.lineH)
    );
    this.ensureSpace(rowH + altoExtra);

    for (const celda of celdas) {
      celda.lineas.forEach((linea, indice) => {
        let x = celda.col.x;
        if (celda.col.align === 'right' && celda.col.maxWidth) {
          const textW = celda.font.widthOfTextAtSize(linea, celda.size);
          x = celda.col.x + celda.col.maxWidth - textW;
        }
        this.page.drawText(linea, {
          x,
          y: this.y - indice * celda.lineH,
          size: celda.size,
          font: celda.font,
          color: celda.col.color ?? rgb(0, 0, 0),
        });
      });
    }

    this.moveDown(rowH + altoExtra);
  }
}

export function formatPdfDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function buildReposicionPdfFilename(
  pedidoId: number,
  fechaCreacion: string,
  consultaDestino?: string | null,
): string {
  const fecha = formatPdfDate(fechaCreacion).replace(/\//g, '-');
  const consulta = consultaDestino?.trim();
  const sufijo = consulta ? `-${consulta}` : '';
  return `albaran-reposicion-${pedidoId}-${fecha}${sufijo}.pdf`;
}

async function loadLogo(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    return await doc.embedJpg(await readFile(LOGO_PATH));
  } catch {
    return null;
  }
}

export async function buildReposicionPdf(
  pedidoId: number,
  fechaCreacion: string,
  fechaFinalizado: string | null,
  lineas: ReposicionLinea[],
  area = 'upe',
  consultaDestino: string | null = null,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const w = new PageWriter(doc, regular, bold);
  const logo = await loadLogo(doc);

  const consulta = safe(consultaDestino?.trim() ?? '');

  if (logo) {
    const logoW = (logo.width * LOGO_H) / logo.height;
    w.image(logo, MARGIN, logoW, LOGO_H);
  }

  if (consulta) {
    const inicioCabecera = w.cursorY;
    w.textRight('CONSULTA DESTINO', { size: 8, font: bold, color: rgb(0.4, 0.4, 0.4) });
    w.moveDown(24);
    w.textRight(consulta, { size: 24, font: bold, color: rgb(0.05, 0.2, 0.45) });
    w.cursorY = inicioCabecera;
  }

  if (logo || consulta) {
    w.moveDown(LOGO_H + 20);
  }

  w.text('ALBARÁN DE REPOSICIÓN', MARGIN, { size: 18, font: bold, color: rgb(0.05, 0.2, 0.45) });
  w.moveDown(26);
  const areaLabel = area === 'oncologia' ? 'ONCOLOGÍA' : 'PACIENTES EXTERNOS';
  w.text(areaLabel, MARGIN, { size: 20, font: bold, color: rgb(0, 0, 0) });
  w.moveDown(20);
  w.text('Servicio de Farmacia Hospitalaria - Hospital de Manacor', MARGIN, {
    size: 10,
    font: regular,
    color: rgb(0.35, 0.35, 0.35),
    maxWidth: USABLE_W,
  });
  w.moveDown(14);
  w.line(rgb(0.6, 0.6, 0.6), 1);
  w.moveDown(12);

  const meta = `Nº Pedido: ${pedidoId}    Fecha: ${formatPdfDate(fechaCreacion)}${fechaFinalizado ? `    Finalizado: ${formatPdfDate(fechaFinalizado)}` : ''}`;
  w.text(meta, MARGIN, { size: 10, font: regular, color: rgb(0.2, 0.2, 0.2) });
  w.moveDown(18);

  const COL = {
    cn: MARGIN,
    ppio: MARGIN + 74,
    med: MARGIN + 252,
    qty: MARGIN + USABLE_W - 52,
  };
  const COL_W = { cn: 68, ppio: 172, med: 187, qty: 52 };
  const ROW_SIZE = 8.5;

  const porUbicacion = new Map<string, ReposicionLinea[]>();
  for (const l of lineas) {
    if (!porUbicacion.has(l.ubicacion)) porUbicacion.set(l.ubicacion, []);
    porUbicacion.get(l.ubicacion)!.push(l);
  }

  for (const [ubicacion, items] of porUbicacion) {
    w.ensureSpace(80);
    w.text(`Ubicacion destino: ${safe(ubicacion)}`, MARGIN, { size: 13, font: bold, color: rgb(0.07, 0.23, 0.52) });
    w.moveDown(18);

    const porOrigen = new Map<string, ReposicionLinea[]>();
    for (const l of items) {
      const origen = l.ubicacionOrigen ?? (l.tipo === 'formula' ? 'Elaboracion propia' : 'Sin ubicacion asignada');
      if (!porOrigen.has(origen)) porOrigen.set(origen, []);
      porOrigen.get(origen)!.push(l);
    }

    for (const [origen, filas] of [...porOrigen].sort((a, b) => a[0].localeCompare(b[0], 'es'))) {
      w.ensureSpace(60);
      w.text(`Ubicacion origen: ${safe(origen)}`, MARGIN + 10, { size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
      w.moveDown(16);

      w.textRow(
        [
          { text: 'CN', x: COL.cn, maxWidth: COL_W.cn, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4) },
          { text: 'Principio activo', x: COL.ppio, maxWidth: COL_W.ppio, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4) },
          { text: 'Marca', x: COL.med, maxWidth: COL_W.med, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4) },
          { text: 'Cantidad', x: COL.qty, maxWidth: COL_W.qty, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4), align: 'right' },
        ],
        14
      );

      w.line();
      w.moveDown(10);

      const ordenadas = [...filas].sort((a, b) =>
        (a.principioActivo ?? a.nombre).localeCompare(b.principioActivo ?? b.nombre, 'es', {
          sensitivity: 'base',
        })
      );

      for (const l of ordenadas) {
        w.textRow(
          [
            { text: safe(l.tipo === 'formula' ? l.codigo : l.cn), x: COL.cn, maxWidth: COL_W.cn, size: ROW_SIZE },
            { text: safe(l.principioActivo ?? '-'), x: COL.ppio, maxWidth: COL_W.ppio, size: ROW_SIZE, maxLines: 2 },
            { text: safe(l.nombre), x: COL.med, maxWidth: COL_W.med, size: ROW_SIZE, color: rgb(0.3, 0.3, 0.3), maxLines: 2 },
            { text: `${l.cantidadCajas} ${l.unidadPedido === 'unidades' ? 'ud.' : 'caj.'}`, x: COL.qty, maxWidth: COL_W.qty, size: ROW_SIZE, font: bold, align: 'right' },
          ],
          17
        );
        if (l.notas) {
          w.textRow(
            [{
              text: `Nota: ${safe(l.notas)}`,
              x: COL.ppio,
              maxWidth: COL_W.ppio + COL_W.med + 6,
              size: 8,
              font: oblique,
              color: rgb(0.45, 0.25, 0.05),
              maxLines: 2,
            }],
            14,
          );
        }
      }

      w.moveDown(4);
      w.line(rgb(0.85, 0.85, 0.85), 0.3);
      w.moveDown(16);
    }
  }

  w.ensureSpace(40);
  w.text(`Total lineas: ${lineas.length}`, PAGE_W - MARGIN - 120, {
    size: 10,
    font: bold,
  });
  w.moveDown(20);
  w.text(`Documento generado automaticamente - ${areaLabel.toLowerCase()}`, MARGIN, {
    size: 8,
    font: regular,
    color: rgb(0.6, 0.6, 0.6),
  });

  return doc.save();
}
