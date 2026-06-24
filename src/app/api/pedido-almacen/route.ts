import { NextRequest, NextResponse } from 'next/server';
import { isValidArea, type AreaId } from '@/lib/areas';
import { isAlmacenArea } from '@/lib/almacen';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';
import { requireApiSessionOrArea } from '@/lib/api-auth';
import {
  ensureSesionPedidoAlmacen,
  getCantidadesPedidoAlmacen,
  getOrCreatePropuestaAlmacenGrupo,
  getPedidoAlmacenPendiente,
  recalcularTotalLineasPedidoAlmacen,
  upsertLineasPedidoAlmacen,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';

function parseNonNegativeInteger(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0 || !Number.isInteger(num)) return null;
  return num;
}

export async function GET(req: NextRequest) {
  const session = requireApiSessionOrArea(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ error: 'Pedido de almacén solo disponible para el área Almacén.' }, { status: 403 });
  }

  const pendiente = await getPedidoAlmacenPendiente(session.area);
  return NextResponse.json({ area: session.area, pendiente });
}

export async function POST(req: NextRequest) {
  const session = requireApiSessionOrArea(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ error: 'Pedido de almacén solo disponible para el área Almacén.' }, { status: 403 });
  }

  const body = (await req.json()) as {
    area?: unknown;
    ubicacion?: unknown;
    lineas?: unknown;
  };

  const areaRaw = String(body.area ?? session.area).trim();
  if (!isValidArea(areaRaw) || areaRaw !== session.area) {
    return NextResponse.json({ error: 'Área no válida.' }, { status: 400 });
  }
  const area = areaRaw as AreaId;

  const ubicacion = String(body.ubicacion ?? '').trim();
  if (!ubicacion) {
    return NextResponse.json({ error: 'Ubicación requerida.' }, { status: 400 });
  }

  const inputLineas = Array.isArray(body.lineas)
    ? (body.lineas as Array<{ cn?: unknown; cajasPedidas?: unknown }>)
    : [];
  if (inputLineas.length === 0) {
    return NextResponse.json({ error: 'No hay líneas para guardar.' }, { status: 400 });
  }

  const catalogo = await listMedicamentosByArea(area);
  const catalogoByCn = new Map(catalogo.map((med) => [med.cn, med]));
  const errores: string[] = [];
  const preparadas: Array<{
    cn: string;
    nombre: string;
    principioActivo: string | null;
    unidadesPorCaja: number;
    cajasPedidas: number;
    stockMinimo: number | null;
    puntoPedido: number | null;
    stockMaximo: number | null;
  }> = [];

  for (const raw of inputLineas) {
    const cn = String(raw.cn ?? '').trim();
    const cajasPedidas = parseNonNegativeInteger(raw.cajasPedidas);
    if (!cn) {
      errores.push('Línea sin CN.');
      continue;
    }
    if (cajasPedidas == null) {
      errores.push(`CN ${cn}: las cajas deben ser un entero >= 0.`);
      continue;
    }

    const med = catalogoByCn.get(cn);
    if (!med) {
      errores.push(`CN ${cn}: no existe en el catálogo del área Almacén.`);
      continue;
    }
    if ((med.ubicacion ?? '').trim() !== ubicacion) {
      errores.push(`CN ${cn}: no pertenece a la ubicación seleccionada.`);
      continue;
    }

    preparadas.push({
      cn,
      nombre: med.nombre,
      principioActivo: med.principioActivo,
      unidadesPorCaja: Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 1,
      cajasPedidas,
      stockMinimo: med.stockMinimo,
      puntoPedido: med.puntoPedido,
      stockMaximo: med.stockMaximo,
    });
  }

  if (errores.length > 0) {
    return NextResponse.json({ error: 'Hay líneas inválidas.', errores }, { status: 400 });
  }

  const { importacionId } = await ensureSesionPedidoAlmacen(area);

  const buckets = new Map<
    number,
    Array<{
      cn: string;
      nombre: string;
      unidadesPorCaja: number;
      cajasPedidas: number;
      stockMinimo: number | null;
      puntoPedido: number | null;
      stockMaximo: number | null;
    }>
  >();

  for (const linea of preparadas) {
    const propuestaId = await getOrCreatePropuestaAlmacenGrupo(
      area,
      importacionId,
      ubicacion,
      linea.principioActivo,
      linea.nombre
    );
    const list = buckets.get(propuestaId) ?? [];
    list.push(linea);
    buckets.set(propuestaId, list);
  }

  let upserted = 0;
  let eliminadas = 0;
  const propuestaIds: number[] = [];
  for (const [propuestaId, lineas] of buckets) {
    propuestaIds.push(propuestaId);
    const result = await upsertLineasPedidoAlmacen(propuestaId, lineas);
    upserted += result.upserted;
    eliminadas += result.eliminadas;
  }

  const totalLineas = await recalcularTotalLineasPedidoAlmacen(importacionId);
  const cantidadesPorPropuesta: Record<number, Record<string, number>> = {};
  for (const propuestaId of propuestaIds) {
    cantidadesPorPropuesta[propuestaId] = await getCantidadesPedidoAlmacen(propuestaId);
  }

  return NextResponse.json({
    ok: true,
    importacionId,
    propuestaIds,
    ubicacion,
    upserted,
    eliminadas,
    totalLineas,
    cantidadesPorPropuesta,
  });
}
