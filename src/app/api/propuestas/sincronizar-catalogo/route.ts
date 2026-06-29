import { NextRequest, NextResponse } from 'next/server';
import { isAlmacenArea } from '@/lib/almacen';
import { requireApiSession } from '@/lib/api-auth';
import {
  getPropuestaById,
  sincronizarPropuestaDesdeCatalogoAlmacen,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  if (!isAlmacenArea(session.area)) {
    return NextResponse.json(
      { error: 'La actualización desde catálogo solo está disponible en Almacén.' },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();
    const propuestaId = Number(body.propuestaId);
    if (!Number.isFinite(propuestaId) || propuestaId <= 0) {
      return NextResponse.json({ error: 'ID de propuesta no válido.' }, { status: 400 });
    }

    const propuesta = await getPropuestaById(propuestaId);
    if (!propuesta) {
      return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
    }
    if (propuesta.area !== session.area) {
      return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    }

    const result = await sincronizarPropuestaDesdeCatalogoAlmacen(propuestaId, session.area);

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    const status = msg.includes('borrador') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
