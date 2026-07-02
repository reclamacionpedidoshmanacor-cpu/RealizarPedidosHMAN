import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB, PDFImage } from 'pdf-lib';
import type {
  AnalisisDatos,
  DxBreakdown,
  KpisAnalisis,
  MedicamentoTemporalPoint,
  TemporalPoint,
  TopMed,
  TopProtocolo,
} from '@/lib/analisis-neon';
import { GRUPO_COLORS } from '@/lib/diagnostico-grupos';

const MARGIN = 45;
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const USABLE_W = PAGE_W - MARGIN * 2;
const FOOTER_H = 40;
const LOGO_PATH = path.join(process.cwd(), 'public', 'Logo-Hospital-neg-MANACOR.jpg');
const LOGO_H = 46;
const HEADER_INSTITUCION = 'SERVICIO DE FARMACIA HOSPITALARIA - HOSPITAL DE MANACOR';

/** Columnas alineadas para tablas de protocolos / medicamentos. */
const TBL = {
  rank: { x: MARGIN, w: 22 },
  name: { x: MARGIN + 26, w: 228 },
  gasto: { x: MARGIN + 260, w: 72 },
  prep: { x: MARGIN + 338, w: 36 },
  extra: { x: MARGIN + 380, w: 62 },
} as const;

function pdfSafe(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('es-ES')} EUR`;
}

/** Formato compacto para tablas PDF (sin sufijo, ahorra ancho). */
function fmtEurTable(n: number): string {
  return Math.round(n).toLocaleString('es-ES');
}

/** Importe sobre barra del grafico mensual. */
function fmtEurBar(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(Math.round(n));
}

function truncateToWidth(text: string, font: PDFFont, size: number, maxW: number): string {
  let disp = pdfSafe(text);
  if (font.widthOfTextAtSize(disp, size) <= maxW) return disp;
  while (disp.length > 1 && font.widthOfTextAtSize(`${disp}..`, size) > maxW) {
    disp = disp.slice(0, -1);
  }
  return `${disp}..`;
}

function monthLabelShort(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length >= 2) {
    const mes = parts[0]!.slice(0, 3);
    const anio = parts[1]!.slice(-2);
    return `${mes}'${anio}`;
  }
  return pdfSafe(label).slice(0, 6);
}

function fmtPct(n: number | null): string {
  if (n === null) return '-';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return rgb(
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  );
}

class PageWriter {
  page: PDFPage;
  y: number;
  private readonly doc: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;

  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensureSpace(needed: number) {
    if (this.y - needed < MARGIN + FOOTER_H) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
  }

  gap(pts: number) { this.y -= pts; }

