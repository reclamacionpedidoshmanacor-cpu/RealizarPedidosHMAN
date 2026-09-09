import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { isAlmacenArea } from '@/lib/almacen';
import {
  normalizeStockUnidades,
  stockCajasDesdeUnidades,
} from '@/lib/cantidades';
import {
  eliminarRecuentoPendiente,
  finalizarRecuentoDesdeStock,
  guardarLineasRecuentoManual,
  getLineasRecuento,
  getMedicamentoByCnArea,
  getMedicamentosParaRecuento,
  getPendienteRecuento,
  getRecuentoById,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

type BulkLineaInput = { cn: string; stockUnidades: number };

function parseBulkLineas(body: unknown): BulkLineaInput[] | null {
  if (!body || typeof body !== 'object') return null;
  const maybeLineas = (body as { lineas?: unknown }).lineas;
  if (!Array.isArray(maybeLineas)) return null;

  const dedup = new Map<string, number>();
  for (const raw of maybeLineas) {
    if (!raw || typeof raw !== 'object') return null;
    const cn = String((raw as { cn?: unknown }).cn ?? '').trim();
    const stockUnidades = Number((raw as { stockUnidades?: unknown }).stockUnidades);
    if (!cn) return null;
    if (!Number.isSafeInteger(stockUnidades) || stockUnidades < 0) return null;
    dedup.set(cn, normalizeStockUnidades(stockUnidades));
  }

  return [...dedup.entries()].map(([cn, stockUnidades]) => ({ cn, stockUnidades }));
}

export async function GET(
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

    const lineas = await getLineasRecuento(recuentoId);
    return NextResponse.json({ recuento, lineas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
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
      return NextResponse.json({ error: 'Solo se puede editar un recuento pendiente.' }, { status: 409 });
    }

    const body = await req.json();
    const bulkLineas = parseBulkLineas(body);
    const finalizar = (body as { finalizar?: unknown }).finalizar === true;

    if (bulkLineas) {
      if (bulkLineas.length === 0 && !finalizar) {
        return NextResponse.json({ error: 'No hay lineas para guardar.' }, { status: 400 });
      }

      let noEncontrados: string[] = [];
      let lineasValidas = bulkLineas;
      if (bulkLineas.length > 0) {
        const meds = await getMedicamentosParaRecuento(
          session.area,
          bulkLineas.map((linea) => linea.cn)
        );
        const medsMap = new Map(meds.map((med) => [med.cn, med]));

        noEncontrados = bulkLineas
          .map((linea) => linea.cn)
          .filter((cn) => !medsMap.has(cn));
        lineasValidas = bulkLineas.filter((linea) => medsMap.has(linea.cn));
        if (lineasValidas.length === 0) {
          return NextResponse.json(
            {
              error: 'No hay líneas válidas para guardar en el área activa.',
              cns: noEncontrados,
            },
            { status: 404 }
          );
        }
        const [lineasActuales, pendiente] = await Promise.all([
          getLineasRecuento(recuentoId),
          getPendienteRecuento(session.area),
        ]);
        if (!pendiente || pendiente.id !== recuentoId) {
          return NextResponse.json(
            { error: 'El recuento ya no está disponible para editar.' },
            { status: 409 },
          );
        }
        const actualesByCn = new Map(
          lineasActuales.map((linea) => [linea.cn, linea.stockUnidades]),
        );
        const noPresentes = lineasValidas
          .map((linea) => linea.cn)
          .filter((cn) => !actualesByCn.has(cn));
        if (noPresentes.length > 0) {
          return NextResponse.json(
            { error: 'Hay líneas que ya no existen en el recuento.', cns: noPresentes },
            { status: 409 },
          );
        }
        try {
          await guardarLineasRecuentoManual({
            importacionId: recuentoId,
            area: session.area,
            ubicacion: '',
            sessionId: 'administracion-stock',
            revisionEsperada: pendiente.revision ?? 0,
            origen: 'administracion',
            lineas: lineasValidas.map((linea) => {
              const med = medsMap.get(linea.cn)!;
              return {
                cn: linea.cn,
                stockUnidades: linea.stockUnidades,
                stockCajas: stockCajasDesdeUnidades(
                  linea.stockUnidades,
                  med.unidadesPorCaja,
                ),
                stockAnteriorEsperado: actualesByCn.get(linea.cn) ?? null,
              };
            }),
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.startsWith('CONFLICTO_')
          ) {
            return NextResponse.json(
              { error: 'El recuento cambió durante la edición. Recarga los datos.' },
              { status: 409 },
            );
          }
          throw error;
        }
      }

      if (finalizar) {
        const cierre = await finalizarRecuentoDesdeStock(recuentoId, session.area);
        if (!cierre.ok) {
          if (cierre.reason === 'manual_not_completed') {
            return NextResponse.json(
              {
                error: 'El recuento todavía no se ha completado desde la app manual.',
              },
              { status: 409 },
            );
          }
          if (cierre.reason === 'linked_draft_proposals') {
            return NextResponse.json(
              {
                error: 'Hay propuestas en borrador vinculadas a este recuento. Tramítalas o elimínalas antes de cerrarlo desde Stock.',
              },
              { status: 409 }
            );
          }
          if (cierre.reason === 'no_proposals_generated') {
            return NextResponse.json(
              {
                error:
                  'No se ha podido generar ninguna propuesta desde el recuento. Comprueba las ubicaciones y el catálogo.',
              },
              { status: 409 }
            );
          }
          return NextResponse.json(
            { error: 'No se pudo marcar el recuento como generado.' },
            { status: 409 }
          );
        }

        return NextResponse.json({
          ok: true,
          updated: lineasValidas.length,
          omitidosCatalogo: noEncontrados,
          recuentoEstado: isAlmacenArea(session.area) ? 'validado' : 'generado',
          propuestaId: cierre.propuestaId,
        });
      }

      return NextResponse.json({
        ok: true,
        updated: lineasValidas.length,
        omitidosCatalogo: noEncontrados,
        recuentoEstado: 'pendiente',
      });
    }

    const cn = String((body as { cn?: unknown }).cn ?? '').trim();
    const stockUnidadesRaw = Number((body as { stockUnidades?: unknown }).stockUnidades);

    if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
    if (!Number.isSafeInteger(stockUnidadesRaw) || stockUnidadesRaw < 0) {
      return NextResponse.json({ error: 'Las unidades totales deben ser un entero no negativo.' }, { status: 400 });
    }
    const stockUnidades = normalizeStockUnidades(stockUnidadesRaw);

    const med = await getMedicamentoByCnArea(cn, session.area);
    if (!med) {
      return NextResponse.json({ error: 'Medicamento no encontrado en area activa.' }, { status: 404 });
    }

    const [lineasActuales, pendiente] = await Promise.all([
      getLineasRecuento(recuentoId),
      getPendienteRecuento(session.area),
    ]);
    const actual = lineasActuales.find((linea) => linea.cn === cn);
    if (!actual) {
      return NextResponse.json({ error: 'Linea de recuento no encontrada.' }, { status: 404 });
    }
    if (!pendiente || pendiente.id !== recuentoId) {
      return NextResponse.json({ error: 'El recuento ya no está disponible.' }, { status: 409 });
    }
    try {
      await guardarLineasRecuentoManual({
        importacionId: recuentoId,
        area: session.area,
        ubicacion: '',
        sessionId: 'administracion-stock',
        revisionEsperada: pendiente.revision ?? 0,
        origen: 'administracion',
        lineas: [{
          cn,
          stockUnidades,
          stockCajas: stockCajasDesdeUnidades(stockUnidades, med.unidadesPorCaja),
          stockAnteriorEsperado: actual.stockUnidades,
        }],
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('CONFLICTO_')) {
        return NextResponse.json(
          { error: 'El recuento cambió durante la edición. Recarga los datos.' },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      stockUnidades,
      stockCajas: stockCajasDesdeUnidades(stockUnidades, med.unidadesPorCaja),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
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
      return NextResponse.json(
        { error: 'Solo se puede eliminar un recuento en estado pendiente.' },
        { status: 409 }
      );
    }

    const result = await eliminarRecuentoPendiente(recuentoId, session.area);
    if (!result.ok) {
      if (result.reason === 'linked_non_draft_proposal') {
        return NextResponse.json(
          {
            error: `No se puede eliminar el recuento porque tiene propuestas vinculadas en estado ${result.propuestaEstado ?? 'desconocido'}.`,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: 'No se pudo eliminar el recuento pendiente.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      ok: true,
      recuentoId,
      lineasEliminadas: result.lineasEliminadas,
      propuestasEliminadas: result.propuestasEliminadas,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
