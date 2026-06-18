import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  importacionesStock,
  medicamentos,
  propuestas,
  propuestasLineas,
  stockObjetivo,
  stockRegistros,
} from '@/db/schema';
import { requireApiSession } from '@/lib/api-auth';
import { calcularCajasPropuestas } from '@/lib/propuesta';

export const runtime = 'nodejs';

async function getLineas(propuestaId: number) {
  return db
    .select({
      id: propuestasLineas.id,
      cn: propuestasLineas.cn,
      nombreMedicamento: propuestasLineas.nombreMedicamento,
      unidadesPorCaja: propuestasLineas.unidadesPorCaja,
      stockActual: propuestasLineas.stockActual,
      stockMinimoSnap: propuestasLineas.stockMinimoSnap,
      puntoPedidoSnap: propuestasLineas.puntoPedidoSnap,
      stockMaximoSnap: propuestasLineas.stockMaximoSnap,
      cajasPropuestas: propuestasLineas.cajasPropuestas,
      cajasValidadas: propuestasLineas.cajasValidadas,
      motivoAjuste: propuestasLineas.motivoAjuste,
      motivoAjusteOtro: propuestasLineas.motivoAjusteOtro,
      ajustado: propuestasLineas.ajustado,
    })
    .from(propuestasLineas)
    .where(eq(propuestasLineas.propuestaId, propuestaId));
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const recuentoPendiente = await db
    .select({
      id: importacionesStock.id,
      fechaRecuento: importacionesStock.fechaRecuento,
      importadoEn: importacionesStock.importadoEn,
      origen: importacionesStock.origen,
      estado: importacionesStock.estado,
    })
    .from(importacionesStock)
    .where(and(eq(importacionesStock.area, session.area), eq(importacionesStock.estado, 'pendiente')))
    .orderBy(desc(importacionesStock.id))
    .get();

  if (!recuentoPendiente) {
    return NextResponse.json({ error: 'No hay recuento pendiente para generar propuesta.' }, { status: 404 });
  }

  let propuesta = await db
    .select({
      id: propuestas.id,
      estado: propuestas.estado,
      fechaGeneracion: propuestas.fechaGeneracion,
      tramitadaEn: propuestas.tramitadaEn,
    })
    .from(propuestas)
    .where(
      and(
        eq(propuestas.area, session.area),
        eq(propuestas.importacionStockId, recuentoPendiente.id),
        eq(propuestas.estado, 'borrador')
      )
    )
    .orderBy(desc(propuestas.id))
    .get();

  if (!propuesta) {
    const recuentoRows = await db
      .select({
        cn: stockRegistros.cn,
        stockCajas: stockRegistros.stockCajas,
        nombre: medicamentos.nombre,
        unidadesPorCaja: medicamentos.unidadesPorCaja,
        stockMinimo: stockObjetivo.stockMinimo,
        puntoPedido: stockObjetivo.puntoPedido,
        stockMaximo: stockObjetivo.stockMaximo,
      })
      .from(stockRegistros)
      .innerJoin(medicamentos, eq(medicamentos.cn, stockRegistros.cn))
      .leftJoin(stockObjetivo, eq(stockObjetivo.cn, stockRegistros.cn))
      .where(
        and(eq(stockRegistros.importacionId, recuentoPendiente.id), eq(medicamentos.area, session.area))
      );

    const created = await db
      .insert(propuestas)
      .values({
        area: session.area,
        estado: 'borrador',
        importacionStockId: recuentoPendiente.id,
        fechaGeneracion: new Date().toISOString(),
      })
      .returning({
        id: propuestas.id,
        estado: propuestas.estado,
        fechaGeneracion: propuestas.fechaGeneracion,
        tramitadaEn: propuestas.tramitadaEn,
      })
      .get();

    if (recuentoRows.length > 0) {
      await db.insert(propuestasLineas).values(
        recuentoRows.map((row) => {
          const stockMinimo = row.stockMinimo ?? 0;
          const puntoPedido = row.puntoPedido ?? 0;
          const stockMaximo = row.stockMaximo ?? stockMinimo;
          const cajasPropuestas = calcularCajasPropuestas(row.stockCajas, puntoPedido, stockMaximo);
          return {
            propuestaId: created.id,
            cn: row.cn,
            nombreMedicamento: row.nombre,
            unidadesPorCaja: row.unidadesPorCaja,
            stockActual: row.stockCajas,
            stockMinimoSnap: stockMinimo,
            puntoPedidoSnap: puntoPedido,
            stockMaximoSnap: stockMaximo,
            stockObjetivoSnap: stockMaximo,
            cajasPropuestas,
            cajasValidadas: cajasPropuestas,
            ajustado: false,
          };
        })
      );
    }

    propuesta = created;
  }

  const lineas = await getLineas(propuesta.id);
  return NextResponse.json({
    recuento: recuentoPendiente,
    propuesta,
    lineas,
  });
}
