import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB } from 'pdf-lib';
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

function pdfSafe(text: string): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}

function fmtEur(n: number): string {
  return `${Math.round(n).toLocaleString('es-ES')} EUR`;
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

  textRow(
    cols: { text: string; x: number; maxWidth?: number; align?: 'left' | 'right'; size?: number; font?: PDFFont; color?: RGB }[],
    rowH = 14,
  ) {
    this.ensureSpace(rowH + 2);
    for (const col of cols) {
      const font = col.font ?? this.regular;
      const size = col.size ?? 8;
      let disp = pdfSafe(col.text);
      if (col.maxWidth) {
        const maxChars = Math.floor(col.maxWidth / (size * 0.48));
        if (disp.length > maxChars) disp = disp.slice(0, maxChars - 2) + '..';
      }
      let x = col.x;
      if (col.align === 'right' && col.maxWidth) {
        x = col.x + col.maxWidth - font.widthOfTextAtSize(disp, size);
      }
      this.page.drawText(disp, { x, y: this.y, size, font, color: col.color ?? rgb(0, 0, 0) });
    }
    this.gap(rowH);
  }

  drawMonthlyBars(points: TemporalPoint[], chartH = 100) {
    if (!points.length) return;
    const labelH = 16;
    const totalH = chartH + labelH + 12;
    this.ensureSpace(totalH);
    this.gap(4);

    const chartW = USABLE_W;
    const baseY = this.y - chartH;
    const maxVal = Math.max(...points.map(p => p.gasto), 1);
    const barW = Math.max(4, Math.min(14, (chartW - 16) / points.length - 1));

    this.page.drawLine({
      start: { x: MARGIN, y: baseY },
      end: { x: MARGIN + chartW, y: baseY },
      thickness: 0.5,
      color: rgb(0.72, 0.72, 0.72),
    });

    points.forEach((p, i) => {
      const h = p.gasto > 0 ? Math.max(1, (p.gasto / maxVal) * (chartH - 10)) : 0;
      const x = MARGIN + 8 + i * (barW + 1);
      if (h > 0) {
        this.page.drawRectangle({
          x, y: baseY, width: barW, height: h,
          color: rgb(0.05, 0.58, 0.53),
        });
      }
      const showLbl = points.length <= 13 || i % 2 === 0 || i === points.length - 1;
      if (showLbl) {
        const short = pdfSafe(p.label.replace(' ', '').slice(0, 7));
        this.page.drawText(short, {
          x: Math.max(MARGIN, x - 1),
          y: baseY - labelH + 4,
          size: 5,
          font: this.regular,
          color: rgb(0.45, 0.45, 0.45),
        });
      }
    });

    this.y = baseY - labelH - 8;
    this.gap(10);
  }

  drawHorizontalBars(
    items: { label: string; value: number; color: string; pct?: number }[],
    maxItems = 8,
  ) {
    const slice = items.slice(0, maxItems);
    const maxVal = Math.max(...slice.map(i => i.value), 1);
    const barMaxW = USABLE_W - 175;
    const rowH = 22;

    for (const item of slice) {
      this.ensureSpace(rowH + 6);
      this.text(item.label, MARGIN, { size: 8, maxWidth: 110 });
      const barY = this.y - 13;
      const bw = (item.value / maxVal) * barMaxW;
      this.page.drawRectangle({
        x: MARGIN + 115,
        y: barY,
        width: Math.max(bw, 2),
        height: 9,
        color: hexToRgb(item.color),
      });
      const rightLabel = item.pct != null
        ? `${fmtEur(item.value)} (${item.pct.toFixed(1)}%)`
        : fmtEur(item.value);
      const rlW = this.regular.widthOfTextAtSize(pdfSafe(rightLabel), 7);
      this.text(rightLabel, MARGIN + USABLE_W - rlW, {
        size: 7,
        color: rgb(0.35, 0.35, 0.35),
      });
      this.gap(rowH);
    }
    this.gap(8);
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
          { text: dx.diagnostico, x: MARGIN, maxWidth: 125, size: 7 },
          { text: dx.indicacion, x: MARGIN + 130, maxWidth: 115, size: 7, color: rgb(0.45, 0.45, 0.45) },
          { text: fmtEur(dx.gasto), x: MARGIN + 250, maxWidth: 55, size: 7, align: 'right' },
          { text: `${pct.toFixed(1)}%`, x: MARGIN + 310, maxWidth: 40, size: 7, align: 'right', font: this.bold },
        ], 12);
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

