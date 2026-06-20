import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  actualizarLineaRecuento,
  eliminarRecuentoPendiente,
  getLineasRecuento,
  getMedicamentoByCnArea,
  getMedicamentosParaRecuento,
  getRecuentoById,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

type BulkLineaInput = { cn: string; stockCajas: number };

function parseBulkLineas(body: unknown): BulkLineaInput[] | null {
  if (!body || typeof body !== 'object') return null;
  const maybeLineas = (body as { lineas?: unknown }).lineas;
  if (!Array.isArray(maybeLineas)) return null;

  const dedup = new Map<string, number>();
  for (const raw of maybeLineas) {
    if (!raw || typeof raw !== 'object') return null;
    const cn = String((raw as { cn?: unknown }).cn ?? '').trim();
    const stockCajas = Number((raw as { stockCajas?: unknown }).stockCajas);
    if (!cn) return null;
    if (!Number.isFinite(stockCajas) || stockCajas < 0) return null;
    dedup.set(cn, roundOneDecimal(stockCajas));
  }

  return [...dedup.entries()].map(([cn, stockCajas]) => ({ cn, stockCajas }));
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

    if (bulkLineas) {
      if (bulkLineas.length === 0) {
        return NextResponse.json({ error: 'No hay lineas para guardar.' }, { status: 400 });
      }

      const meds = await getMedicamentosParaRecuento(
        session.area,
        bulkLineas.map((linea) => linea.cn)
      );
      const medsMap = new Map(meds.map((med) => [med.cn, med]));

      const noEncontrados = bulkLineas
        .map((linea) => linea.cn)
        .filter((cn) => !medsMap.has(cn));
      const lineasValidas = bulkLineas.filter((linea) => medsMap.has(linea.cn));
      if (lineasValidas.length === 0) {
        return NextResponse.json(
          {
            error: 'No hay líneas válidas para guardar en el área activa.',
            cns: noEncontrados,
          },
          { status: 404 }
        );
      }

      const erroresActualizacion: string[] = [];
      for (const linea of lineasValidas) {
        const med = medsMap.get(linea.cn);
        if (!med) continue;
        const actualizado = await actualizarLineaRecuento(
          recuentoId,
          linea.cn,
          linea.stockCajas,
          linea.stockCajas * med.unidadesPorCaja
        );
        if (!actualizado) erroresActualizacion.push(linea.cn);
      }

      if (erroresActualizacion.length > 0) {
        return NextResponse.json(
          {
            error: 'No se pudieron actualizar algunas lineas del recuento.',
            cns: erroresActualizacion,
          },
          { status: 404 }
        );
      }

      return NextResponse.json({
        ok: true,
        updated: lineasValidas.length,
        omitidosCatalogo: noEncontrados,
      });
    }

    const cn = String((body as { cn?: unknown }).cn ?? '').trim();
    const stockCajasRaw = Number((body as { stockCajas?: unknown }).stockCajas);
    const stockCajas = roundOneDecimal(stockCajasRaw);

    if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
    if (!Number.isFinite(stockCajasRaw) || stockCajasRaw < 0) {
      return NextResponse.json({ error: 'Stock en cajas no valido.' }, { status: 400 });
    }

    const med = await getMedicamentoByCnArea(cn, session.area);
    if (!med) {
      return NextResponse.json({ error: 'Medicamento no encontrado en area activa.' }, { status: 404 });
    }

    const actualizado = await actualizarLineaRecuento(
      recuentoId, cn, stockCajas, stockCajas * med.unidadesPorCaja
    );

    if (!actualizado) {
      return NextResponse.json({ error: 'Linea de recuento no encontrada.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, stockCajas });
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
