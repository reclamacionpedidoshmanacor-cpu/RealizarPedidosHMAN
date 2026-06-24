import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getPropuestaById, deshacerPropuesta } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const body        = await req.json();
    const propuestaId = Number(body.propuestaId);
    if (!Number.isFinite(propuestaId)) {
      return NextResponse.json({ error: 'ID de propuesta no válido.' }, { status: 400 });
    }

    const propuesta = await getPropuestaById(propuestaId);
    if (!propuesta) return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
    if (propuesta.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    if (propuesta.estado !== 'tramitada') {
      return NextResponse.json({ error: 'Solo se puede deshacer una propuesta tramitada.' }, { status: 409 });
    }
    if (!propuesta.importacionStockId) {
      return NextResponse.json({ error: 'La propuesta no tiene recuento asociado.' }, { status: 409 });
    }

    await deshacerPropuesta(propuestaId, propuesta.importacionStockId, propuesta.area);

    return NextResponse.json({ ok: true, propuestaId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
