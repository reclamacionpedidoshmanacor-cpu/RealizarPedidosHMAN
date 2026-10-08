import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireApiSession } from '@/lib/api-auth';
import {
  getAnalisisExport,
  parseVia,
  VIA_LABELS,
  VIA_NOMBRES,
  type AnalisisExport,
  type TemporalPoint,
} from '@/lib/analisis-neon';
import { GRUPO_LABELS, type DiagnosticoGrupo } from '@/lib/diagnostico-grupos';

export const runtime = 'nodejs';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const FMT = {
  eur: '#,##0.00 "€"',
  int: '#,##0',
  dec: '#,##0.0',
  pct: '0.0%',
  variacion: '+0.0%;-0.0%;0.0%',
} as const;

const COLOR_HEADER = 'FF1E3A5F';
const COLOR_DESTACADO = 'FFCCFBF1';
const YEAR_TINTS = ['FFF1F5F9', 'FFF0FDFA', 'FFEFF6FF', 'FFFDF4FF', 'FFF7FEE7'];

type Col = { header: string; key: string; width: number; fmt?: string; variacion?: boolean };
type Row = Record<string, string | number | null>;

function defaultDesde(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  d.setMonth(d.getMonth() + 1, 1);
  return d.toISOString().slice(0, 10);
}

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function variacionFraccion(pct: number | null): number | null {
  return pct == null ? null : pct / 100;
}

function yearTint(anio: number): string {
  const n = YEAR_TINTS.length;
  return YEAR_TINTS[(((anio - 2024) % n) + n) % n] ?? YEAR_TINTS[0]!;
}

function addTitulo(ws: ExcelJS.Worksheet, titulo: string, subtitulo: string, nCols: number) {
  const r1 = ws.getRow(1);
  r1.getCell(1).value = titulo;
  r1.getCell(1).font = { bold: true, size: 14, color: { argb: COLOR_HEADER } };
  ws.mergeCells(1, 1, 1, Math.max(nCols, 1));
  const r2 = ws.getRow(2);
  r2.getCell(1).value = subtitulo;
  r2.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  ws.mergeCells(2, 1, 2, Math.max(nCols, 1));
}

function addTabla(
  wb: ExcelJS.Workbook,
  nombre: string,
  titulo: string,
  subtitulo: string,
  cols: Col[],
  rows: Row[],
  opts: { destacar?: (row: Row) => boolean; relleno?: (row: Row) => string | undefined; nota?: string } = {},
) {
  const ws = wb.addWorksheet(nombre.slice(0, 31));
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  addTitulo(ws, titulo, subtitulo, cols.length);

  let headerRowIdx = 4;
  if (opts.nota) {
    const rn = ws.getRow(3);
    rn.getCell(1).value = opts.nota;
    rn.getCell(1).font = { size: 9, color: { argb: 'FF92400E' } };
    ws.mergeCells(3, 1, 3, cols.length);
    headerRowIdx = 5;
  }

  const header = ws.getRow(headerRowIdx);
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  header.height = 30;

  rows.forEach((data, i) => {
    const row = ws.getRow(headerRowIdx + 1 + i);
    const destacado = opts.destacar?.(data) ?? false;
    const relleno = destacado ? COLOR_DESTACADO : opts.relleno?.(data) ?? (i % 2 === 1 ? 'FFF8FAFC' : undefined);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      const value = data[c.key];
      cell.value = value ?? null;
      cell.font = { size: 10, bold: destacado };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
      if (relleno) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: relleno } };
      if (c.fmt) cell.numFmt = c.fmt;
      if (c.variacion && typeof value === 'number') {
        const color = value < 0 ? 'FF047857' : value < 0.03 ? 'FFB45309' : 'FFBE123C';
        cell.font = { size: 10, bold: true, color: { argb: color } };
      }
    });
  });

  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }];
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: headerRowIdx, column: cols.length },
  };
  return ws;
}

function mediaMovil3(data: TemporalPoint[]): Array<number | null> {
  const now = new Date();
  const parcial = (pt: TemporalPoint) => pt.anio === now.getFullYear() && pt.mes === now.getMonth() + 1;
  return data.map((_, idx) => {
    if (idx < 2) return null;
    const ventana = data.slice(idx - 2, idx + 1);
    if (ventana.some(parcial)) return null;
    return ventana.reduce((s, p) => s + p.gasto, 0) / 3;
  });
}

