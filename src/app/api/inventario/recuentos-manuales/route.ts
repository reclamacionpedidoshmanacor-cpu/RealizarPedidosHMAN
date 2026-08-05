import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getUbicacionesPorRecuentos } from '@/lib/inventario-neon';
import { listRecuentosManualesByArea } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const recuentos = await listRecuentosManualesByArea(session.area);
    const ubicaciones = await getUbicacionesPorRecuentos(
      recuentos.map((recuento) => recuento.id),
      session.area,
    );
    return NextResponse.json({
      recuentos: recuentos.map((recuento) => ({
        ...recuento,
        ubicaciones: ubicaciones[recuento.id] ?? [],
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
