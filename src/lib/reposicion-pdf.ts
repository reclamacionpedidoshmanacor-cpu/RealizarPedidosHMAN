import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import type { ReposicionLinea } from '@/lib/reposicion-neon';

const MARGIN = 50;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const USABLE_W = PAGE_W - MARGIN * 2;

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars - 1) + '...' : text;
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
    const disp = opts.maxWidth ? truncate(content, Math.floor(opts.maxWidth / (size * 0.5))) : content;
    this.page.drawText(disp, { x, y: this.y, size, font, color });
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
    }[],
    rowH = 16
  ) {
    this.ensureSpace(rowH);
    for (const col of cols) {
      const font = col.font ?? this.regular;
      const size = col.size ?? 9;
      const disp = col.maxWidth ? truncate(col.text, Math.floor(col.maxWidth / (size * 0.5))) : col.text;
      let x = col.x;
      if (col.align === 'right' && col.maxWidth) {
        const textW = font.widthOfTextAtSize(disp, size);
        x = col.x + col.maxWidth - textW;
      }
      this.page.drawText(disp, { x, y: this.y, size, font, color: col.color ?? rgb(0, 0, 0) });
    }
    this.moveDown(rowH);
  }
}

export function formatPdfDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function buildReposicionPdfFilename(pedidoId: number, fechaCreacion: string): string {
  const fecha = formatPdfDate(fechaCreacion).replace(/\//g, '-');
  return `albaran-reposicion-${pedidoId}-${fecha}.pdf`;
}

export async function buildReposicionPdf(
  pedidoId: number,
  fechaCreacion: string,
  fechaFinalizado: string | null,
  lineas: ReposicionLinea[]
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const w = new PageWriter(doc, regular, bold);

  w.text('ALBARAN DE REPOSICION', MARGIN, { size: 18, font: bold, color: rgb(0.05, 0.2, 0.45) });
  w.moveDown(22);
  w.text('Servicio de Farmacia Hospitalaria - Hospital de Manacor - Pacientes Externos', MARGIN, {
    size: 11,
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

  const COL = { cn: MARGIN, pa: MARGIN + 65, med: MARGIN + 230, qty: MARGIN + USABLE_W - 45 };
  const COL_W = { cn: 60, pa: 160, med: 165, qty: 45 };

  const porUbicacion = new Map<string, ReposicionLinea[]>();
  for (const l of lineas) {
    if (!porUbicacion.has(l.ubicacion)) porUbicacion.set(l.ubicacion, []);
    porUbicacion.get(l.ubicacion)!.push(l);
  }

  for (const [ubicacion, items] of porUbicacion) {
    w.ensureSpace(60);
    w.text(`Ubicacion: ${safe(ubicacion)}`, MARGIN, { size: 12, font: bold, color: rgb(0.07, 0.23, 0.52) });
    w.moveDown(16);

    w.textRow(
      [
        { text: 'CN', x: COL.cn, maxWidth: COL_W.cn, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4) },
        { text: 'Principio activo', x: COL.pa, maxWidth: COL_W.pa, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4) },
        { text: 'Medicamento', x: COL.med, maxWidth: COL_W.med, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4) },
        { text: 'Cajas', x: COL.qty, maxWidth: COL_W.qty, font: bold, size: 8, color: rgb(0.4, 0.4, 0.4), align: 'right' },
      ],
      18
    );

    w.line();
    w.moveDown(10);

    for (const l of items) {
      w.textRow(
        [
          { text: safe(l.cn), x: COL.cn, maxWidth: COL_W.cn, size: 9 },
          { text: safe(l.principioActivo ?? '-'), x: COL.pa, maxWidth: COL_W.pa, size: 9 },
          { text: safe(l.nombre), x: COL.med, maxWidth: COL_W.med, size: 9, font: oblique, color: rgb(0.35, 0.35, 0.35) },
          { text: String(l.cantidadCajas), x: COL.qty, maxWidth: COL_W.qty, size: 9, font: bold, align: 'right' },
        ],
        18
      );
    }

    w.moveDown(6);
    w.line(rgb(0.7, 0.7, 0.7), 0.3);
    w.moveDown(14);
  }

  const totalCajas = lineas.reduce((s, l) => s + l.cantidadCajas, 0);
  w.ensureSpace(40);
  w.text(`Total líneas: ${lineas.length}   |   Total cajas: ${totalCajas}`, PAGE_W - MARGIN - 200, {
    size: 10,
    font: bold,
  });
  w.moveDown(20);
  w.text('Documento generado automaticamente - Pacientes Externos', MARGIN, {
    size: 8,
    font: regular,
    color: rgb(0.6, 0.6, 0.6),
  });

  return doc.save();
}
