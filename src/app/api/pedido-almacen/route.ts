import { NextRequest, NextResponse } from 'next/server';
import { isValidArea, type AreaId } from '@/lib/areas';
import { isAlmacenArea } from '@/lib/almacen';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';
import { requireApiSession } from '@/lib/api-auth';
import {
  ensureSesionPedidoAlmacen,
  getCantidadesPedidoAlmacen,
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
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ error: 'Pedido de almacén solo disponible para el área Almacén.' }, { status: 403 });
  }

  const pendiente = await getPedidoAlmacenPendiente(session.area);
  return NextResponse.json({ area: session.area, pendiente });
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
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

  const tieneCambios = preparadas.some((l) => l.cajasPedidas > 0);
  if (!tieneCambios && preparadas.every((l) => l.cajasPedidas === 0)) {
    // Permitir guardar ceros para limpiar líneas ya registradas
  }

  const { importacionId, propuestaId } = await ensureSesionPedidoAlmacen(area);
  const { upserted, eliminadas } = await upsertLineasPedidoAlmacen(propuestaId, preparadas);
  const totalLineas = await recalcularTotalLineasPedidoAlmacen(importacionId, propuestaId);
  const cantidades = await getCantidadesPedidoAlmacen(propuestaId);

  return NextResponse.json({
    ok: true,
    importacionId,
    propuestaId,
    ubicacion,
    upserted,
    eliminadas,
    totalLineas,
    cantidades,
  });
}