function describeFiltros(datos: AnalisisExport): string[] {
  const { scope } = datos;
  const out: string[] = [];
  if (scope.servicio) out.push(`Servicio: ${scope.servicio}`);
  if (scope.grupo) out.push(`Tipo tumoral: ${GRUPO_LABELS[scope.grupo as DiagnosticoGrupo] ?? scope.grupo}`);
  if (scope.via) out.push(`Ámbito: ${VIA_NOMBRES[scope.via]}`);
  if (scope.cn) {
    const med = datos.medicamentos.find((m) => m.cn === scope.cn);
    out.push(`Medicamento: ${med ? `${med.principioActivo || med.nombre} (CN ${scope.cn})` : `CN ${scope.cn}`}`);
  }
  return out;
}

function buildResumen(wb: ExcelJS.Workbook, datos: AnalisisExport, subtitulo: string, filtros: string[]) {
  const ws = wb.addWorksheet('Resumen');
  ws.columns = [{ width: 38 }, { width: 22 }, { width: 18 }, { width: 18 }];
  addTitulo(ws, 'Análisis de Oncología — Farmacia Hospital de Manacor', subtitulo, 4);

  let r = 4;
  const label = (text: string) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold: true, size: 11, color: { argb: COLOR_HEADER } };
  };
  const kv = (k: string, v: string | number | null, fmt?: string, variacion = false) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = k;
    row.getCell(1).font = { size: 10, color: { argb: 'FF475569' } };
    const cell = row.getCell(2);
    cell.value = v;
    cell.font = { size: 10, bold: true };
    if (fmt) cell.numFmt = fmt;
    if (variacion && typeof v === 'number') {
      cell.font = { size: 10, bold: true, color: { argb: v < 0 ? 'FF047857' : v < 0.03 ? 'FFB45309' : 'FFBE123C' } };
    }
  };

  label('Alcance del informe');
  kv('Período', `${fmtFecha(datos.periodo.desde)} – ${fmtFecha(datos.periodo.hasta)}`);
  kv('Comparativa', datos.comparativa.etiqueta);
  kv('Filtros', filtros.length ? filtros.join(' · ') : 'Vista global del área');
  kv('Generado', new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }));
  r++;

  const k = datos.kpis;
  label('Indicadores');
  kv('Gasto valorizado', round2(k.totalGasto), FMT.eur);
  kv('Variación frente al período anterior', variacionFraccion(k.variacionYoy), FMT.variacion, true);
  kv('Consumo (cajas equivalentes)', k.totalViales, FMT.dec);
  kv('Consumo (unidades)', k.totalUnidades, FMT.int);
  kv('Preparaciones HDD / dispensaciones FARONC', k.totalPreparaciones, FMT.int);
  kv('Medicamentos distintos', k.medicamentosDistintos, FMT.int);
  kv('Protocolos activos', k.protocolosActivos, FMT.int);
  kv('Servicios activos', k.serviciosActivos, FMT.int);
  r++;

  label('Hospital de Día (HDD) y Consulta Farmacia (FARONC)');
  const head = ws.getRow(r++);
  ['Ámbito', 'Gasto', '% del alcance', 'Variación'].forEach((h, i) => {
    const cell = head.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };
  });
  for (const v of datos.vias) {
    const row = ws.getRow(r++);
    row.getCell(1).value = `${v.label} (${v.medicamentosDistintos} medicamentos)`;
    row.getCell(2).value = round2(v.totalGasto);
    row.getCell(2).numFmt = FMT.eur;
    row.getCell(3).value = v.pctGasto / 100;
    row.getCell(3).numFmt = FMT.pct;
    const varCell = row.getCell(4);
    varCell.value = variacionFraccion(v.variacionYoy);
    varCell.numFmt = FMT.variacion;
  }
  r++;

  label('Notas');
  const notas = [
    'Gasto valorizado = unidades consumidas × precio por unidad actual del catálogo.',
    'Cajas equivalentes = unidades / unidades por caja.',
    'HDD: medicamentos IV administrados en Hospital de Día (preparaciones). FARONC: medicamentos orales dispensados en la Consulta de Farmacia (dispensaciones).',
    datos.comprasRegistroDesde
      ? `Compras: pedidos recibidos registrados en Pedidos Pendientes desde el ${fmtFecha(datos.comprasRegistroDesde)}; son del área y no se reparten por servicio.`
      : 'Compras: pedidos recibidos registrados en Pedidos Pendientes; son del área y no se reparten por servicio.',
    'No incluye datos identificativos de pacientes.',
  ];
  for (const n of notas) {
    const row = ws.getRow(r++);
    row.getCell(1).value = `· ${n}`;
    row.getCell(1).font = { size: 9, color: { argb: 'FF64748B' } };
    ws.mergeCells(row.number, 1, row.number, 4);
  }
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json({ error: 'Solo disponible para Oncología.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || defaultDesde();
  const hasta = searchParams.get('hasta') || new Date().toISOString().slice(0, 10);
  const grupoRaw = searchParams.get('grupo')?.trim() || null;
  const grupo = grupoRaw && grupoRaw in GRUPO_LABELS ? (grupoRaw as DiagnosticoGrupo) : null;
  const servicio = searchParams.get('servicio')?.trim() || null;
  const cn = searchParams.get('cn')?.trim() || null;
  const via = parseVia(searchParams.get('via'));

  const datos = await getAnalisisExport(session.area, desde, hasta, grupo, servicio, cn, via);
  const filtros = describeFiltros(datos);
  const subtitulo = [
    `Período ${fmtFecha(desde)} – ${fmtFecha(hasta)}`,
    filtros.length ? filtros.join(' · ') : 'Vista global del área',
  ].join(' · ');

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Farmacia HMAN';
  wb.created = new Date();

  buildResumen(wb, datos, subtitulo, filtros);

  const mm = mediaMovil3(datos.temporalHistorico);
  addTabla(
    wb,
    'Evolución mensual',
    'Evolución mensual del gasto y del consumo',
    subtitulo,
    [
      { header: 'Año', key: 'anio', width: 8 },
      { header: 'Mes', key: 'mes', width: 12 },
      { header: 'Gasto', key: 'gasto', width: 16, fmt: FMT.eur },
      { header: 'Gasto HDD', key: 'gastoIv', width: 16, fmt: FMT.eur },
      { header: 'Gasto FARONC', key: 'gastoOral', width: 16, fmt: FMT.eur },
      { header: 'Media móvil 3 meses (gasto)', key: 'mm3', width: 18, fmt: FMT.eur },
      { header: 'Cajas eq.', key: 'cajas', width: 12, fmt: FMT.dec },
      { header: 'Preparaciones / dispensaciones', key: 'prep', width: 18, fmt: FMT.int },
    ],
    datos.temporalHistorico.map((t, i) => ({
      anio: t.anio,
      mes: MESES[t.mes - 1] ?? String(t.mes),
      gasto: round2(t.gasto),
      gastoIv: round2(t.gastoPorVia?.IV ?? 0),
      gastoOral: round2(t.gastoPorVia?.ORAL ?? 0),
      mm3: mm[i] != null ? round2(mm[i]!) : null,
      cajas: t.viales,
      prep: t.preparaciones,
    })),
    { relleno: (row) => yearTint(Number(row.anio)) },
  );

  addTabla(
    wb,
    'Servicios',
    'Gasto por servicio clínico',
    `${subtitulo} · El servicio seleccionado aparece destacado`,
    [
      { header: 'Servicio', key: 'servicio', width: 34 },
      { header: 'Gasto', key: 'gasto', width: 16, fmt: FMT.eur },
      { header: '% del alcance', key: 'pct', width: 12, fmt: FMT.pct },
      { header: 'Variación', key: 'var', width: 12, fmt: FMT.variacion, variacion: true },
      { header: 'Gasto HDD', key: 'iv', width: 16, fmt: FMT.eur },
      { header: 'Gasto FARONC', key: 'oral', width: 16, fmt: FMT.eur },
      { header: '% FARONC', key: 'pctOral', width: 10, fmt: FMT.pct },
      { header: 'Cajas eq.', key: 'cajas', width: 12, fmt: FMT.dec },
      { header: 'Prep. / disp.', key: 'prep', width: 12, fmt: FMT.int },
    ],
    datos.servicios.map((s) => ({
      servicio: s.servicio,
      gasto: round2(s.totalGasto),
      pct: s.pctGasto / 100,
      var: variacionFraccion(s.variacionYoy),
      iv: round2(s.gastoPorVia.IV),
      oral: round2(s.gastoPorVia.ORAL),
      pctOral: s.totalGasto > 0 ? s.gastoPorVia.ORAL / s.totalGasto : 0,
      cajas: s.totalViales,
      prep: s.totalPreparaciones,
    })),
    { destacar: (row) => !!datos.scope.servicio && row.servicio === datos.scope.servicio },
  );

  const grupoSelLabel = datos.scope.grupo ? GRUPO_LABELS[datos.scope.grupo as DiagnosticoGrupo] : null;
  addTabla(
    wb,
    'Tipos tumorales',
    'Gasto por tipo tumoral',
    `${subtitulo} · El tipo tumoral seleccionado aparece destacado`,
    [
      { header: 'Tipo tumoral', key: 'grupo', width: 24 },
      { header: 'Gasto', key: 'gasto', width: 16, fmt: FMT.eur },
      { header: '% del alcance', key: 'pct', width: 12, fmt: FMT.pct },
      { header: 'Variación', key: 'var', width: 12, fmt: FMT.variacion, variacion: true },
      { header: 'Gasto HDD', key: 'iv', width: 16, fmt: FMT.eur },
      { header: 'Gasto FARONC', key: 'oral', width: 16, fmt: FMT.eur },
      { header: '% FARONC', key: 'pctOral', width: 10, fmt: FMT.pct },
      { header: 'Cajas eq.', key: 'cajas', width: 12, fmt: FMT.dec },
      { header: 'Prep. / disp.', key: 'prep', width: 12, fmt: FMT.int },
      { header: 'Medicamentos', key: 'meds', width: 13, fmt: FMT.int },
      { header: 'Protocolos', key: 'prots', width: 11, fmt: FMT.int },
    ],
    [...datos.grupos]
      .sort((a, b) => b.totalGasto - a.totalGasto)
      .map((g) => ({
        grupo: g.label,
        gasto: round2(g.totalGasto),
        pct: g.pctGasto / 100,
        var: variacionFraccion(g.variacionYoy),
        iv: round2(g.gastoPorVia.IV),
        oral: round2(g.gastoPorVia.ORAL),
        pctOral: g.totalGasto > 0 ? g.gastoPorVia.ORAL / g.totalGasto : 0,
        cajas: g.totalViales,
        prep: g.totalPreparaciones,
        meds: g.medicamentosDistintos,
        prots: g.protocolosActivos,
      })),
    { destacar: (row) => !!grupoSelLabel && row.grupo === grupoSelLabel },
  );

  addTabla(
    wb,
    'Medicamentos',
    'Medicamentos del alcance (lista completa)',
    subtitulo,
    [
      { header: 'CN', key: 'cn', width: 10 },
      { header: 'Principio activo', key: 'pa', width: 34 },
      { header: 'Nombre comercial', key: 'nombre', width: 30 },
      { header: 'Ámbito', key: 'via', width: 9 },
      { header: 'Tipo tumoral principal', key: 'grupo', width: 20 },
      { header: 'Gasto', key: 'gasto', width: 16, fmt: FMT.eur },
      { header: 'Variación', key: 'var', width: 12, fmt: FMT.variacion, variacion: true },
      { header: 'Cajas eq.', key: 'cajas', width: 12, fmt: FMT.dec },
      { header: 'Unidades', key: 'uds', width: 11, fmt: FMT.int },
      { header: 'Prep. / disp.', key: 'prep', width: 12, fmt: FMT.int },
    ],
    datos.medicamentos.map((m) => ({
      cn: m.cn,
      pa: m.principioActivo,
      nombre: m.nombre,
      via: VIA_LABELS[m.via],
      grupo: GRUPO_LABELS[m.grupo] ?? m.grupo,
      gasto: round2(m.totalGasto),
      var: variacionFraccion(m.variacionYoy),
      cajas: m.totalViales,
      uds: m.totalUnidades,
      prep: m.totalPreparaciones,
    })),
    { destacar: (row) => !!datos.scope.cn && row.cn === datos.scope.cn },
  );

  if (datos.protocolosCompletos.length) {
    addTabla(
      wb,
      'Protocolos',
      'Protocolos del alcance (lista completa)',
      subtitulo,
      [
        { header: 'Protocolo', key: 'prot', width: 40 },
        { header: 'Gasto', key: 'gasto', width: 16, fmt: FMT.eur },
        { header: 'Preparaciones', key: 'prep', width: 14, fmt: FMT.int },
        { header: '€ / preparación', key: 'cxp', width: 16, fmt: FMT.eur },
        { header: 'Cajas eq.', key: 'cajas', width: 12, fmt: FMT.dec },
        { header: 'Medicamentos', key: 'meds', width: 13, fmt: FMT.int },
      ],
      datos.protocolosCompletos.map((p) => ({
        prot: p.protocolo,
        gasto: round2(p.totalGasto),
        prep: p.totalPreparaciones,
        cxp: round2(p.costePorPreparacion),
        cajas: p.totalViales,
        meds: p.medicamentosDistintos,
      })),
    );
  }

  addTabla(
    wb,
    'Compras vs consumo',
    'Compras recibidas frente a consumo por medicamento',
    subtitulo,
    [
      { header: 'CN', key: 'cn', width: 10 },
      { header: 'Principio activo', key: 'pa', width: 34 },
      { header: 'Ámbito', key: 'via', width: 9 },
      { header: 'Consumo (cajas)', key: 'consCajas', width: 14, fmt: FMT.dec },
      { header: 'Compras (cajas)', key: 'compCajas', width: 14, fmt: FMT.dec },
      { header: 'Compras − consumo (cajas)', key: 'difCajas', width: 16, fmt: '+#,##0.0;-#,##0.0;0.0' },
      { header: 'Consumo valorizado', key: 'consGasto', width: 17, fmt: FMT.eur },
      { header: 'Compras valorizadas', key: 'compGasto', width: 17, fmt: FMT.eur },
      { header: 'Compras − consumo (€)', key: 'difGasto', width: 17, fmt: '+#,##0.00 "€";-#,##0.00 "€";0.00 "€"' },
      { header: 'Pedidos recibidos', key: 'pedidos', width: 12, fmt: FMT.int },
    ],
    datos.comprasVsConsumo.map((c) => ({
      cn: c.cn,
      pa: c.principioActivo || c.nombre,
      via: VIA_LABELS[c.via],
      consCajas: c.consumoCajas,
      compCajas: c.comprasCajas,
      difCajas: c.comprasCajas - c.consumoCajas,
      consGasto: round2(c.consumoGasto),
      compGasto: round2(c.comprasGasto),
      difGasto: round2(c.comprasGasto - c.consumoGasto),
      pedidos: c.pedidosRecibidos,
    })),
    {
      destacar: (row) => !!datos.scope.cn && row.cn === datos.scope.cn,
      nota: `Periodo comparado: ${fmtFecha(datos.comprasComparadasDesde)} – ${fmtFecha(hasta)} (compras registradas desde ${
        datos.comprasRegistroDesde ? fmtFecha(datos.comprasRegistroDesde) : '—'
      }). Las compras son del área completa: no se filtran por servicio, tipo tumoral ni ámbito.`,
    },
  );

  addTabla(
    wb,
    'Datos',
    'Datos detallados para tablas dinámicas',
    subtitulo,
    [
      { header: 'Año', key: 'anio', width: 7 },
      { header: 'Mes', key: 'mes', width: 6 },
      { header: 'Servicio', key: 'servicio', width: 28 },
      { header: 'Tipo tumoral', key: 'grupo', width: 20 },
      { header: 'Ámbito', key: 'via', width: 9 },
      { header: 'Diagnóstico', key: 'dx', width: 32 },
      { header: 'Indicación', key: 'ind', width: 28 },
      { header: 'Protocolo', key: 'prot', width: 28 },
      { header: 'CN', key: 'cn', width: 10 },
      { header: 'Principio activo', key: 'pa', width: 30 },
      { header: 'Cajas eq.', key: 'cajas', width: 11, fmt: FMT.dec },
      { header: 'Unidades', key: 'uds', width: 10, fmt: FMT.int },
      { header: 'Prep. / disp.', key: 'prep', width: 11, fmt: FMT.int },
      { header: 'Gasto', key: 'gasto', width: 14, fmt: FMT.eur },
    ],
    datos.filas.map((f) => ({
      anio: f.anio,
      mes: f.mes,
      servicio: f.servicio,
      grupo: f.grupo,
      via: VIA_LABELS[f.via],
      dx: f.diagnostico,
      ind: f.indicacion,
      prot: f.protocolo,
      cn: f.cn,
      pa: f.principioActivo || f.nombre,
      cajas: Math.round(f.cajas * 1000) / 1000,
      uds: f.unidades,
      prep: f.preparaciones,
      gasto: round2(f.gasto),
    })),
  );

  const buffer = await wb.xlsx.writeBuffer();
  const slug = [
    'oncologia',
    servicio ? slugify(servicio) : null,
    grupo ? slugify(GRUPO_LABELS[grupo]) : null,
    via ? slugify(VIA_LABELS[via]) : null,
    cn ? `cn-${slugify(cn)}` : null,
  ].filter(Boolean).join('_');
  const filename = `analisis_${slug}_${desde}_${hasta}.xlsx`;

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
