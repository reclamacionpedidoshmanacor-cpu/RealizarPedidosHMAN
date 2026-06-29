import { NextRequest, NextResponse } from 'next/server';
import { isAlmacenArea } from '@/lib/almacen';
import { requireApiSessionOrArea } from '@/lib/api-auth';
import { registrarRevisionPendiente } from '@/lib/catalogo-revision-neon';
import { getStockObjetivoByCn } from '@/lib/catalogo-neon';
import { sustituirCnEnCatalogoAlmacen } from '@/lib/sustitucion-cn-almacen';
import {
  ensureSesionPedidoAlmacen,
  eliminarLineaPedidoAlmacenPorCnEnSesion,
  getCantidadesPedidoAlmacen,
  getOrCreatePropuestaAlmacenGrupo,
  recalcularTotalLineasPedidoAlmacen,
  upsertLineasPedidoAlmacen,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

function parseNonNegativeInteger(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) return null;
  return num;
}

export async function POST(req: NextRequest) {
  const session = requireApiSessionOrArea(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ error: 'Sustitución solo disponible en el área Almacén.' }, { status: 403 });
  }

  const body = (await req.json()) as {
    cnViejo?: unknown;
    cnNuevo?: unknown;
    ubicacion?: unknown;
    cajasPedidas?: unknown;
    nombre?: unknown;
    principioActivo?: unknown;
    presentacion?: unknown;
    unidadesPorCaja?: unknown;
  };

  const cnViejo = String(body.cnViejo ?? '').trim();
  const cnNuevoRaw = String(body.cnNuevo ?? '').trim();
  const ubicacion = String(body.ubicacion ?? '').trim();
  const cajasPedidas = parseNonNegativeInteger(body.cajasPedidas) ?? 0;

  if (!cnViejo || !cnNuevoRaw || !ubicacion) {
    return NextResponse.json({ error: 'CN anterior, CN nuevo y ubicación son obligatorios.' }, { status: 400 });
  }

  const tieneDatosEditados =
    body.nombre != null ||
    body.principioActivo != null ||
    body.presentacion != null ||
    body.unidadesPorCaja != null;

  const outcome = await sustituirCnEnCatalogoAlmacen({
    area: session.area,
    cnViejo,
    cnNuevoRaw,
    ubicacion,
    datosNuevo: tieneDatosEditados
      ? {
          nombre: String(body.nombre ?? '').trim(),
          principioActivo: body.principioActivo != null ? String(body.principioActivo) : null,
          presentacion: body.presentacion != null ? String(body.presentacion) : null,
          unidadesPorCaja: body.unidadesPorCaja != null ? Number(body.unidadesPorCaja) : undefined,
        }
      : undefined,
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.err.error }, { status: outcome.err.status });
  }

  const { result } = outcome;

  const { importacionId } = await ensureSesionPedidoAlmacen(session.area);
  await eliminarLineaPedidoAlmacenPorCnEnSesion(importacionId, cnViejo);

  let propuestaId: number | null = null;
  if (cajasPedidas > 0) {
    const stockNuevoFinal = await getStockObjetivoByCn(result.cnNuevo);
    propuestaId = await getOrCreatePropuestaAlmacenGrupo(
      session.area,
      importacionId,
      ubicacion,
      result.principioActivo,
      result.nombre
    );
    await upsertLineasPedidoAlmacen(propuestaId, [{
      cn: result.cnNuevo,
      nombre: result.nombre,
      unidadesPorCaja: result.unidadesPorCaja,
      cajasPedidas,
      stockMinimo: stockNuevoFinal?.stockMinimo ?? null,
      puntoPedido: stockNuevoFinal?.puntoPedido ?? null,
      stockMaximo: stockNuevoFinal?.stockMaximo ?? null,
    }]);
  }

  const totalLineas = await recalcularTotalLineasPedidoAlmacen(importacionId);
  const cantidades = propuestaId != null
    ? await getCantidadesPedidoAlmacen(propuestaId)
    : {};

  await registrarRevisionPendiente({
    area: session.area,
    cn: result.cnNuevo,
    cnAnterior: cnViejo,
    origen: 'sustitucion-pasillo',
    ubicacion,
    nombreCima: result.nombre,
    principioActivoCima: result.principioActivo,
    presentacionCima: result.presentacion,
    unidadesPorCaja: result.unidadesPorCaja,
  });

  return NextResponse.json({
    ok: true,
    cnViejo,
    cnNuevo: result.cnNuevo,
    cajasPedidas,
    totalLineas,
    cantidades,
    medicamento: {
      cn: result.cnNuevo,
      nombre: result.nombre,
      principioActivo: result.principioActivo,
      presentacion: result.presentacion,
      unidadesPorCaja: result.unidadesPorCaja,
      ubicacion,
      activo: true,
      stockMinimo: result.stockMinimo,
      puntoPedido: result.puntoPedido,
      stockMaximo: result.stockMaximo,
      consumoMedio: result.consumoMedio,
      cajasPedidas: cantidades[result.cnNuevo] ?? cajasPedidas,
    },
  });
}