  line(color = rgb(0.82, 0.82, 0.82), thickness = 0.5) {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_W - MARGIN, y: this.y },
      thickness,
      color,
    });
  }

  text(content: string, x: number, opts: { size?: number; font?: PDFFont; color?: RGB; maxWidth?: number; y?: number } = {}) {
    const font = opts.font ?? this.regular;
    const size = opts.size ?? 10;
    const color = opts.color ?? rgb(0, 0, 0);
    const yPos = opts.y ?? this.y;
    let disp = pdfSafe(content);
    if (opts.maxWidth) {
      const maxChars = Math.floor(opts.maxWidth / (size * 0.48));
      if (disp.length > maxChars) disp = disp.slice(0, maxChars - 2) + '..';
    }
    this.page.drawText(disp, { x, y: yPos, size, font, color });
  }

  sectionTitle(title: string, topGap = 14) {
    this.gap(topGap);
    this.ensureSpace(36);
    this.text(title, MARGIN, { size: 12, font: this.bold, color: rgb(0.05, 0.25, 0.45) });
    this.gap(18);
  }

  /** Reserva espacio minimo (titulo + cabecera + N filas) antes de una tabla. */
  ensureTableBlock(headerRows: number, dataRows: number, rowH = 15) {
    const headerBlock = 14 + 4 + 1 + 14;
    const needed = 36 + 18 + headerBlock + rowH * dataRows;
    this.ensureSpace(needed);
  }

  tableBody<T>(
    headerCols: { text: string; x: number; maxWidth: number; align?: 'left' | 'right' }[],
    rows: T[],
    buildCols: (row: T, index: number) => { text: string; x: number; maxWidth?: number; align?: 'left' | 'right'; size?: number; font?: PDFFont; color?: RGB }[],
    rowH = 15,
  ) {
    const headerBlock = 14 + 4 + 1 + 14;
    let i = 0;
    while (i < rows.length) {
      if (this.y - headerBlock - rowH < MARGIN + FOOTER_H) {
        this.page = this.doc.addPage([PAGE_W, PAGE_H]);
        this.y = PAGE_H - MARGIN;
      }
      this.tableHeader(headerCols);
      while (i < rows.length) {
        if (this.y - rowH < MARGIN + FOOTER_H) break;
        this.textRow(buildCols(rows[i]!, i), rowH);
        i++;
      }
    }
  }

  textRow(
    cols: { text: string; x: number; maxWidth?: number; align?: 'left' | 'right'; size?: number; font?: PDFFont; color?: RGB }[],
    rowH = 14,
  ) {
    this.ensureSpace(rowH + 2);
    for (const col of cols) {
      const font = col.font ?? this.regular;
      const size = col.size ?? 8;
      const disp = col.maxWidth
        ? truncateToWidth(col.text, font, size, col.maxWidth)
        : pdfSafe(col.text);
      let x = col.x;
      if (col.align === 'right' && col.maxWidth) {
        x = col.x + col.maxWidth - font.widthOfTextAtSize(disp, size);
      }
      this.page.drawText(disp, { x, y: this.y, size, font, color: col.color ?? rgb(0, 0, 0) });
    }
    this.gap(rowH);
  }

  /** Cabecera de tabla + línea + margen antes de filas de datos. */
  tableHeader(
    cols: { text: string; x: number; maxWidth: number; align?: 'left' | 'right' }[],
    rowH = 14,
  ) {
    this.textRow(
      cols.map(c => ({
        text: c.text,
        x: c.x,
        maxWidth: c.maxWidth,
        align: c.align,
        size: 7,
        font: this.bold,
        color: rgb(0.4, 0.4, 0.4),
      })),
      rowH,
    );
    this.gap(4);
    this.line();
    this.gap(14);
  }

  drawMonthlyBars(points: TemporalPoint[], chartH = 150) {
    if (!points.length) return;
    const labelH = 28;
    const valueH = 14;
    const topPad = 6;
    const totalH = chartH + labelH + valueH + topPad + 16;
    this.ensureSpace(totalH);
    this.gap(topPad);

    const chartW = USABLE_W;
    const baseY = this.y - chartH;
    const maxVal = Math.max(...points.map(p => p.gasto), 1);
    const n = points.length;
    const slotW = chartW / n;
    const barW = Math.min(22, Math.max(6, slotW * 0.5));
    const lblSize = 6.5;
    const valSize = 5.5;

    this.page.drawLine({
      start: { x: MARGIN, y: baseY },
      end: { x: MARGIN + chartW, y: baseY },
      thickness: 0.6,
      color: rgb(0.65, 0.65, 0.65),
    });

    points.forEach((p, i) => {
      const h = p.gasto > 0 ? Math.max(3, (p.gasto / maxVal) * (chartH - 16)) : 0;
      const slotX = MARGIN + i * slotW;
      const x = slotX + (slotW - barW) / 2;

      const valStr = fmtEurBar(p.gasto);
      const valW = this.regular.widthOfTextAtSize(valStr, valSize);
      const valY = h > 0 ? baseY + h + 3 : baseY + 3;
      this.page.drawText(valStr, {
        x: slotX + Math.max(0, (slotW - valW) / 2),
        y: valY,
        size: valSize,
        font: this.bold,
        color: p.gasto > 0 ? rgb(0.15, 0.15, 0.15) : rgb(0.55, 0.55, 0.55),
      });

      if (h > 0) {
        this.page.drawRectangle({
          x, y: baseY, width: barW, height: h,
          color: rgb(0.05, 0.58, 0.53),
        });
      }

      const lbl = monthLabelShort(p.label);
      const lw = this.regular.widthOfTextAtSize(lbl, lblSize);
      this.page.drawText(lbl, {
        x: slotX + Math.max(0, (slotW - lw) / 2),
        y: baseY - labelH + 6,
        size: lblSize,
        font: this.regular,
        color: rgb(0.3, 0.3, 0.3),
      });
    });

    this.y = baseY - labelH - 14;
    this.gap(10);
  }

  drawHorizontalBars(
    items: { label: string; value: number; color: string; pct?: number }[],
    maxItems = 8,
  ) {
    const slice = items.slice(0, maxItems);
    const maxVal = Math.max(...slice.map(i => i.value), 1);
    const labelW = 98;
    const valueW = 108;
    const barX = MARGIN + labelW + 6;
    const barMaxW = USABLE_W - labelW - valueW - 14;
    const rowH = 30;

    for (const item of slice) {
      this.ensureSpace(rowH + 4);
      this.text(item.label, MARGIN, { size: 8, maxWidth: labelW });

      const rightLabel = item.pct != null
        ? `${fmtEurTable(item.value)} (${item.pct.toFixed(1)}%)`
        : fmtEurTable(item.value);
      const rlW = this.regular.widthOfTextAtSize(pdfSafe(rightLabel), 7);
      this.text(rightLabel, MARGIN + USABLE_W - rlW, { size: 7, color: rgb(0.35, 0.35, 0.35) });

      const barY = this.y - 14;
      const bw = Math.max(3, (item.value / maxVal) * barMaxW);
      this.page.drawRectangle({
        x: barX,
        y: barY,
        width: bw,
        height: 10,
        color: hexToRgb(item.color),
      });
      this.gap(rowH);
    }
    this.gap(10);
  }

  drawMedDxBreakdown(meds: TopMed[], maxMeds = 5, maxDx = 6) {
    for (const m of meds.slice(0, maxMeds)) {
      this.ensureSpace(28 + maxDx * 13);
      this.text(
        `${m.principioActivo || m.nombre} — ${fmtEur(m.totalGasto)}`,
        MARGIN,
        { size: 9, font: this.bold, color: rgb(0.05, 0.58, 0.53), maxWidth: USABLE_W },
      );
      this.gap(14);
      for (const dx of m.desgloseByDx.slice(0, maxDx)) {
        const pct = m.totalGasto > 0 ? (dx.gasto / m.totalGasto) * 100 : 0;
        this.textRow([
          { text: dx.diagnostico, x: MARGIN, maxWidth: 118, size: 7 },
          { text: dx.indicacion, x: MARGIN + 122, maxWidth: 108, size: 7, color: rgb(0.45, 0.45, 0.45) },
          { text: fmtEurTable(dx.gasto), x: MARGIN + 234, maxWidth: 58, size: 7, align: 'right' },
          { text: `${pct.toFixed(1)}%`, x: MARGIN + 298, maxWidth: 36, size: 7, align: 'right', font: this.bold },
        ], 13);
      }
      this.gap(10);
    }
  }
}

