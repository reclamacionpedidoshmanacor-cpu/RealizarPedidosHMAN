import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getMovimientosConsumo } from '@/lib/consumo-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  // Las tendencias y comparativas de consumo solo aplican al área de Oncología.
  // Para el resto de áreas conservamos el mismo contrato JSON sin consultar Neon.
  if (session.area !== 'oncologia') {
    return NextResponse.json({
      suben: [],
      bajan: [],
      resumen: { totalSuben: 0, totalBajan: 0 },
    });
  }

  try {
    const data = await getMovimientosConsumo(session.area);
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
