import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { eliminarPropuestaById, getPropuestaById } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const propuestaId = Number(id);
    if (!Number.isFinite(propuestaId)) {
      return NextResponse.json({ error: 'ID de propuesta no valido.' }, { status: 400 });
    }

    const propuesta = await getPropuestaById(propuestaId);
    if (!propuesta) return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
    if (propuesta.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });

    const result = await eliminarPropuestaById(propuestaId, session.area);
    if (!result.ok) {
      return NextResponse.json({ error: 'No se pudo eliminar la propuesta.' }, { status: 409 });
    }

    return NextResponse.json({ ok: true, propuestaId, lineasEliminadas: result.lineasEliminadas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
