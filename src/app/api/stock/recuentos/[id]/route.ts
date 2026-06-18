import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  actualizarLineaRecuento,
  getMedicamentoByCnArea,
  getRecuentoById,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function PATCH(
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

    const body = await req.json();
    const cn = String(body.cn ?? '').trim();
    const stockCajas = Number(body.stockCajas);

    if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
    if (!Number.isFinite(stockCajas) || stockCajas < 0) {
      return NextResponse.json({ error: 'Stock en cajas no valido.' }, { status: 400 });
    }

    const recuento = await getRecuentoById(recuentoId);
    if (!recuento) return NextResponse.json({ error: 'Recuento no encontrado.' }, { status: 404 });
    if (recuento.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    if (recuento.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Solo se puede editar un recuento pendiente.' }, { status: 409 });
    }

    const med = await getMedicamentoByCnArea(cn, session.area);
    if (!med) {
      return NextResponse.json({ error: 'Medicamento no encontrado en area activa.' }, { status: 404 });
    }

    const actualizado = await actualizarLineaRecuento(
      recuentoId, cn, stockCajas, stockCajas * med.unidadesPorCaja
    );

    if (!actualizado) {
      return NextResponse.json({ error: 'Linea de recuento no encontrada.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