export function buildInformePdfFilename(slug: string, desde: string, hasta: string): string {
  const s = pdfSafe(slug).replace(/\s+/g, '-').replace(/-+/g, '-').toLowerCase();
  return `informe-analisis-${s}_${desde}_${hasta}.pdf`;
}

async function loadInformeLogo(doc: PDFDocument): Promise<PDFImage | null> {
  try {
    const bytes = await readFile(LOGO_PATH);
    return await doc.embedJpg(bytes);
  } catch {
    return null;
  }
}

function drawInformeCabecera(
  w: PageWriter,
  logo: PDFImage | null,
  oblique: PDFFont,
  datos: AnalisisDatos,
  opts: { lineaInforme: string; subtitulo?: string },
) {
  const gray = rgb(0.4, 0.4, 0.4);
  const brand = rgb(0.05, 0.2, 0.45);

  if (logo) {
    const scale = LOGO_H / logo.height;
    const logoW = logo.width * scale;
    w.page.drawImage(logo, {
      x: MARGIN,
      y: w.y - LOGO_H,
      width: logoW,
      height: LOGO_H,
    });
    const textX = MARGIN + logoW + 12;
    w.text(HEADER_INSTITUCION, textX, {
      size: 9,
      font: w.bold,
      color: gray,
      y: w.y - 14,
      maxWidth: PAGE_W - MARGIN - textX,
    });
    w.y -= LOGO_H + 16;
  } else {
    w.text(HEADER_INSTITUCION, MARGIN, { size: 9, font: w.bold, color: gray });
    w.gap(14);
  }

  w.text('Informe farmaeconomico de actividad', MARGIN, { size: 15, font: w.bold, color: brand });
  w.gap(18);
  w.text(opts.lineaInforme, MARGIN, { size: 12, font: w.bold });
  w.gap(14);
  if (opts.subtitulo) {
    w.text(opts.subtitulo, MARGIN, { size: 9, color: gray, maxWidth: USABLE_W });
    w.gap(12);
  }
  const hoy = fmtDate(new Date().toISOString().slice(0, 10));
  w.text(
    `Periodo: ${fmtDate(datos.periodo.desde)} - ${fmtDate(datos.periodo.hasta)}  |  Generado: ${hoy}`,
    MARGIN,
    { size: 9, color: gray, maxWidth: USABLE_W },
  );
  w.gap(10);
  w.text(`Comparativa: ${pdfSafe(datos.comparativa?.etiqueta ?? datos.yoyEtiqueta)}`, MARGIN, {
    size: 8,
    font: oblique,
    color: gray,
    maxWidth: USABLE_W,
  });
  w.gap(16);
  w.line(rgb(0.55, 0.55, 0.55), 1);
  w.gap(18);
}

