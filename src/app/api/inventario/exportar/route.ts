import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

type ExportRow = {
  cn: string;
  principioActivo: string | null;
  medicamento: string;
  unidadesPorCaja: number;
  precioCaja: number | null;
  precioUnidad: number;
  manualUnidades: number;
  sapUnidades: number;
  ajusteUnidades: number;
  manualImporte: number;
  sapImporte: number;
  ajusteImporte: number;
};

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toSapCode(cn: string): string {
  return `14${cn}`;
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
      { header: 'Codigo SAP', key: 'sap', width: 18 },
      { header: 'Principio Activo', key: 'principioActivo', width: 32 },
      { header: 'Medicamento', key: 'medicamento', width: 40 },
      { header: 'Unidades/Caja', key: 'unidadesPorCaja', width: 16 },
      { header: 'Coste Caja (€)', key: 'precioCaja', width: 16 },
      { header: 'Coste Unidad (€)', key: 'precioUnidad', width: 18 },
      { header: 'Manual (Unidades)', key: 'manualUnidades', width: 18 },
      { header: 'SAP (Unidades)', key: 'sapUnidades', width: 18 },
      { header: 'Ajuste (Unidades)', key: 'ajusteUnidades', width: 18 },
      { header: 'Manual (€)', key: 'manualImporte', width: 16 },
      { header: 'SAP (€)', key: 'sapImporte', width: 16 },
      { header: 'Ajuste (€)', key: 'ajusteImporte', width: 16 },
    ];

    for (const r of rows) {
      sheet.addRow({
        sap: toSapCode(r.cn),
        principioActivo: r.principioActivo ?? '',
        medicamento: r.medicamento ?? '',
        unidadesPorCaja: toNum(r.unidadesPorCaja),
        precioCaja: toNum(r.precioCaja),
        precioUnidad: toNum(r.precioUnidad),
        manualUnidades: toNum(r.manualUnidades),
        sapUnidades: toNum(r.sapUnidades),
        ajusteUnidades: toNum(r.ajusteUnidades),
        manualImporte: toNum(r.manualImporte),
        sapImporte: toNum(r.sapImporte),
        ajusteImporte: toNum(r.ajusteImporte),
      });
    }

    sheet.addRow({});
    sheet.addRow({
      sap: 'TOTAL',
      manualUnidades: rows.reduce((acc, r) => acc + toNum(r.manualUnidades), 0),
      sapUnidades: rows.reduce((acc, r) => acc + toNum(r.sapUnidades), 0),
      ajusteUnidades: rows.reduce((acc, r) => acc + toNum(r.ajusteUnidades), 0),
      manualImporte: rows.reduce((acc, r) => acc + toNum(r.manualImporte), 0),
      sapImporte: rows.reduce((acc, r) => acc + toNum(r.sapImporte), 0),
      ajusteImporte: rows.reduce((acc, r) => acc + toNum(r.ajusteImporte), 0),
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
