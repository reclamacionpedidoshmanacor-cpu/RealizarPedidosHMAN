import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '@/db';
import { propuestas, propuestasLineas } from '@/db/schema';
import { requireApiSession } from '@/lib/api-auth';
import { toSapCode } from '@/lib/propuesta';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { id } = await params;
  const propuestaId = Number(id);
  if (!Number.isFinite(propuestaId)) {
    return NextResponse.json({ error: 'ID de propuesta no valido.' }, { status: 400 });
  }

  const propuesta = await db
    .select({
      id: propuestas.id,
      area: propuestas.area,
      estado: propuestas.estado,
      fechaGeneracion: propuestas.fechaGeneracion,
    })
    .from(propuestas)
    .where(eq(propuestas.id, propuestaId))
    .get();

  if (!propuesta) return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
  if (propuesta.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  if (propuesta.estado !== 'tramitada') {
    return NextResponse.json({ error: 'Solo se puede exportar una propuesta tramitada.' }, { status: 409 });
  }

  const lineas = await db
    .select({
      cn: propuestasLineas.cn,
      nombreMedicamento: propuestasLineas.nombreMedicamento,
      cajasPropuestas: propuestasLineas.cajasPropuestas,
      cajasValidadas: propuestasLineas.cajasValidadas,
      unidadesPorCaja: propuestasLineas.unidadesPorCaja,
    })
    .from(propuestasLineas)
    .where(eq(propuestasLineas.propuestaId, propuestaId));

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
  const fecha = (propuesta.fechaGeneracion ?? new Date().toISOString()).slice(0, 10);
  const filename = `propuesta-${session.area}-${fecha}.xlsx`;

  await db
    .update(propuestas)
    .set({ excelGeneradoEn: new Date().toISOString() })
    .where(and(eq(propuestas.id, propuestaId), eq(propuestas.area, session.area)));

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
