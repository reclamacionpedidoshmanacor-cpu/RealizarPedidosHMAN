import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireApiSession } from '@/lib/api-auth';
import { getAnalisisDatos } from '@/lib/analisis-neon';
import { GRUPO_LABELS, type DiagnosticoGrupo } from '@/lib/diagnostico-grupos';

export const runtime = 'nodejs';

function defaultDesde(): string {
  const d = new Date(); d.setFullYear(d.getFullYear() - 2); d.setMonth(0); d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function eur(n: number) { return Math.round(n * 100) / 100; }

function styleHeader(row: ExcelJS.Row, color = '1e3a5f') {
  row.eachCell(cell => {
    cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD0D7DE' } },
      right:  { style: 'thin', color: { argb: 'FFD0D7DE' } },
    };
  });
}

function styleData(row: ExcelJS.Row, even = false) {
  row.eachCell(cell => {
    cell.font = { size: 10 };
    cell.alignment = { vertical: 'middle' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
    if (even) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  });
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json({ error: 'Solo disponible para Oncología.' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') || defaultDesde();
  const hasta  = searchParams.get('hasta')  || new Date().toISOString().slice(0, 10);
  const grupo  = searchParams.get('grupo')  || null;

  const datos = await getAnalisisDatos(session.area, desde, hasta, grupo);
  const titulo = grupo ? (GRUPO_LABELS[grupo as DiagnosticoGrupo] ?? grupo) : 'Global';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Farmacia HMAN';
  wb.created = new Date();

  // ── Hoja 1: Gasto histórico por año ────────────────────────────────────
  const shAnual = wb.addWorksheet('Gasto por año');
  shAnual.columns = [
    { header: 'Año',              key: 'anio',  width: 8  },
    { header: 'Gasto (€)',        key: 'gasto', width: 16 },
    { header: 'Preparaciones',    key: 'prep',  width: 14 },
    { header: '€ / preparación',  key: 'cxp',   width: 16 },
    { header: 'Variación YoY',    key: 'yoy',   width: 14 },
  ];
  styleHeader(shAnual.getRow(1));
  datos.gastoPorAnio.forEach((r, i) => {
    const row = shAnual.addRow({ anio: r.anio, gasto: eur(r.gasto), prep: r.preparaciones, cxp: eur(r.costePorPreparacion), yoy: r.variacionYoy != null ? `${r.variacionYoy > 0 ? '+' : ''}${r.variacionYoy.toFixed(1)}%` : '1er año' });
    styleData(row, i % 2 === 1);
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
    row.getCell('cxp').numFmt  = '#,##0.00 "€"';
  });

  // ── Hoja 2: Resumen por grupo ──────────────────────────────────────────
  const shResumen = wb.addWorksheet('Resumen por grupo');
  shResumen.columns = [
    { header: 'Grupo tumoral',   key: 'label', width: 22 },
    { header: 'Gasto (€)',       key: 'gasto', width: 16 },
    { header: '% del total',     key: 'pct',   width: 12 },
    { header: 'Variación YoY',   key: 'yoy',   width: 14 },
    { header: 'Preparaciones',   key: 'prep',  width: 14 },
    { header: 'Medicamentos',    key: 'meds',  width: 14 },
    { header: 'Protocolos',      key: 'prots', width: 12 },
  ];
  styleHeader(shResumen.getRow(1));
  datos.grupos.forEach((g, i) => {
    const row = shResumen.addRow({ label: g.label, gasto: eur(g.totalGasto), pct: Math.round(g.pctGasto * 10) / 10, yoy: g.variacionYoy != null ? `${g.variacionYoy > 0 ? '+' : ''}${g.variacionYoy.toFixed(1)}%` : '—', prep: g.totalPreparaciones, meds: g.medicamentosDistintos, prots: g.protocolosActivos });
    styleData(row, i % 2 === 1);
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
    row.getCell('pct').numFmt  = '0.0"%"';
  });

  // ── Hoja 3: Top 10 protocolos ──────────────────────────────────────────
  const shProt = wb.addWorksheet('Top 10 protocolos');
  shProt.columns = [
    { header: '#',               key: 'rank',  width: 5  },
    { header: 'Protocolo',       key: 'prot',  width: 32 },
    { header: 'Gasto (€)',       key: 'gasto', width: 16 },
    { header: 'Preparaciones',   key: 'prep',  width: 14 },
    { header: '€ / preparación', key: 'cxp',   width: 16 },
    { header: 'Medicamentos',    key: 'meds',  width: 12 },
  ];
  styleHeader(shProt.getRow(1));
  datos.topProtocolos.forEach((p, i) => {
    const row = shProt.addRow({ rank: i + 1, prot: p.protocolo, gasto: eur(p.totalGasto), prep: p.totalPreparaciones, cxp: eur(p.costePorPreparacion), meds: p.medicamentosDistintos });
    styleData(row, i % 2 === 1);
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
    row.getCell('cxp').numFmt  = '#,##0.00 "€"';
  });

  // ── Hoja 4: Top 10 medicamentos ────────────────────────────────────────
  const shMeds = wb.addWorksheet('Top 10 medicamentos');
  shMeds.columns = [
    { header: '#',               key: 'rank',  width: 5  },
    { header: 'Principio activo',key: 'pa',    width: 28 },
    { header: 'Marca comercial', key: 'nom',   width: 22 },
    { header: 'CN',              key: 'cn',    width: 10 },
    { header: 'Grupo tumoral',   key: 'grupo', width: 20 },
    { header: 'Gasto (€)',       key: 'gasto', width: 16 },
    { header: 'Preparaciones',   key: 'prep',  width: 14 },
    { header: 'Viales',          key: 'viales',width: 10 },
    { header: '€ / preparación', key: 'cxp',   width: 16 },
    { header: 'Variación YoY',   key: 'yoy',   width: 14 },
  ];
  styleHeader(shMeds.getRow(1));
  datos.topMedicamentos.forEach((m, i) => {
    const row = shMeds.addRow({ rank: i + 1, pa: m.principioActivo, nom: m.nombre, cn: m.cn, grupo: GRUPO_LABELS[m.grupo] ?? m.grupo, gasto: eur(m.totalGasto), prep: m.totalPreparaciones, viales: Math.round(m.totalViales * 10) / 10, cxp: eur(m.costePorPreparacion), yoy: m.variacionYoy != null ? `${m.variacionYoy > 0 ? '+' : ''}${m.variacionYoy.toFixed(1)}%` : '—' });
    styleData(row, i % 2 === 1);
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
    row.getCell('cxp').numFmt  = '#,##0.00 "€"';
  });

  // ── Hoja 5: Evolución histórica mensual ───────────────────────────────
  const shHist = wb.addWorksheet('Evolución histórica');
  shHist.columns = [
    { header: 'Período',       key: 'label', width: 12 },
    { header: 'Año',           key: 'anio',  width: 8  },
    { header: 'Mes',           key: 'mes',   width: 6  },
    { header: 'Gasto (€)',     key: 'gasto', width: 16 },
    { header: 'Preparaciones', key: 'prep',  width: 14 },
  ];
  styleHeader(shHist.getRow(1));
  const histData = datos.grupoDetalle?.temporalHistorico ?? datos.temporalHistorico;
  histData.forEach((t, i) => {
    const row = shHist.addRow({ label: t.label, anio: t.anio, mes: t.mes, gasto: eur(t.gasto), prep: t.preparaciones });
    styleData(row, i % 2 === 1);
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
  });

  // ── Hoja 6: Detalle semanal reciente ──────────────────────────────────
  const shSem = wb.addWorksheet('Detalle semanal');
  shSem.columns = [
    { header: 'Semana',        key: 'label', width: 12 },
    { header: 'Año',           key: 'anio',  width: 8  },
    { header: 'Semana ISO',    key: 'sem',   width: 10 },
    { header: 'Gasto (€)',     key: 'gasto', width: 16 },
    { header: 'Preparaciones', key: 'prep',  width: 14 },
  ];
  styleHeader(shSem.getRow(1));
  const semData = datos.grupoDetalle?.temporalReciente ?? datos.temporalReciente;
  semData.forEach((t, i) => {
    const row = shSem.addRow({ label: t.label, anio: t.anio, sem: t.semana ?? '', gasto: eur(t.gasto), prep: t.preparaciones });
    styleData(row, i % 2 === 1);
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
  });

  // ── Hoja 7 (si hay grupo): Detalle diagnóstico → indicación → protocolo → med ──
  if (datos.grupoDetalle) {
    const gd = datos.grupoDetalle;
    const shDet = wb.addWorksheet(`Detalle ${titulo}`.slice(0, 31));
    shDet.columns = [
      { header: 'Diagnóstico',      key: 'dx',    width: 32 },
      { header: 'Indicación',       key: 'ind',   width: 28 },
      { header: 'Protocolo',        key: 'prot',  width: 28 },
      { header: 'Principio activo', key: 'pa',    width: 28 },
      { header: 'Marca comercial',  key: 'nom',   width: 22 },
      { header: 'Preparaciones',    key: 'prep',  width: 14 },
      { header: 'Viales',           key: 'viales',width: 10 },
      { header: 'Gasto (€)',        key: 'gasto', width: 16 },
      { header: '€ / preparación',  key: 'cxp',   width: 16 },
    ];
    styleHeader(shDet.getRow(1));
    let idx = 0;
    for (const dx of gd.diagnosticos) {
      for (const ind of dx.indicaciones) {
        for (const prot of ind.protocolos) {
          for (const med of prot.medicamentos) {
            const row = shDet.addRow({ dx: dx.diagnostico, ind: ind.indicacion, prot: prot.protocolo, pa: med.principioActivo, nom: med.nombre, prep: med.totalPreparaciones, viales: Math.round(med.totalViales * 10) / 10, gasto: eur(med.totalGasto), cxp: eur(prot.costePorPreparacion) });
            styleData(row, idx % 2 === 1);
            row.getCell('gasto').numFmt = '#,##0.00 "€"';
            row.getCell('cxp').numFmt  = '#,##0.00 "€"';
            idx++;
          }
        }
      }
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `analisis_${titulo.replace(/\s+/g, '_')}_${desde}_${hasta}.xlsx`;

  return new NextResponse(Buffer.from(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
