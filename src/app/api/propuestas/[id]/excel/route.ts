import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireApiSession } from '@/lib/api-auth';
import { getPropuestaById, getLineasParaExcel, marcarExcelGenerado } from '@/lib/stock-propuesta-neon';
import { toSapCode } from '@/lib/propuesta';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const propuestaId = Number(id);
    if (!Number.isFinite(propuestaId)) {
      return NextResponse.json({ error: 'ID de propuesta no valido.' }, { status: 400 });
    }

    const propuesta = await getPropuestaById(propuestaId);
    if (!propuesta) return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
    if (propuesta.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    if (propuesta.estado !== 'tramitada') {
      return NextResponse.json({ error: 'Solo se puede exportar una propuesta tramitada.' }, { status: 409 });
    }

    const lineas = await getLineasParaExcel(propuestaId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Propuesta');

    sheet.columns = [
      { header: 'Codigo SAP', key: 'sap', width: 18 },
      { header: 'Descripcion', key: 'descripcion', width: 60 },
      { header: 'Cantidad (unidades)', key: 'cantidad', width: 22 },
    ];

    for (const linea of lineas) {
      const cajasFinales = linea.cajasValidadas ?? linea.cajasPropuestas;
      const unidadesFinales = Math.round(cajasFinales * linea.unidadesPorCaja);
      if (unidadesFinales <= 0) continue;
      sheet.addRow({
        sap: toSapCode(linea.cn),
        descripcion: linea.nombreMedicamento ?? linea.cn,
        cantidad: unidadesFinales,
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fecha = propuesta.fechaGeneracion.slice(0, 10);
    const filename = `propuesta-${session.area}-${fecha}.xlsx`;

    await marcarExcelGenerado(propuestaId, session.area);

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
