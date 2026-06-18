import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  getBorradorPropuesta,
  crearPropuesta,
  getLineasPropuesta,
  getPendienteRecuento,
  getRecuentoConStockParaPropuesta,
  insertarLineasPropuesta,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const recuento = await getPendienteRecuento(session.area);
    if (!recuento) {
      return NextResponse.json(
        { error: 'No hay recuento pendiente para generar propuesta.' },
        { status: 404 }
      );
    }

    let propuesta = await getBorradorPropuesta(session.area, recuento.id);

    if (!propuesta) {
      propuesta = await crearPropuesta(session.area, recuento.id);

      const filas = await getRecuentoConStockParaPropuesta(recuento.id, session.area);
      if (filas.length > 0) {
        await insertarLineasPropuesta(
          propuesta.id,
          filas.map((r) => ({
            cn: r.cn,
            nombre: r.nombre,
            unidadesPorCaja: Number(r.unidades_por_caja),
            stockCajas: Number(r.stock_cajas),
            stockMinimo: Number(r.stock_minimo ?? 0),
            puntoPedido: Number(r.punto_pedido ?? 0),
            stockMaximo: Number(r.stock_maximo ?? r.stock_minimo ?? 0),
          }))
        );
      }
    }

    const lineas = await getLineasPropuesta(propuesta.id);
    return NextResponse.json({ recuento, propuesta, lineas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
