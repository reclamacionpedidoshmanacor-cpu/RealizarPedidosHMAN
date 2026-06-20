import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireApiSession } from '@/lib/api-auth';
import { getAnalisisDatos } from '@/lib/analisis-neon';
import { GRUPO_LABELS, type DiagnosticoGrupo } from '@/lib/diagnostico-grupos';

export const runtime = 'nodejs';

function defaultDesde(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function eur(n: number) { return Math.round(n * 100) / 100; }
function fmtEur(n: number) { return `${eur(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`; }

function styleHeader(row: ExcelJS.Row, color = '1e3a5f') {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${color}` } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFD0D7DE' } },
      right:  { style: 'thin', color: { argb: 'FFD0D7DE' } },
    };
  });
}

function styleData(row: ExcelJS.Row) {
  row.eachCell(cell => {
    cell.font = { size: 10 };
    cell.alignment = { vertical: 'middle', wrapText: false };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right:  { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };
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
  const titulo = grupo ? GRUPO_LABELS[grupo as DiagnosticoGrupo] ?? grupo : 'Global';

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Farmacia Oncológica HMAN';
  wb.created = new Date();

  // ── Hoja 1: Resumen por grupo ──────────────────────────────────────────
  const shResumen = wb.addWorksheet('Resumen por grupo');
  shResumen.columns = [
    { header: 'Grupo tumoral',     key: 'label',  width: 22 },
    { header: 'Preparaciones',     key: 'prep',   width: 14 },
    { header: 'Viales',            key: 'viales', width: 10 },
    { header: 'Gasto (€)',         key: 'gasto',  width: 14 },
    { header: '% del total',       key: 'pct',    width: 12 },
    { header: 'Medicamentos',      key: 'meds',   width: 14 },
    { header: 'Protocolos',        key: 'prots',  width: 12 },
  ];
  styleHeader(shResumen.getRow(1));
  datos.grupos.forEach((g, i) => {
    const row = shResumen.addRow({
      label:  g.label,
      prep:   g.totalPreparaciones,
      viales: Math.round(g.totalViales * 10) / 10,
      gasto:  eur(g.totalGasto),
      pct:    Math.round(g.pctGasto * 10) / 10,
      meds:   g.medicamentosDistintos,
      prots:  g.protocolosActivos,
    });
    styleData(row);
    if (i % 2 === 1) {
      row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
    }
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
    row.getCell('pct').numFmt = '0.0"%"';
  });

  // Totales
  const totRow = shResumen.addRow({
    label: 'TOTAL', prep: datos.kpis.totalPreparaciones,
    viales: Math.round(datos.kpis.totalViales * 10) / 10,
    gasto: eur(datos.kpis.totalGasto), pct: 100,
    meds: datos.kpis.medicamentosDistintos, prots: datos.kpis.protocolosActivos,
  });
  totRow.font = { bold: true, size: 10 };
  totRow.getCell('gasto').numFmt = '#,##0.00 "€"';

  // ── Hoja 2: Top 10 medicamentos ────────────────────────────────────────
  const shTop = wb.addWorksheet('Top 10 medicamentos');
  shTop.columns = [
    { header: '#',               key: 'rank',  width: 5  },
    { header: 'Principio activo',key: 'pa',    width: 28 },
    { header: 'Marca comercial', key: 'nom',   width: 24 },
    { header: 'CN',              key: 'cn',    width: 10 },
    { header: 'Grupo tumoral',   key: 'grupo', width: 20 },
    { header: 'Preparaciones',   key: 'prep',  width: 14 },
    { header: 'Viales',          key: 'viales',width: 10 },
    { header: 'Gasto (€)',       key: 'gasto', width: 14 },
  ];
  styleHeader(shTop.getRow(1));
  datos.topMedicamentos.forEach((m, i) => {
    const row = shTop.addRow({
      rank: i + 1,
      pa:   m.principioActivo,
      nom:  m.nombre,
      cn:   m.cn,
      grupo: GRUPO_LABELS[m.grupo] ?? m.grupo,
      prep: m.totalPreparaciones,
      viales: Math.round(m.totalViales * 10) / 10,
      gasto: eur(m.totalGasto),
    });
    styleData(row);
    if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
  });

  // ── Hoja 3: Evolución semanal (global o del grupo) ─────────────────────
  const shTemporal = wb.addWorksheet('Evolución semanal');
  shTemporal.columns = [
    { header: 'Año',          key: 'anio',  width: 8  },
    { header: 'Semana',       key: 'sem',   width: 8  },
    { header: 'Mes',          key: 'mes',   width: 6  },
    { header: 'Período',      key: 'label', width: 12 },
    { header: 'Preparaciones',key: 'prep',  width: 14 },
    { header: 'Viales',       key: 'viales',width: 10 },
    { header: 'Gasto (€)',    key: 'gasto', width: 14 },
    { header: 'Pac./semana',  key: 'pac',   width: 12 },
  ];
  styleHeader(shTemporal.getRow(1));
  const temporalData = datos.grupoDetalle?.temporal ?? datos.temporal;
  temporalData.forEach((t, i) => {
    const row = shTemporal.addRow({
      anio: t.anio, sem: t.semana ?? '', mes: t.mes, label: t.label,
      prep: t.preparaciones, viales: Math.round(t.viales * 10) / 10,
      gasto: eur(t.gasto), pac: t.pacientes,
    });
    styleData(row);
    if (i % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
    row.getCell('gasto').numFmt = '#,##0.00 "€"';
  });

  // ── Hoja 4 (opcional): Detalle del grupo ──────────────────────────────
  if (datos.grupoDetalle) {
    const gd = datos.grupoDetalle;
    const shDetalle = wb.addWorksheet(`Detalle ${titulo}`);
    shDetalle.columns = [
      { header: 'Diagnóstico',     key: 'dx',    width: 32 },
      { header: 'Protocolo',       key: 'prot',  width: 30 },
      { header: 'Principio activo',key: 'pa',    width: 28 },
      { header: 'Marca comercial', key: 'nom',   width: 24 },
      { header: 'CN',              key: 'cn',    width: 10 },
      { header: 'Preparaciones',   key: 'prep',  width: 14 },
      { header: 'Viales',          key: 'viales',width: 10 },
      { header: 'Gasto (€)',       key: 'gasto', width: 14 },
      { header: 'Pac./semana',     key: 'pac',   width: 12 },
    ];
    styleHeader(shDetalle.getRow(1));
    let rowIdx = 0;
    for (const dx of gd.diagnosticos) {
      for (const prot of dx.protocolos) {
        for (const med of prot.medicamentos) {
          const row = shDetalle.addRow({
            dx:   dx.diagnostico,
            prot: prot.protocolo,
            pa:   med.principioActivo,
            nom:  med.nombre,
            cn:   med.cn,
            prep: med.totalPreparaciones,
            viales: Math.round(med.totalViales * 10) / 10,
            gasto: eur(med.totalGasto),
            pac: prot.mediaPackientesSemana,
          });
          styleData(row);
          if (rowIdx % 2 === 1) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
          row.getCell('gasto').numFmt = '#,##0.00 "€"';
          rowIdx++;
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
