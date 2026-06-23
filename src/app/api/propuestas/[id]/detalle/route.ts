import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { buildLineasPropuestaParaUi, getLineasPropuesta, getPropuestaById } from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { id } = await ctx.params;
  const propuestaId = Number(id);
  if (!Number.isFinite(propuestaId) || propuestaId <= 0) {
    return NextResponse.json({ error: 'ID de propuesta inválido.' }, { status: 400 });
  }

  try {
    const propuesta = await getPropuestaById(propuestaId);
    if (!propuesta || propuesta.area !== session.area) {
      return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
    }

    const lineas = propuesta.importacionStockId
      ? await buildLineasPropuestaParaUi(
          propuestaId,
          propuesta.importacionStockId,
          propuesta.area,
          propuesta.estado,
          {}
        )
      : (await getLineasPropuesta(propuestaId)).map((linea) => ({
          ...linea,
          activo: true,
          editable: false,
        }));

    return NextResponse.json({ propuesta, lineas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
