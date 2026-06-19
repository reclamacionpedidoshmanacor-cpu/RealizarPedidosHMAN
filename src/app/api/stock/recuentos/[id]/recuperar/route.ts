import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  getPendienteRecuento,
  getRecuentoById,
  recuperarRecuentoGenerado,
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
    if (recuento.estado !== 'generado') {
      return NextResponse.json(
        { error: 'Solo se pueden recuperar recuentos en estado generado.' },
        { status: 409 }
      );
    }

    const pendiente = await getPendienteRecuento(session.area);
    if (pendiente && pendiente.id !== recuentoId) {
      return NextResponse.json(
        { error: 'Ya existe un recuento pendiente en esta area. No se puede recuperar otro.' },
        { status: 409 }
      );
    }

    const ok = await recuperarRecuentoGenerado(recuentoId, session.area);
    if (!ok) {
      return NextResponse.json(
        { error: 'No se pudo recuperar el recuento seleccionado.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, recuentoId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
