import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { isAlmacenArea, ubicacionDesdeEtiquetaPropuesta } from '@/lib/almacen';
import {
  actualizarStockTransitoSnapshot,
  actualizarCalculoAutomaticoLineaPropuesta,
  ensureNutricionDecimalSchema,
  buildLineasPropuestaParaUi,
  getPedidoAlmacenPendiente,
  listBorradoresPropuestaAlmacen,
  getPendienteRecuento,
  getLineasPropuesta,
  syncTodasPropuestasUbicacionDesdeRecuento,
} from '@/lib/stock-propuesta-neon';
import { loadCantidadTransitoByCn } from '@/lib/pedidos-pendientes';
import { loadAlertasSuministroPorCnsSafe, alertaSuministroParaCn } from '@/lib/alertas-suministro';
import { buildStockTransitoCajasByCn, calcularCajasPropuestas } from '@/lib/propuesta';

export const runtime = 'nodejs';

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

type BorradorItem = Awaited<ReturnType<typeof listBorradoresPropuestaAlmacen>>[number];

function seleccionarBorrador(
  borradores: BorradorItem[],
  propuestaIdParam: number
): BorradorItem | null {
  if (propuestaIdParam > 0) {
    return borradores.find((b) => b.id === propuestaIdParam) ?? null;
  }
  return borradores.find((b) => b.totalLineas > 0) ?? borradores[0] ?? null;
}

async function recalcularLineasAutomaticas(
  propuestaId: number,
  area: string,
  stockTransitoByCn: Record<string, number>
) {
  let lineas = await getLineasPropuesta(propuestaId);
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
          propuestaId,
          item.cajasPropuestas,
          item.unidadesPorCaja,
          area
        )
      )
    );
    lineas = await getLineasPropuesta(propuestaId);
  }

  return lineas;
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const propuestaIdParam = Number(req.nextUrl.searchParams.get('propuestaId'));

    if (isAlmacenArea(session.area)) {
      const pedido = await getPedidoAlmacenPendiente(session.area);
      if (!pedido) {
        return NextResponse.json(
          { error: 'No hay pedido de almacén en curso. Registra líneas desde Recuento Manual.' },
          { status: 404 }
        );
      }

      const borradores = await listBorradoresPropuestaAlmacen(session.area, pedido.id);
      const propuesta = seleccionarBorrador(borradores, propuestaIdParam);

      if (!propuesta) {
        return NextResponse.json({
          recuento: {
            id: pedido.id,
            fechaRecuento: pedido.fechaRecuento,
            origen: pedido.origen,
            estado: pedido.estado,
          },
          propuesta: null,
          lineas: [],
          borradores,
          modo: 'pedido-almacen',
        });
      }

      const lineasPropuesta = await getLineasPropuesta(propuesta.id);
      const stockTransitoByCn = await loadStockTransitoCajasSafely(
        lineasPropuesta.map((linea) => ({
          cn: linea.cn,
          unidadesPorCaja: linea.unidadesPorCaja,
        }))
      );
      await actualizarStockTransitoSnapshot(propuesta.id, stockTransitoByCn);

      const lineasParaUi = await attachAlertasLineas(
        (
          await buildLineasPropuestaParaUi(
            propuesta.id,
            pedido.id,
            session.area,
            propuesta.estado,
            stockTransitoByCn
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
        propuesta: {
          id: propuesta.id,
          estado: propuesta.estado,
          fechaGeneracion: propuesta.fechaGeneracion,
          tramitadaEn: 'tramitadaEn' in propuesta ? propuesta.tramitadaEn : null,
          importacionStockId: pedido.id,
          observaciones: propuesta.observaciones ?? null,
        },
        borradores,
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
    await syncTodasPropuestasUbicacionDesdeRecuento(session.area, recuento.id);

    const borradores = await listBorradoresPropuestaAlmacen(session.area, recuento.id);
    const propuesta = seleccionarBorrador(borradores, propuestaIdParam);

    if (!propuesta) {
      return NextResponse.json({
        recuento,
        propuesta: null,
        lineas: [],
        borradores,
        modo: 'por-ubicacion',
      });
    }

    let lineas = await getLineasPropuesta(propuesta.id);
    let stockTransitoByCn = await loadStockTransitoCajasSafely(
      lineas.map((linea) => ({ cn: linea.cn, unidadesPorCaja: linea.unidadesPorCaja }))
    );

    lineas = await recalcularLineasAutomaticas(propuesta.id, session.area, stockTransitoByCn);
    if (lineas.length > 0 && Object.keys(stockTransitoByCn).length === 0) {
      stockTransitoByCn = await loadStockTransitoCajasSafely(
        lineas.map((linea) => ({ cn: linea.cn, unidadesPorCaja: linea.unidadesPorCaja }))
      );
    }

    await actualizarStockTransitoSnapshot(propuesta.id, stockTransitoByCn);

    const ubicacionFiltro = ubicacionDesdeEtiquetaPropuesta(propuesta.observaciones);
    const lineasParaUi = await attachAlertasLineas(
      await buildLineasPropuestaParaUi(
        propuesta.id,
        recuento.id,
        session.area,
        propuesta.estado,
        stockTransitoByCn,
        ubicacionFiltro
      )
    );

    return NextResponse.json({
      recuento,
      propuesta: {
        id: propuesta.id,
        estado: propuesta.estado,
        fechaGeneracion: propuesta.fechaGeneracion,
        tramitadaEn: propuesta.tramitadaEn,
        importacionStockId: recuento.id,
        observaciones: propuesta.observaciones ?? null,
      },
      borradores,
      lineas: lineasParaUi,
      modo: 'por-ubicacion',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
