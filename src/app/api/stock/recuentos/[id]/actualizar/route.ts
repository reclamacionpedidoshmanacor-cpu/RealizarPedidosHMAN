import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  getRecuentoById,
  listBorradoresPropuestaAlmacen,
  sincronizarRecuentoPendienteConCatalogo,
  syncTodasPropuestasUbicacionDesdeRecuento,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const recuentoId = Number(id);
    if (!Number.isFinite(recuentoId)) {
      return NextResponse.json({ error: 'ID de recuento no valido.' }, { status: 400 });
    }

    const recuento = await getRecuentoById(recuentoId);
    if (!recuento) return NextResponse.json({ error: 'Recuento no encontrado.' }, { status: 404 });
    if (recuento.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    if (recuento.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Solo se puede actualizar un recuento pendiente.' }, { status: 409 });
    }

    const syncResult = await sincronizarRecuentoPendienteConCatalogo(recuentoId, session.area);
    await syncTodasPropuestasUbicacionDesdeRecuento(session.area, recuentoId);
    const borradores = await listBorradoresPropuestaAlmacen(session.area, recuentoId);
    const lineasPropuesta = borradores.reduce((sum, b) => sum + b.totalLineas, 0);

    return NextResponse.json({
      ok: true,
      recuentoId,
      lineasRecuentoActualizadas: syncResult.updated,
      cnsSinCatalogo: syncResult.cnsSinCatalogo,
      propuestaActualizada: borradores.length > 0,
      borradores: borradores.length,
      lineasPropuesta,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
