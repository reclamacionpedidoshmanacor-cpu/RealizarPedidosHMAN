import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { importacionesStock, propuestas, propuestasLineas } from '@/db/schema';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const body = await req.json();
  const propuestaId = Number(body.propuestaId);
  if (!Number.isFinite(propuestaId)) {
    return NextResponse.json({ error: 'ID de propuesta no valido.' }, { status: 400 });
  }

  const propuesta = await db
    .select({
      id: propuestas.id,
      area: propuestas.area,
      estado: propuestas.estado,
      importacionStockId: propuestas.importacionStockId,
    })
    .from(propuestas)
    .where(eq(propuestas.id, propuestaId))
    .get();

  if (!propuesta) return NextResponse.json({ error: 'Propuesta no encontrada.' }, { status: 404 });
  if (propuesta.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  if (propuesta.estado !== 'borrador') {
    return NextResponse.json({ error: 'La propuesta ya fue tramitada.' }, { status: 409 });
  }
  if (!propuesta.importacionStockId) {
    return NextResponse.json({ error: 'La propuesta no tiene recuento asociado.' }, { status: 409 });
  }

  const recuento = await db
    .select({ id: importacionesStock.id, estado: importacionesStock.estado })
    .from(importacionesStock)
    .where(eq(importacionesStock.id, propuesta.importacionStockId))
    .get();

  if (!recuento) return NextResponse.json({ error: 'Recuento asociado no encontrado.' }, { status: 404 });
  if (recuento.estado !== 'pendiente') {
    return NextResponse.json({ error: 'El recuento asociado ya no esta pendiente.' }, { status: 409 });
  }

  const lineas = await db
    .select({
      id: propuestasLineas.id,
      cajasPropuestas: propuestasLineas.cajasPropuestas,
      cajasValidadas: propuestasLineas.cajasValidadas,
      unidadesPorCaja: propuestasLineas.unidadesPorCaja,
    })
    .from(propuestasLineas)
    .where(eq(propuestasLineas.propuestaId, propuestaId));

  for (const linea of lineas) {
    const cajasFinales = linea.cajasValidadas ?? linea.cajasPropuestas;
    await db
      .update(propuestasLineas)
      .set({
        cajasValidadas: cajasFinales,
        unidadesFinal: Math.round(cajasFinales * linea.unidadesPorCaja),
      })
      .where(and(eq(propuestasLineas.id, linea.id), eq(propuestasLineas.propuestaId, propuestaId)));
  }

  const now = new Date().toISOString();
  await db
    .update(propuestas)
    .set({
      estado: 'tramitada',
      tramitadaEn: now,
      validadaEn: now,
    })
    .where(eq(propuestas.id, propuestaId));

  await db
    .update(importacionesStock)
    .set({
      estado: 'generado',
      generadoEn: now,
      propuestaId,
    })
    .where(eq(importacionesStock.id, propuesta.importacionStockId));

  return NextResponse.json({ ok: true, propuestaId });
}
