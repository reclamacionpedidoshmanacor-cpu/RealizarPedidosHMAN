import { NextRequest, NextResponse } from 'next/server';
import { isAlmacenArea } from '@/lib/almacen';
import { buscarMedicamentoPorCN } from '@/lib/cima';
import {
  getMedicamentoByCn,
  getStockObjetivoByCn,
  insertMedicamento,
  updateMedicamento,
  upsertStockObjetivo,
} from '@/lib/catalogo-neon';
import { requireApiSessionOrArea } from '@/lib/api-auth';
import { isMSE, normalizarCnParaCima } from '@/lib/utils';
import {
  ensureSesionPedidoAlmacen,
  eliminarLineaPedidoAlmacenPorCnEnSesion,
  getCantidadesPedidoAlmacen,
  getOrCreatePropuestaAlmacenGrupo,
  recalcularTotalLineasPedidoAlmacen,
  upsertLineasPedidoAlmacen,
} from '@/lib/stock-propuesta-neon';
import { registrarRevisionPendiente } from '@/lib/catalogo-revision-neon';

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
  };

  const cnViejo = String(body.cnViejo ?? '').trim();
  const cnNuevoRaw = String(body.cnNuevo ?? '').trim();
  const ubicacion = String(body.ubicacion ?? '').trim();
  const cajasPedidas = parseNonNegativeInteger(body.cajasPedidas) ?? 0;

  if (!cnViejo || !cnNuevoRaw || !ubicacion) {
    return NextResponse.json({ error: 'CN anterior, CN nuevo y ubicación son obligatorios.' }, { status: 400 });
  }

  const cnNuevo = normalizarCnParaCima(cnNuevoRaw);
  if (!cnNuevo) {
    return NextResponse.json({ error: 'CN nuevo no válido.' }, { status: 400 });
  }
  if (cnViejo === cnNuevo) {
    return NextResponse.json({ error: 'El CN nuevo debe ser distinto del anterior.' }, { status: 400 });
  }

  const viejo = await getMedicamentoByCn(cnViejo);
  if (!viejo || viejo.area !== session.area) {
    return NextResponse.json({ error: `CN ${cnViejo} no encontrado en el catálogo de Almacén.` }, { status: 404 });
  }
  if ((viejo.ubicacion ?? '').trim() !== ubicacion) {
    return NextResponse.json({ error: 'El medicamento anterior no pertenece a esta ubicación.' }, { status: 400 });
  }

  const cima = await buscarMedicamentoPorCN(cnNuevoRaw);
  if (!cima) {
    return NextResponse.json(
      { error: `CN ${cnNuevo} no encontrado en CIMA (AEMPS).` },
      { status: 404 }
    );
  }

  const existenteNuevo = await getMedicamentoByCn(cnNuevo);
  if (existenteNuevo && existenteNuevo.area !== session.area) {
    return NextResponse.json(
      { error: `El CN ${cnNuevo} ya existe en el área ${existenteNuevo.area}.` },
      { status: 409 }
    );
  }

  const unidadesPorCaja = cima.unidadesPorCaja && cima.unidadesPorCaja > 0
    ? cima.unidadesPorCaja
    : 1;

  if (!existenteNuevo) {
    await insertMedicamento({
      cn: cnNuevo,
      nombre: cima.nombre,
      principioActivo: cima.principioActivo || null,
      presentacion: cima.presentacion || null,
      via: 'OTRO',
      area: session.area,
      ubicacion,
      unidadesPorCaja,
      activo: true,
      comprable: true,
      mse: isMSE(cnNuevo),
      tipoMse: null,
      precioUnidad: null,
      precioCaja: null,
    });
  } else {
    await updateMedicamento({
      cn: cnNuevo,
      nombre: cima.nombre,
      principioActivo: cima.principioActivo || existenteNuevo.principioActivo,
      presentacion: cima.presentacion || existenteNuevo.presentacion || null,
      via: existenteNuevo.via ?? 'OTRO',
      area: session.area,
      ubicacion,
      unidadesPorCaja,
      activo: true,
      comprable: existenteNuevo.comprable,
      mse: isMSE(cnNuevo),
      tipoMse: existenteNuevo.tipoMse,
      precioUnidad: existenteNuevo.precioUnidad,
      precioCaja: existenteNuevo.precioCaja,
    });
  }

  const stockViejo = await getStockObjetivoByCn(cnViejo);
  const stockNuevo = await getStockObjetivoByCn(cnNuevo);
  if (stockViejo && !stockNuevo) {
    await upsertStockObjetivo(
      cnNuevo,
      stockViejo.stockMinimo,
      stockViejo.puntoPedido,
      stockViejo.stockMaximo
    );
  }

  await updateMedicamento({
    ...viejo,
    activo: false,
  });

  const { importacionId } = await ensureSesionPedidoAlmacen(session.area);
  await eliminarLineaPedidoAlmacenPorCnEnSesion(importacionId, cnViejo);

  let propuestaId: number | null = null;
  if (cajasPedidas > 0) {
    const stockNuevoFinal = await getStockObjetivoByCn(cnNuevo);
    propuestaId = await getOrCreatePropuestaAlmacenGrupo(
      session.area,
      importacionId,
      ubicacion,
      cima.principioActivo,
      cima.nombre
    );
    await upsertLineasPedidoAlmacen(propuestaId, [{
      cn: cnNuevo,
      nombre: cima.nombre,
      unidadesPorCaja,
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

  const stockFinal = await getStockObjetivoByCn(cnNuevo);

  await registrarRevisionPendiente({
    area: session.area,
    cn: cnNuevo,
    cnAnterior: cnViejo,
    origen: 'sustitucion-pasillo',
    ubicacion,
    nombreCima: cima.nombre,
    principioActivoCima: cima.principioActivo,
    presentacionCima: cima.presentacion,
    unidadesPorCaja,
  });

  return NextResponse.json({
    ok: true,
    cnViejo,
    cnNuevo,
    cajasPedidas,
    totalLineas,
    cantidades,
    medicamento: {
      cn: cnNuevo,
      nombre: cima.nombre,
      principioActivo: cima.principioActivo,
      presentacion: cima.presentacion,
      unidadesPorCaja,
      ubicacion,
      activo: true,
      stockMinimo: stockFinal?.stockMinimo ?? null,
      puntoPedido: stockFinal?.puntoPedido ?? null,
      stockMaximo: stockFinal?.stockMaximo ?? null,
      cajasPedidas: cantidades[cnNuevo] ?? cajasPedidas,
    },
  });
}
