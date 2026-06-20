import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  eliminarRecuentoHistorico,
  getRecuentoById,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function DELETE(
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
    if (recuento.estado === 'pendiente') {
      return NextResponse.json(
        { error: 'Este endpoint solo elimina recuentos del historial (no pendientes).' },
        { status: 409 }
      );
    }

    const result = await eliminarRecuentoHistorico(recuentoId, session.area);
    if (!result.ok) {
      return NextResponse.json({ error: 'No se pudo eliminar el recuento histórico.' }, { status: 409 });
    }

    return NextResponse.json({
      ok: true,
      recuentoId,
      lineasEliminadas: result.lineasEliminadas,
      propuestasEliminadas: result.propuestasEliminadas,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