export async function buildInformeAnalisisPdf(
  tipo: InformeTipo,
  datos: AnalisisDatos,
  opts: {
    titulo: string;
    subtitulo: string;
    servicio?: Servicio;
    grupo?: DiagnosticoGrupo;
  },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await doc.embedFont(StandardFonts.HelveticaOblique);
  const w = new PageWriter(doc, regular, bold);
  const gray = rgb(0.4, 0.4, 0.4);

  const { kpis, topProtocolos, topMedicamentos, temporalMensual, pareto } = resolveInformeData(datos, tipo);

  // ── Cabecera ──
  w.text('SERVICIO DE FARMACIA HOSPITALARIA', MARGIN, { size: 9, color: gray });
  w.gap(14);
  w.text('Informe farmaeconomico de actividad', MARGIN, { size: 16, font: bold, color: rgb(0.05, 0.2, 0.45) });
  w.gap(20);
  w.text(opts.titulo, MARGIN, { size: 13, font: bold });
  w.gap(14);
  w.text(opts.subtitulo, MARGIN, { size: 10, color: gray, maxWidth: USABLE_W });
  w.gap(12);
  w.text(
    `Periodo: ${fmtDate(datos.periodo.desde)} - ${fmtDate(datos.periodo.hasta)} (12 meses)  |  Generado: ${fmtDate(new Date().toISOString().slice(0, 10))}`,
    MARGIN,
    { size: 9, color: gray, maxWidth: USABLE_W },
  );
  w.gap(10);
  w.text(`Comparativa YoY: ${pdfSafe(datos.yoyEtiqueta)}`, MARGIN, { size: 8, font: oblique, color: gray, maxWidth: USABLE_W });
  w.gap(16);
  w.line(rgb(0.55, 0.55, 0.55), 1);
  w.gap(18);

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
    w.textRow([
      { text: 'Grupo', x: MARGIN, maxWidth: 100, font: bold, size: 7, color: gray },
      { text: 'Gasto', x: MARGIN + 105, maxWidth: 70, font: bold, size: 7, color: gray, align: 'right' },
      { text: '% serv.', x: MARGIN + 180, maxWidth: 45, font: bold, size: 7, color: gray, align: 'right' },
      { text: 'YoY', x: MARGIN + 230, maxWidth: 45, font: bold, size: 7, color: gray, align: 'right' },
      { text: 'Prep.', x: MARGIN + 280, maxWidth: 45, font: bold, size: 7, color: gray, align: 'right' },
      { text: 'Protocolos', x: MARGIN + 330, maxWidth: 55, font: bold, size: 7, color: gray, align: 'right' },
    ], 16);
    w.line();
    w.gap(6);
    for (const g of grupos) {
      w.textRow([
        { text: g.label, x: MARGIN, maxWidth: 100, size: 8 },
        { text: fmtEur(g.totalGasto), x: MARGIN + 105, maxWidth: 70, size: 8, align: 'right' },
        { text: `${svcTotal > 0 ? ((g.totalGasto / svcTotal) * 100).toFixed(1) : '0.0'}%`, x: MARGIN + 180, maxWidth: 45, size: 8, align: 'right' },
        { text: fmtPct(g.variacionYoy), x: MARGIN + 230, maxWidth: 45, size: 8, align: 'right' },
        { text: String(g.totalPreparaciones), x: MARGIN + 280, maxWidth: 45, size: 8, align: 'right' },
        { text: String(g.protocolosActivos), x: MARGIN + 330, maxWidth: 55, size: 8, align: 'right' },
      ]);
    }
    w.gap(12);
  }

  // ── Top 10 protocolos ──
  w.ensureSpace(120);
  w.sectionTitle('Top 10 protocolos');
  drawTopProtocolosTable(w, topProtocolos, gray);
  w.gap(12);

  // ── Top 10 medicamentos ──
  w.ensureSpace(120);
  w.sectionTitle('Top 10 medicamentos');
  drawTopMedsTable(w, topMedicamentos, gray);
  w.gap(12);

  // ── Pareto ──
  if (pareto.length) {
    w.ensureSpace(80);
    w.sectionTitle('Concentracion del gasto (Pareto / ABC)');
    w.textRow([
      { text: 'Medicamento', x: MARGIN, maxWidth: 140, font: bold, size: 7, color: gray },
      { text: 'Clase', x: MARGIN + 145, maxWidth: 30, font: bold, size: 7, color: gray },
      { text: 'Gasto', x: MARGIN + 180, maxWidth: 65, font: bold, size: 7, color: gray, align: 'right' },
      { text: '% acum.', x: MARGIN + 250, maxWidth: 45, font: bold, size: 7, color: gray, align: 'right' },
    ], 16);
    w.line();
    w.gap(6);
    for (const p of pareto.slice(0, 10)) {
      w.textRow([
        { text: p.principioActivo || p.nombre, x: MARGIN, maxWidth: 140, size: 8 },
        { text: p.clase, x: MARGIN + 145, maxWidth: 30, size: 8, font: bold },
        { text: fmtEur(p.gasto), x: MARGIN + 180, maxWidth: 65, size: 8, align: 'right' },
        { text: `${p.pctAcumulado.toFixed(0)}%`, x: MARGIN + 250, maxWidth: 45, size: 8, align: 'right' },
      ]);
    }
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
    'Serie mensual: todos los meses del periodo; meses sin actividad aparecen a cero.',
    'Desde jun 2026 el detalle semanal se agrega al mes correspondiente.',
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

function drawTopProtocolosTable(w: PageWriter, data: TopProtocolo[], gray: RGB) {
  w.textRow([
    { text: '#', x: MARGIN, maxWidth: 15, font: w.bold, size: 7, color: gray },
    { text: 'Protocolo', x: MARGIN + 18, maxWidth: 180, font: w.bold, size: 7, color: gray },
    { text: 'Gasto', x: MARGIN + 200, maxWidth: 65, font: w.bold, size: 7, color: gray, align: 'right' },
    { text: 'Prep.', x: MARGIN + 270, maxWidth: 40, font: w.bold, size: 7, color: gray, align: 'right' },
    { text: 'EUR/prep', x: MARGIN + 315, maxWidth: 55, font: w.bold, size: 7, color: gray, align: 'right' },
  ], 16);
  w.line();
  w.gap(6);
  for (const [i, p] of data.entries()) {
    w.textRow([
      { text: String(i + 1), x: MARGIN, maxWidth: 15, size: 8 },
      { text: p.protocolo, x: MARGIN + 18, maxWidth: 180, size: 8 },
      { text: fmtEur(p.totalGasto), x: MARGIN + 200, maxWidth: 65, size: 8, align: 'right' },
      { text: String(p.totalPreparaciones), x: MARGIN + 270, maxWidth: 40, size: 8, align: 'right' },
      { text: fmtEur(p.costePorPreparacion), x: MARGIN + 315, maxWidth: 55, size: 8, align: 'right' },
    ]);
  }
}

function drawTopMedsTable(w: PageWriter, data: TopMed[], gray: RGB) {
  w.textRow([
    { text: '#', x: MARGIN, maxWidth: 15, font: w.bold, size: 7, color: gray },
    { text: 'Principio activo', x: MARGIN + 18, maxWidth: 120, font: w.bold, size: 7, color: gray },
    { text: 'Gasto', x: MARGIN + 140, maxWidth: 60, font: w.bold, size: 7, color: gray, align: 'right' },
    { text: 'Prep.', x: MARGIN + 205, maxWidth: 35, font: w.bold, size: 7, color: gray, align: 'right' },
    { text: 'YoY', x: MARGIN + 245, maxWidth: 40, font: w.bold, size: 7, color: gray, align: 'right' },
    { text: 'EUR/prep', x: MARGIN + 290, maxWidth: 55, font: w.bold, size: 7, color: gray, align: 'right' },
  ], 16);
  w.line();
  w.gap(6);
  for (const [i, m] of data.entries()) {
    w.textRow([
      { text: String(i + 1), x: MARGIN, maxWidth: 15, size: 8 },
      { text: m.principioActivo || m.nombre, x: MARGIN + 18, maxWidth: 120, size: 8 },
      { text: fmtEur(m.totalGasto), x: MARGIN + 140, maxWidth: 60, size: 8, align: 'right' },
      { text: String(m.totalPreparaciones), x: MARGIN + 205, maxWidth: 35, size: 8, align: 'right' },
      { text: fmtPct(m.variacionYoy), x: MARGIN + 245, maxWidth: 40, size: 8, align: 'right' },
      { text: fmtEur(m.costePorPreparacion), x: MARGIN + 290, maxWidth: 55, size: 8, align: 'right' },
    ]);
  }
}
