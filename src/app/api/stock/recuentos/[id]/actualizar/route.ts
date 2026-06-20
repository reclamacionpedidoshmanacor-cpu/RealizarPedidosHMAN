import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  getBorradorPropuesta,
  getLineasPropuesta,
  getRecuentoById,
  reemplazarLineasPropuestaDesdeRecuento,
  sincronizarRecuentoPendienteConCatalogo,
} from '@/lib/stock-propuesta-neon';
import { loadCantidadTransitoByCn } from '@/lib/pedidos-pendientes';

export const runtime = 'nodejs';

function roundThreeDecimals(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildStockTransitoCajasByCn(
  transitoUnidadesByCn: Record<string, number>,
  rows: Array<{ cn: string; unidadesPorCaja: number }>
): Record<string, number> {
  const byCn: Record<string, number> = {};
  for (const row of rows) {
    const unidadesTransito = Number(transitoUnidadesByCn[row.cn] ?? 0);
    if (!Number.isFinite(unidadesTransito) || unidadesTransito <= 0) {
      byCn[row.cn] = 0;
      continue;
    }
    const cajasTransito =
      row.unidadesPorCaja > 0 ? unidadesTransito / row.unidadesPorCaja : unidadesTransito;
    byCn[row.cn] = cajasTransito > 0 ? roundThreeDecimals(cajasTransito) : 0;
  }
  return byCn;
}

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
    if (recuento.estado !== 'pendiente') {
      return NextResponse.json({ error: 'Solo se puede actualizar un recuento pendiente.' }, { status: 409 });
    }

    const syncResult = await sincronizarRecuentoPendienteConCatalogo(recuentoId, session.area);
    const borrador = await getBorradorPropuesta(session.area, recuentoId);

    let propuestaActualizada = false;
    let lineasPropuesta = 0;
    if (borrador) {
      const lineas = await getLineasPropuesta(borrador.id);
      const transitoUnidadesByCn = await loadCantidadTransitoByCn(lineas.map((l) => l.cn));
      const stockTransitoByCn = buildStockTransitoCajasByCn(
        transitoUnidadesByCn,
        lineas.map((l) => ({ cn: l.cn, unidadesPorCaja: l.unidadesPorCaja }))
      );
      lineasPropuesta = await reemplazarLineasPropuestaDesdeRecuento(
        borrador.id,
        recuentoId,
        session.area,
        stockTransitoByCn
      );
      propuestaActualizada = true;
    }

    return NextResponse.json({
      ok: true,
      recuentoId,
      lineasRecuentoActualizadas: syncResult.updated,
      cnsSinCatalogo: syncResult.cnsSinCatalogo,
      propuestaActualizada,
      lineasPropuesta,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
