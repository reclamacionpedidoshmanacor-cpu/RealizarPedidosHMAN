import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getResumenConsumoArea, getTemporalGlobalArea, listImportacionesConsumo } from '@/lib/consumo-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (session.area !== 'oncologia') {
    return NextResponse.json(
      { error: 'La pestaña de Consumo (medicamentos preparados en farmacia y administrados) está disponible solo para Oncología por el momento.' },
      { status: 409 }
    );
  }

  const { searchParams } = new URL(req.url);
  const fechaDesde = searchParams.get('fechaDesde');
  const fechaHasta = searchParams.get('fechaHasta');

  try {
    const [medicamentos, temporal, importaciones] = await Promise.all([
      getResumenConsumoArea(session.area, fechaDesde, fechaHasta),
      getTemporalGlobalArea(session.area, fechaDesde, fechaHasta),
      listImportacionesConsumo(session.area),
    ]);
    const periodoInicio = importaciones.length > 0 ? importaciones[importaciones.length - 1]!.periodoInicio : null;
    const periodoFin = importaciones.length > 0 ? importaciones[0]!.periodoFin : null;
    return NextResponse.json({ medicamentos, temporal, periodoInicio, periodoFin });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
