import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getRecuentoById, getPropuestaById, tramitarPropuesta } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const body = await req.json();
    const propuestaId = Number(body.propuestaId);
    if (!Number.isFinite(propuestaId)) {
      return NextResponse.json({ error: 'ID de propuesta no valido.' }, { status: 400 });
    }

    const propuesta = await getPropuestaById(propuestaId);
    if (!propuesta) return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
    if (propuesta.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    if (propuesta.estado !== 'borrador') {
      return NextResponse.json({ error: 'La propuesta ya fue tramitada.' }, { status: 409 });
    }
    if (!propuesta.importacionStockId) {
      return NextResponse.json({ error: 'La propuesta no tiene recuento asociado.' }, { status: 409 });
    }

    const recuento = await getRecuentoById(propuesta.importacionStockId);
    if (!recuento) return NextResponse.json({ error: 'Recuento asociado no encontrado.' }, { status: 404 });
    if (recuento.estado !== 'pendiente') {
      return NextResponse.json({ error: 'El recuento asociado ya no esta pendiente.' }, { status: 409 });
    }

    await tramitarPropuesta(propuestaId, propuesta.importacionStockId, propuesta.area);

    return NextResponse.json({ ok: true, propuestaId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
