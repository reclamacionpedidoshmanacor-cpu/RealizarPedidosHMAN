import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB, PDFImage } from 'pdf-lib';
import type { AnalisisDatos, KpisAnalisis, TemporalPoint, TopMed, TopProtocolo } from '@/lib/analisis-neon';
import {
  GRUPO_COLORS,
  gruposParaServicio,
  type DiagnosticoGrupo,
  type Servicio,
} from '@/lib/diagnostico-grupos';
import type { InformeTipo } from '@/lib/informes-config';

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

export function buildInformePdfFilename(
  tipo: InformeTipo,
  slug: string,
  desde: string,
  hasta: string,
): string {
  const s = pdfSafe(slug).replace(/\s+/g, '-').toLowerCase();
  return `informe-${tipo}-${s}_${desde}_${hasta}.pdf`;
}

function resolveInformeData(datos: AnalisisDatos, tipo: InformeTipo) {
  if (tipo === 'grupo' && datos.grupoDetalle) {
    const gk = datos.grupoDetalle.kpis;
    const kpis: KpisAnalisis = {
      totalGasto: gk.totalGasto,
      totalPreparaciones: gk.totalPreparaciones,
      totalViales: gk.totalViales,
      mediaPackientesSemana: gk.mediaPackientesSemana,
      costePorPreparacion: gk.costePorPreparacion,
      variacionYoy: gk.variacionYoy,
      medicamentosDistintos: gk.medicamentosDistintos,
      protocolosActivos: gk.protocolosActivos,
    };
    return {
      kpis,
      topProtocolos: datos.grupoDetalle.topProtocolos,
      topMedicamentos: datos.grupoDetalle.topMedicamentos,
      temporalMensual: datos.grupoDetalle.temporalHistorico,
      pareto: datos.pareto,
    };
  }
  return {
    kpis: datos.kpis,
    topProtocolos: datos.topProtocolos,
    topMedicamentos: datos.topMedicamentos,
    temporalMensual: datos.temporalHistorico,
    pareto: datos.pareto,
  };
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
  lineaInforme: string,
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
  w.text(lineaInforme, MARGIN, { size: 12, font: w.bold });
  w.gap(14);
  const hoy = fmtDate(new Date().toISOString().slice(0, 10));
  w.text(
    `Periodo: ${fmtDate(datos.periodo.desde)} - ${fmtDate(datos.periodo.hasta)} (12 meses)  |  Generado: ${hoy}`,
    MARGIN,
    { size: 9, color: gray, maxWidth: USABLE_W },
  );
  w.gap(10);
  w.text(`Comparativa YoY: ${pdfSafe(datos.yoyEtiqueta)}`, MARGIN, {
    size: 8,
    font: oblique,
    color: gray,
    maxWidth: USABLE_W,
  });
  w.gap(16);
  w.line(rgb(0.55, 0.55, 0.55), 1);
  w.gap(18);
}

