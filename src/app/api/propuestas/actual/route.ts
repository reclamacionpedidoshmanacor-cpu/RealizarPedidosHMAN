import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { isAlmacenArea } from '@/lib/almacen';
import {
  actualizarStockTransitoSnapshot,
  actualizarCalculoAutomaticoLineaPropuesta,
  ensureNutricionDecimalSchema,
  buildLineasPropuestaParaUi,
  getBorradorPropuesta,
  crearPropuesta,
  getLineasPropuesta,
  getPedidoAlmacenPendiente,
  getPendienteRecuento,
  getRecuentoConStockParaPropuesta,
  insertarLineasPropuesta,
  reemplazarLineasPropuestaDesdeRecuento,
} from '@/lib/stock-propuesta-neon';
import { loadCantidadTransitoByCn } from '@/lib/pedidos-pendientes';
import { loadAlertasSuministroPorCnsSafe, alertaSuministroParaCn } from '@/lib/alertas-suministro';
import { calcularCajasPropuestas } from '@/lib/propuesta';

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

async function loadStockTransitoCajasSafely(
  rows: Array<{ cn: string; unidadesPorCaja: number }>
): Promise<Record<string, number>> {
  if (rows.length === 0) return {};
  try {
    const transitoUnidadesByCn = await loadCantidadTransitoByCn(rows.map((row) => row.cn));
    return buildStockTransitoCajasByCn(transitoUnidadesByCn, rows);
  } catch {
    return {};
  }
}

async function attachAlertasLineas<T extends { cn: string }>(lineas: T[]) {
  if (lineas.length === 0) return lineas;
  const alertas = await loadAlertasSuministroPorCnsSafe(lineas.map((l) => l.cn));
  return lineas.map((linea) => ({
    ...linea,
    alertaSuministro: alertaSuministroParaCn(alertas, linea.cn),
  }));
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    if (isAlmacenArea(session.area)) {
      const pedido = await getPedidoAlmacenPendiente(session.area);
      if (!pedido) {
        return NextResponse.json(
          { error: 'No hay pedido de almacén en curso. Registra líneas desde Recuento Manual.' },
          { status: 404 }
        );
      }

      let propuesta = await getBorradorPropuesta(session.area, pedido.id);
      if (!propuesta) {
        propuesta = await crearPropuesta(session.area, pedido.id);
      }

      const lineasParaUi = await attachAlertasLineas(
        (
          await buildLineasPropuestaParaUi(
            propuesta.id,
            pedido.id,
            session.area,
            propuesta.estado,
            {}
          )
        ).filter(
          (linea) =>
            linea.activo === false ||
            (linea.cajasValidadas ?? linea.cajasPropuestas) > 0
        )
      );

      return NextResponse.json({
        recuento: {
          id: pedido.id,
          fechaRecuento: pedido.fechaRecuento,
          origen: pedido.origen,
          estado: pedido.estado,
        },
        propuesta,
        lineas: lineasParaUi,
        modo: 'pedido-almacen',
      });
    }

    const recuento = await getPendienteRecuento(session.area);
    if (!recuento) {
      return NextResponse.json(
        { error: 'No hay recuento pendiente para generar propuesta.' },
        { status: 404 }
      );
    }

    await ensureNutricionDecimalSchema(session.area);

    let propuesta = await getBorradorPropuesta(session.area, recuento.id);
    let stockTransitoByCn: Record<string, number> = {};

    if (!propuesta) {
      propuesta = await crearPropuesta(session.area, recuento.id);

      const filas = await getRecuentoConStockParaPropuesta(recuento.id, session.area);
      if (filas.length > 0) {
        stockTransitoByCn = await loadStockTransitoCajasSafely(
          filas.map((r) => ({ cn: r.cn, unidadesPorCaja: Number(r.unidades_por_caja) }))
        );

        await insertarLineasPropuesta(
          propuesta.id,
          session.area,
          filas.map((r) => ({
            cn: r.cn,
            nombre: r.nombre,
            unidadesPorCaja: Number(r.unidades_por_caja),
            stockCajas: Number(r.stock_cajas),
            stockMinimo: Number(r.stock_minimo ?? 0),
            puntoPedido: Number(r.punto_pedido ?? 0),
            stockMaximo: Number(r.stock_maximo ?? r.stock_minimo ?? 0),
            stockTransito: Number(stockTransitoByCn[r.cn] ?? 0),
          }))
        );
      }
    }

    let lineas = await getLineasPropuesta(propuesta.id);

    // Si el borrador quedó vacío (p. ej. se abrió Propuesta antes de completar el recuento manual),
    // regenerar líneas desde el recuento pendiente actual.
    if (lineas.length === 0 && propuesta.estado === 'borrador') {
      const filasRecuento = await getRecuentoConStockParaPropuesta(recuento.id, session.area);
      if (filasRecuento.length > 0) {
        stockTransitoByCn = await loadStockTransitoCajasSafely(
          filasRecuento.map((r) => ({ cn: r.cn, unidadesPorCaja: Number(r.unidades_por_caja) }))
        );
        await reemplazarLineasPropuestaDesdeRecuento(
          propuesta.id,
          recuento.id,
          session.area,
          stockTransitoByCn
        );
        lineas = await getLineasPropuesta(propuesta.id);
      }
    }

    if (lineas.length > 0 && Object.keys(stockTransitoByCn).length === 0) {
      stockTransitoByCn = await loadStockTransitoCajasSafely(
        lineas.map((linea) => ({ cn: linea.cn, unidadesPorCaja: linea.unidadesPorCaja }))
      );
    }

    const recalculos = lineas
      .map((linea) => {
        if (linea.ajustado) return null;
        const stockTransito = Number(stockTransitoByCn[linea.cn] ?? 0);
        const cajasCalculadas = calcularCajasPropuestas(
          linea.stockActual,
          linea.puntoPedidoSnap,
          linea.stockMaximoSnap,
          stockTransito,
          linea.unidadesPorCaja
        );
        const cajasValidadasActual = linea.cajasValidadas ?? linea.cajasPropuestas;
        if (cajasCalculadas === linea.cajasPropuestas && cajasValidadasActual === cajasCalculadas) {
          return null;
        }
        return {
          lineaId: linea.id,
          cajasPropuestas: cajasCalculadas,
          unidadesPorCaja: linea.unidadesPorCaja,
        };
      })
      .filter(
        (
          item
        ): item is { lineaId: number; cajasPropuestas: number; unidadesPorCaja: number } => item !== null
      );

    if (recalculos.length > 0) {
      await Promise.all(
        recalculos.map((item) =>
          actualizarCalculoAutomaticoLineaPropuesta(
            item.lineaId,
            propuesta.id,
            item.cajasPropuestas,
            item.unidadesPorCaja,
            session.area
          )
        )
      );
      lineas = await getLineasPropuesta(propuesta.id);
    }

    // Persistimos snapshot de stock en tránsito para auditoría/historial.
    await actualizarStockTransitoSnapshot(propuesta.id, stockTransitoByCn);

    const lineasParaUi = await attachAlertasLineas(
      await buildLineasPropuestaParaUi(
        propuesta.id,
        recuento.id,
        session.area,
        propuesta.estado,
        stockTransitoByCn
      )
    );

    return NextResponse.json({ recuento, propuesta, lineas: lineasParaUi });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
