import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

type ExportRow = {
  cn: string;
  principioActivo: string | null;
  medicamento: string;
  unidadesPorCaja: number;
  manualUnidades: number;
  manualCajas: number;
  sapUnidades: number;
  sapCajas: number;
  ajusteUnidades: number;
  ajusteCajas: number;
};

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const body = (await req.json()) as {
      manualRecuentoId?: number;
      sapFileName?: string;
      rows?: ExportRow[];
    };

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: 'No hay filas para exportar.' }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ajustes Inventario');

    sheet.columns = [
      { header: 'CN', key: 'cn', width: 14 },
      { header: 'Principio Activo', key: 'principioActivo', width: 32 },
      { header: 'Medicamento', key: 'medicamento', width: 40 },
      { header: 'Unidades/Caja', key: 'unidadesPorCaja', width: 16 },
      { header: 'Manual (Cajas)', key: 'manualCajas', width: 16 },
      { header: 'SAP (Cajas)', key: 'sapCajas', width: 16 },
      { header: 'Ajuste (Cajas)', key: 'ajusteCajas', width: 16 },
      { header: 'Manual (Unidades)', key: 'manualUnidades', width: 18 },
      { header: 'SAP (Unidades)', key: 'sapUnidades', width: 18 },
      { header: 'Ajuste (Unidades)', key: 'ajusteUnidades', width: 18 },
    ];

    for (const r of rows) {
      sheet.addRow({
        cn: r.cn,
        principioActivo: r.principioActivo ?? '',
        medicamento: r.medicamento ?? '',
        unidadesPorCaja: toNum(r.unidadesPorCaja),
        manualCajas: toNum(r.manualCajas),
        sapCajas: toNum(r.sapCajas),
        ajusteCajas: toNum(r.ajusteCajas),
        manualUnidades: toNum(r.manualUnidades),
        sapUnidades: toNum(r.sapUnidades),
        ajusteUnidades: toNum(r.ajusteUnidades),
      });
    }

    sheet.addRow({});
    sheet.addRow({
      cn: 'TOTAL',
      manualCajas: rows.reduce((acc, r) => acc + toNum(r.manualCajas), 0),
      sapCajas: rows.reduce((acc, r) => acc + toNum(r.sapCajas), 0),
      ajusteCajas: rows.reduce((acc, r) => acc + toNum(r.ajusteCajas), 0),
      manualUnidades: rows.reduce((acc, r) => acc + toNum(r.manualUnidades), 0),
      sapUnidades: rows.reduce((acc, r) => acc + toNum(r.sapUnidades), 0),
      ajusteUnidades: rows.reduce((acc, r) => acc + toNum(r.ajusteUnidades), 0),
    });

    const fecha = new Date().toISOString().slice(0, 10);
    const suffix = body.manualRecuentoId ? `-manual-${body.manualRecuentoId}` : '';
    const filename = `inventario-ajustes-${session.area}${suffix}-${fecha}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