export async function buildInformeAnalisisPdf(
  tipo: InformeTipo,
  datos: AnalisisDatos,
  opts: {
    lineaInforme: string;
    servicio?: Servicio;
    grupo?: DiagnosticoGrupo;
  },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await loadInformeLogo(doc);
  const w = new PageWriter(doc, regular, bold);
  const gray = rgb(0.4, 0.4, 0.4);

  const { kpis, topProtocolos, topMedicamentos, temporalMensual, pareto } = resolveInformeData(datos, tipo);

  drawInformeCabecera(w, logo, oblique, datos, opts.lineaInforme);

  // ── KPIs ──
  w.sectionTitle('Resumen del periodo', 0);
  const kpiRows = [
    ['Gasto total', fmtEur(kpis.totalGasto), 'Preparaciones', String(kpis.totalPreparaciones)],
    ['EUR / preparacion', fmtEur(kpis.costePorPreparacion), 'Variacion YoY', fmtPct(kpis.variacionYoy)],
    ['Medicamentos distintos', String(kpis.medicamentosDistintos), 'Protocolos activos', String(kpis.protocolosActivos)],
  ];
  for (const row of kpiRows) {
    w.textRow([
      { text: row[0]!, x: MARGIN, maxWidth: 120, size: 8, color: gray },
      { text: row[1]!, x: MARGIN + 125, maxWidth: 100, size: 9, font: bold },
      { text: row[2]!, x: MARGIN + 260, maxWidth: 120, size: 8, color: gray },
      { text: row[3]!, x: MARGIN + 385, maxWidth: 100, size: 9, font: bold },
    ]);
  }
  w.gap(14);

  // ── Evolución mensual ──
  w.sectionTitle(`Evolucion mensual (gasto) — ${temporalMensual.length} meses`);
  w.drawMonthlyBars(temporalMensual);

  // ── Informe SERVICIO: grupos tumorales ──
  if (tipo === 'servicio' && opts.servicio) {
    const grupos = datos.grupos.filter(g => gruposParaServicio(opts.servicio!).includes(g.grupo));
    const svcTotal = grupos.reduce((s, g) => s + g.totalGasto, 0);
    w.sectionTitle('Distribucion por grupo tumoral');
    w.drawHorizontalBars(
      grupos.map(g => ({
        label: g.label,
        value: g.totalGasto,
        color: GRUPO_COLORS[g.grupo].chart,
        pct: svcTotal > 0 ? (g.totalGasto / svcTotal) * 100 : 0,
      })),
    );

    w.sectionTitle('Detalle por grupo tumoral');
    w.ensureTableBlock(1, Math.min(grupos.length, 3));
    w.tableBody(
      [
        { text: 'Grupo', x: MARGIN, maxWidth: 108 },
        { text: 'Gasto EUR', x: MARGIN + 112, maxWidth: 68, align: 'right' },
        { text: '% serv.', x: MARGIN + 186, maxWidth: 42, align: 'right' },
        { text: 'YoY', x: MARGIN + 234, maxWidth: 40, align: 'right' },
        { text: 'Prep.', x: MARGIN + 280, maxWidth: 38, align: 'right' },
        { text: 'Prot.', x: MARGIN + 324, maxWidth: 38, align: 'right' },
      ],
      grupos,
      g => [
        { text: g.label, x: MARGIN, maxWidth: 108, size: 8 },
        { text: fmtEurTable(g.totalGasto), x: MARGIN + 112, maxWidth: 68, size: 8, align: 'right' },
        { text: `${svcTotal > 0 ? ((g.totalGasto / svcTotal) * 100).toFixed(1) : '0.0'}%`, x: MARGIN + 186, maxWidth: 42, size: 8, align: 'right' },
        { text: fmtPct(g.variacionYoy), x: MARGIN + 234, maxWidth: 40, size: 8, align: 'right' },
        { text: String(g.totalPreparaciones), x: MARGIN + 280, maxWidth: 38, size: 8, align: 'right' },
        { text: String(g.protocolosActivos), x: MARGIN + 324, maxWidth: 38, size: 8, align: 'right' },
      ],
      15,
    );
    w.gap(12);
  }

  // ── Top 10 protocolos ──
  w.sectionTitle('Top 10 protocolos');
  drawTopProtocolosTable(w, topProtocolos);
  w.gap(12);

  // ── Top 10 medicamentos ──
  w.sectionTitle('Top 10 medicamentos');
  drawTopMedsTable(w, topMedicamentos);
  w.gap(12);

  // ── Pareto ──
  if (pareto.length) {
    w.sectionTitle('Concentracion del gasto (Pareto / ABC)');
    w.ensureTableBlock(1, Math.min(pareto.length, 4));
    w.tableBody(
      [
        { text: 'Medicamento', x: MARGIN, maxWidth: 200 },
        { text: 'Cl.', x: MARGIN + 206, maxWidth: 18 },
        { text: 'Gasto EUR', x: MARGIN + 230, maxWidth: 68, align: 'right' },
        { text: '% acum.', x: MARGIN + 304, maxWidth: 44, align: 'right' },
      ],
      pareto.slice(0, 10),
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

  // ── Desglose dx/indicación (servicio y grupo) ──
  if (topMedicamentos.length) {
    w.ensureSpace(100);
    w.sectionTitle('Desglose por diagnostico e indicacion (Top medicamentos)');
    w.drawMedDxBreakdown(topMedicamentos, 5, 6);
  }

  // ── Nota metodológica ──
  w.ensureSpace(80);
  w.line();
  w.gap(12);
  w.text('Nota metodologica', MARGIN, { size: 8, font: bold, color: gray });
  w.gap(12);
  const notas = [
    'Gasto calculado: viales dispensados x precio unitario (catalogo farmacia).',
    'Serie mensual: dato mensual fiable; si no hay mensual se usa suma semanal del mes.',
    'Variacion YoY: mismo tramo de meses del ano en curso vs ano anterior (dato mensual fiable).',
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