function fmtQty(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0';
  const rounded = digits === 0 ? Math.round(n) : Number(n.toFixed(digits));
  const needsDecimal = digits > 0 && Math.abs(rounded - Math.round(rounded)) > 0.001;
  return rounded.toLocaleString('es-ES', {
    minimumFractionDigits: needsDecimal ? Math.min(1, digits) : 0,
    maximumFractionDigits: digits,
  });
}

function buildKpiRows(kpis: KpisAnalisis) {
  return [
    ['Gasto valorizado', fmtEur(kpis.totalGasto), 'Consumo (cajas eq.)', fmtQty(kpis.totalViales)],
    ['Unidades', fmtQty(kpis.totalUnidades, 0), 'Preparaciones', fmtQty(kpis.totalPreparaciones, 0)],
    ['EUR / preparacion', fmtEur(kpis.costePorPreparacion), 'Variacion', fmtPct(kpis.variacionYoy)],
    ['Medicamentos distintos', fmtQty(kpis.medicamentosDistintos, 0), 'Protocolos activos', fmtQty(kpis.protocolosActivos, 0)],
  ];
}

function servicioBars(datos: AnalisisDatos) {
  const total = datos.servicios.reduce((sum, item) => sum + item.totalGasto, 0);
  const palette = ['#0f766e', '#0369a1', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#16a34a', '#475569'];
  return datos.servicios.map((item, index) => ({
    label: item.servicio,
    value: item.totalGasto,
    color: palette[index % palette.length]!,
    pct: total > 0 ? (item.totalGasto / total) * 100 : 0,
  }));
}

function grupoBars(datos: AnalisisDatos) {
  return datos.grupos.map((item) => ({
    label: item.label,
    value: item.totalGasto,
    color: GRUPO_COLORS[item.grupo].chart,
    pct: item.pctGasto,
  }));
}

function drawScopeKpis(w: PageWriter, kpis: KpisAnalisis) {
  const rows = buildKpiRows(kpis);
  for (const row of rows) {
    w.textRow([
      { text: row[0]!, x: MARGIN, maxWidth: 132, size: 8, color: rgb(0.4, 0.4, 0.4) },
      { text: row[1]!, x: MARGIN + 138, maxWidth: 112, size: 9, font: w.bold },
      { text: row[2]!, x: MARGIN + 275, maxWidth: 132, size: 8, color: rgb(0.4, 0.4, 0.4) },
      { text: row[3]!, x: MARGIN + 413, maxWidth: 96, size: 9, font: w.bold },
    ]);
  }
  w.gap(14);
}

function drawTemporalResumenTable(w: PageWriter, rows: TemporalPoint[], title: string) {
  if (!rows.length) return;
  w.sectionTitle(title);
  w.ensureTableBlock(1, Math.min(rows.length, 5));
  w.tableBody(
    [
      { text: 'Periodo', x: MARGIN, maxWidth: 120 },
      { text: 'Cajas eq.', x: MARGIN + 126, maxWidth: 52, align: 'right' },
      { text: 'Unidades', x: MARGIN + 184, maxWidth: 56, align: 'right' },
      { text: 'Prep.', x: MARGIN + 246, maxWidth: 40, align: 'right' },
      { text: 'Gasto EUR', x: MARGIN + 292, maxWidth: 70, align: 'right' },
    ],
    rows,
    (row) => [
      { text: row.lunesRef ? fmtDate(row.lunesRef) : row.label, x: MARGIN, maxWidth: 120, size: 8 },
      { text: fmtQty(row.viales), x: MARGIN + 126, maxWidth: 52, size: 8, align: 'right' },
      { text: fmtQty(row.unidades, 0), x: MARGIN + 184, maxWidth: 56, size: 8, align: 'right' },
      { text: fmtQty(row.preparaciones, 0), x: MARGIN + 246, maxWidth: 40, size: 8, align: 'right' },
      { text: fmtEurTable(row.gasto), x: MARGIN + 292, maxWidth: 70, size: 8, align: 'right' },
    ],
    15,
  );
  w.gap(10);
}

function drawDiagnosticosGrupoTable(w: PageWriter, datos: AnalisisDatos) {
  if (!datos.grupoDetalle?.diagnosticos.length) return;
  const rows = [...datos.grupoDetalle.diagnosticos]
    .sort((a, b) => b.totalGasto - a.totalGasto)
    .slice(0, 12);
  w.sectionTitle(`Diagnosticos dentro de ${datos.grupoDetalle.label}`);
  w.ensureTableBlock(1, Math.min(rows.length, 5));
  w.tableBody(
    [
      { text: 'Diagnostico', x: MARGIN, maxWidth: 222 },
      { text: 'Gasto EUR', x: MARGIN + 228, maxWidth: 68, align: 'right' },
      { text: 'Prep.', x: MARGIN + 302, maxWidth: 42, align: 'right' },
      { text: 'Indic.', x: MARGIN + 350, maxWidth: 42, align: 'right' },
    ],
    rows,
    (row) => [
      { text: row.diagnostico || 'Sin diagnostico', x: MARGIN, maxWidth: 222, size: 8 },
      { text: fmtEurTable(row.totalGasto), x: MARGIN + 228, maxWidth: 68, size: 8, align: 'right' },
      { text: fmtQty(row.totalPreparaciones, 0), x: MARGIN + 302, maxWidth: 42, size: 8, align: 'right' },
      { text: fmtQty(row.indicaciones.length, 0), x: MARGIN + 350, maxWidth: 42, size: 8, align: 'right' },
    ],
    15,
  );
  w.gap(10);
}

function drawDxBreakdownTable(w: PageWriter, rows: DxBreakdown[], title: string) {
  if (!rows.length) return;
  w.sectionTitle(title);
  w.ensureTableBlock(1, Math.min(rows.length, 5));
  w.tableBody(
    [
      { text: 'Diagnostico', x: MARGIN, maxWidth: 140 },
      { text: 'Indicacion', x: MARGIN + 146, maxWidth: 122 },
      { text: 'Servicio', x: MARGIN + 274, maxWidth: 88 },
      { text: 'Cajas eq.', x: MARGIN + 368, maxWidth: 52, align: 'right' },
      { text: 'Gasto EUR', x: MARGIN + 426, maxWidth: 70, align: 'right' },
    ],
    rows,
    (row) => [
      { text: row.diagnostico || 'Sin diagnostico', x: MARGIN, maxWidth: 140, size: 8 },
      { text: row.indicacion || 'Sin indicacion', x: MARGIN + 146, maxWidth: 122, size: 8, color: rgb(0.35, 0.35, 0.35) },
      { text: row.servicio || 'Sin servicio', x: MARGIN + 274, maxWidth: 88, size: 8 },
      { text: fmtQty(row.viales), x: MARGIN + 368, maxWidth: 52, size: 8, align: 'right' },
      { text: fmtEurTable(row.gasto), x: MARGIN + 426, maxWidth: 70, size: 8, align: 'right' },
    ],
    15,
  );
  w.gap(10);
}

function drawMedicamentoTemporalTable(
  w: PageWriter,
  rows: MedicamentoTemporalPoint[],
  title: string,
  limit = 12,
) {
  if (!rows.length) return;
  const slice = rows.slice(-limit);
  w.sectionTitle(title);
  w.ensureTableBlock(1, Math.min(slice.length, 5));
  w.tableBody(
    [
      { text: 'Periodo', x: MARGIN, maxWidth: 94 },
      { text: 'Cons. cajas', x: MARGIN + 100, maxWidth: 58, align: 'right' },
      { text: 'Comp. cajas', x: MARGIN + 164, maxWidth: 58, align: 'right' },
      { text: 'Cons. EUR', x: MARGIN + 228, maxWidth: 62, align: 'right' },
      { text: 'Comp. EUR', x: MARGIN + 296, maxWidth: 62, align: 'right' },
      { text: 'Prep.', x: MARGIN + 364, maxWidth: 40, align: 'right' },
    ],
    slice,
    (row) => [
      { text: row.lunesRef ? fmtDate(row.lunesRef) : row.label, x: MARGIN, maxWidth: 94, size: 8 },
      { text: fmtQty(row.consumoCajas), x: MARGIN + 100, maxWidth: 58, size: 8, align: 'right' },
      { text: fmtQty(row.comprasCajas), x: MARGIN + 164, maxWidth: 58, size: 8, align: 'right' },
      { text: fmtEurTable(row.consumoGasto), x: MARGIN + 228, maxWidth: 62, size: 8, align: 'right' },
      { text: fmtEurTable(row.comprasGasto), x: MARGIN + 296, maxWidth: 62, size: 8, align: 'right' },
      { text: fmtQty(row.preparaciones, 0), x: MARGIN + 364, maxWidth: 40, size: 8, align: 'right' },
    ],
    15,
  );
  w.gap(10);
}

function drawMedicamentoSection(w: PageWriter, datos: AnalisisDatos) {
  const med = datos.medicamentoDetalle;
  if (!med) return;

  w.sectionTitle('Ficha de medicamento');
  w.text(`${med.principioActivo || med.nombre}  |  CN ${med.cn}`, MARGIN, {
    size: 10,
    font: w.bold,
    color: rgb(0.05, 0.25, 0.45),
    maxWidth: USABLE_W,
  });
  w.gap(14);
  if (med.nombre && med.nombre !== med.principioActivo) {
    w.text(med.nombre, MARGIN, { size: 8, color: rgb(0.35, 0.35, 0.35), maxWidth: USABLE_W });
    w.gap(12);
  }

  const resumen = [
    ['Precio unidad', fmtEur(med.precioUnidad), 'Uds/caja', fmtQty(med.unidadesPorCaja, 0)],
    ['Consumo cajas', fmtQty(med.consumo.totalViales), 'Compras cajas', fmtQty(med.compras.totalViales)],
    ['Consumo EUR', fmtEur(med.consumo.totalGasto), 'Compras EUR', fmtEur(med.compras.totalGasto)],
    ['Preparaciones', fmtQty(med.consumo.totalPreparaciones, 0), 'Pedidos recibidos', fmtQty(med.compras.nPedidosRecibidos, 0)],
  ];
  for (const row of resumen) {
    w.textRow([
      { text: row[0]!, x: MARGIN, maxWidth: 132, size: 8, color: rgb(0.4, 0.4, 0.4) },
      { text: row[1]!, x: MARGIN + 138, maxWidth: 112, size: 9, font: w.bold },
      { text: row[2]!, x: MARGIN + 275, maxWidth: 132, size: 8, color: rgb(0.4, 0.4, 0.4) },
      { text: row[3]!, x: MARGIN + 413, maxWidth: 96, size: 9, font: w.bold },
    ]);
  }
  w.gap(10);

  if (med.porServicio.length > 1) {
    const total = med.porServicio.reduce((sum, item) => sum + item.totalGasto, 0);
    const palette = ['#0f766e', '#0369a1', '#dc2626', '#7c3aed', '#ea580c', '#0891b2', '#16a34a', '#475569'];
    w.sectionTitle('Distribucion del medicamento por servicio');
    w.drawHorizontalBars(
      med.porServicio.map((item, index) => ({
        label: item.servicio,
        value: item.totalGasto,
        color: palette[index % palette.length]!,
        pct: total > 0 ? (item.totalGasto / total) * 100 : 0,
      })),
    );
  }

  if (med.porGrupo.length > 1) {
    w.sectionTitle('Distribucion del medicamento por tipo tumoral');
    w.drawHorizontalBars(
      med.porGrupo.map((item) => ({
        label: item.label,
        value: item.totalGasto,
        color: GRUPO_COLORS[item.grupo].chart,
        pct: item.pctGasto,
      })),
    );
  }

  if (med.topProtocolos.length) {
    w.sectionTitle('Top protocolos del medicamento');
    drawTopProtocolosTable(w, med.topProtocolos.slice(0, 10));
    w.gap(10);
  }

  drawDxBreakdownTable(w, med.topDiagnosticos.slice(0, 12), 'Diagnosticos e indicaciones del medicamento');
  drawMedicamentoTemporalTable(w, med.temporalMensual, 'Evolucion mensual del medicamento', 12);
  drawMedicamentoTemporalTable(w, med.temporalSemanal, 'Detalle semanal reciente del medicamento', 10);
}

export async function buildInformeAnalisisPdf(
  datos: AnalisisDatos,
  opts: {
    lineaInforme: string;
    subtitulo?: string;
  },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await loadInformeLogo(doc);
  const w = new PageWriter(doc, regular, bold);
  const gray = rgb(0.4, 0.4, 0.4);

  drawInformeCabecera(w, logo, oblique, datos, opts);

  // ── KPIs ──
  w.sectionTitle('Resumen del periodo', 0);
  drawScopeKpis(w, datos.kpis);

  // ── Evolución mensual ──
  if (datos.temporalHistorico.length) {
    w.sectionTitle(`Evolucion mensual del gasto — ${datos.temporalHistorico.length} periodos`);
    w.drawMonthlyBars(datos.temporalHistorico);
  }

  if (!datos.scope.servicio && !datos.scope.grupo && datos.servicios.length > 1) {
    w.sectionTitle('Distribucion del gasto por servicio real');
    w.drawHorizontalBars(servicioBars(datos));
  }

  if (!datos.scope.grupo && datos.grupos.length > 1) {
    w.sectionTitle('Distribucion del gasto por tipo tumoral');
    w.drawHorizontalBars(grupoBars(datos));
  }

  if (datos.temporalReciente.length) {
    drawTemporalResumenTable(w, datos.temporalReciente.slice(-8), 'Detalle semanal reciente');
  }

  drawDiagnosticosGrupoTable(w, datos);

  // ── Top protocolos ──
  w.sectionTitle('Top 10 protocolos');
  drawTopProtocolosTable(w, datos.topProtocolos);
  w.gap(12);

  if (datos.topMedicamentos.length) {
    w.sectionTitle('Top 10 medicamentos');
    drawTopMedsTable(w, datos.topMedicamentos);
    w.gap(12);
  }

  // ── Pareto ──
  if (datos.pareto.length) {
    w.sectionTitle('Concentracion del gasto (Pareto / ABC)');
    w.ensureTableBlock(1, Math.min(datos.pareto.length, 4));
    w.tableBody(
      [
        { text: 'Medicamento', x: MARGIN, maxWidth: 200 },
        { text: 'Cl.', x: MARGIN + 206, maxWidth: 18 },
        { text: 'Gasto EUR', x: MARGIN + 230, maxWidth: 68, align: 'right' },
        { text: '% acum.', x: MARGIN + 304, maxWidth: 44, align: 'right' },
      ],
      datos.pareto.slice(0, 10),
      p => [
        { text: p.principioActivo || p.nombre, x: MARGIN, maxWidth: 200, size: 8 },
        { text: p.clase, x: MARGIN + 206, maxWidth: 18, size: 8, font: bold },
        { text: fmtEurTable(p.gasto), x: MARGIN + 230, maxWidth: 68, size: 8, align: 'right' },
        { text: `${p.pctAcumulado.toFixed(0)}%`, x: MARGIN + 304, maxWidth: 44, size: 8, align: 'right' },
      ],
      15,
    );
    w.gap(12);
  }

  if (datos.topMedicamentos.length) {
    w.ensureSpace(100);
    w.sectionTitle('Desglose por diagnostico e indicacion (Top medicamentos)');
    w.drawMedDxBreakdown(datos.topMedicamentos, 5, 6);
  }

  drawMedicamentoSection(w, datos);

  // ── Nota metodológica ──
  w.ensureSpace(80);
  w.line();
  w.gap(12);
  w.text('Nota metodologica', MARGIN, { size: 8, font: bold, color: gray });
  w.gap(12);
  const notas = [
    'El analisis incluye solo CN presentes en el catalogo activo del area.',
    'Consumos y compras fisicas se expresan en cajas equivalentes: unidades / unidades_por_caja.',
    'Gasto valorizado: unidades x precio_unidad actual del catalogo; no hay historico de coste por unidad.',
    'No se explotan datos de pacientes; la referencia asistencial disponible es el numero de preparaciones.',
    'La comparativa siempre usa el periodo anterior equivalente y el detalle reciente se muestra por semanas reales.',
  ];
  for (const n of notas) {
    w.text(`· ${n}`, MARGIN, { size: 7, color: gray, maxWidth: USABLE_W });
    w.gap(11);
  }

  w.gap(8);
  w.text('Documento generado por Farmacia Oncologica HMAN — descarga manual', MARGIN, {
    size: 7,
    font: oblique,
    color: rgb(0.55, 0.55, 0.55),
  });

  return doc.save();
}

function drawTopProtocolosTable(w: PageWriter, data: TopProtocolo[]) {
  w.ensureTableBlock(1, Math.min(data.length, 4));
  w.tableBody(
    [
      { text: '#', x: TBL.rank.x, maxWidth: TBL.rank.w },
      { text: 'Protocolo', x: TBL.name.x, maxWidth: TBL.name.w },
      { text: 'Gasto EUR', x: TBL.gasto.x, maxWidth: TBL.gasto.w, align: 'right' },
      { text: 'Prep.', x: TBL.prep.x, maxWidth: TBL.prep.w, align: 'right' },
      { text: 'EUR/prep', x: TBL.extra.x, maxWidth: TBL.extra.w, align: 'right' },
    ],
    data,
    (p, i) => [
      { text: String(i + 1), x: TBL.rank.x, maxWidth: TBL.rank.w, size: 8 },
      { text: p.protocolo, x: TBL.name.x, maxWidth: TBL.name.w, size: 8 },
      { text: fmtEurTable(p.totalGasto), x: TBL.gasto.x, maxWidth: TBL.gasto.w, size: 8, align: 'right' },
      { text: String(p.totalPreparaciones), x: TBL.prep.x, maxWidth: TBL.prep.w, size: 8, align: 'right' },
      { text: fmtEurTable(p.costePorPreparacion), x: TBL.extra.x, maxWidth: TBL.extra.w, size: 8, align: 'right' },
    ],
    15,
  );
}

function drawTopMedsTable(w: PageWriter, data: TopMed[]) {
  const yoyX = MARGIN + 376;
  w.ensureTableBlock(1, Math.min(data.length, 4));
  w.tableBody(
    [
      { text: '#', x: TBL.rank.x, maxWidth: TBL.rank.w },
      { text: 'Principio activo', x: TBL.name.x, maxWidth: 198 },
      { text: 'Gasto EUR', x: TBL.gasto.x, maxWidth: TBL.gasto.w, align: 'right' },
      { text: 'Prep.', x: TBL.prep.x, maxWidth: TBL.prep.w, align: 'right' },
      { text: 'YoY', x: yoyX, maxWidth: 28, align: 'right' },
      { text: 'EUR/prep', x: TBL.extra.x, maxWidth: TBL.extra.w, align: 'right' },
    ],
    data,
    (m, i) => [
      { text: String(i + 1), x: TBL.rank.x, maxWidth: TBL.rank.w, size: 8 },
      { text: m.principioActivo || m.nombre, x: TBL.name.x, maxWidth: 198, size: 8 },
      { text: fmtEurTable(m.totalGasto), x: TBL.gasto.x, maxWidth: TBL.gasto.w, size: 8, align: 'right' },
      { text: String(m.totalPreparaciones), x: TBL.prep.x, maxWidth: TBL.prep.w, size: 8, align: 'right' },
      { text: fmtPct(m.variacionYoy), x: yoyX, maxWidth: 28, size: 8, align: 'right' },
      { text: fmtEurTable(m.costePorPreparacion), x: TBL.extra.x, maxWidth: TBL.extra.w, size: 8, align: 'right' },
    ],
    15,
  );
}
