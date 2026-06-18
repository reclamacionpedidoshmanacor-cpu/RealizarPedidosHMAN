import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { propuestas, propuestasLineas } from '@/db/schema';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { id } = await params;
  const lineaId = Number(id);
  if (!Number.isFinite(lineaId)) {
    return NextResponse.json({ error: 'ID de linea no valido.' }, { status: 400 });
  }

  const body = await req.json();
  const cajasValidadas = Number(body.cajasValidadas);
  const motivoAjuste = body.motivoAjuste ? String(body.motivoAjuste) : null;
  const motivoAjusteOtro = body.motivoAjusteOtro ? String(body.motivoAjusteOtro).trim() : null;

  if (!Number.isFinite(cajasValidadas) || cajasValidadas < 0) {
    return NextResponse.json({ error: 'Cantidad validada no valida.' }, { status: 400 });
  }

  const linea = await db
    .select({
      id: propuestasLineas.id,
      cajasPropuestas: propuestasLineas.cajasPropuestas,
      propuestaId: propuestasLineas.propuestaId,
      estadoPropuesta: propuestas.estado,
      areaPropuesta: propuestas.area,
      unidadesPorCaja: propuestasLineas.unidadesPorCaja,
    })
    .from(propuestasLineas)
    .innerJoin(propuestas, eq(propuestas.id, propuestasLineas.propuestaId))
    .where(eq(propuestasLineas.id, lineaId))
    .get();

  if (!linea) return NextResponse.json({ error: 'Linea no encontrada.' }, { status: 404 });
  if (linea.areaPropuesta !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  if (linea.estadoPropuesta !== 'borrador') {
    return NextResponse.json({ error: 'La propuesta ya no es editable.' }, { status: 409 });
  }

  const ajustado = cajasValidadas !== linea.cajasPropuestas;
  if (ajustado && !motivoAjuste) {
    return NextResponse.json({ error: 'Debes indicar motivo para un ajuste manual.' }, { status: 400 });
  }
  if (motivoAjuste === 'Otro' && !motivoAjusteOtro) {
    return NextResponse.json({ error: 'Debes escribir el motivo personalizado.' }, { status: 400 });
  }

  await db
    .update(propuestasLineas)
    .set({
      cajasValidadas,
      motivoAjuste: ajustado ? motivoAjuste : null,
      motivoAjusteOtro: ajustado && motivoAjuste === 'Otro' ? motivoAjusteOtro : null,
      ajustado,
      unidadesFinal: Math.round(cajasValidadas * linea.unidadesPorCaja),
    })
    .where(and(eq(propuestasLineas.id, lineaId), eq(propuestasLineas.propuestaId, linea.propuestaId)));

  return NextResponse.json({ ok: true });
}
