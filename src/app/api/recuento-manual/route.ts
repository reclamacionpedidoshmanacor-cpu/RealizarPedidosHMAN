import { NextRequest, NextResponse } from 'next/server';
import { isValidArea, type AreaId } from '@/lib/areas';
import {
  filtrarPorLetra,
  isAlmacenArea,
  letrasDisponibles,
  mergeUbicacionesAlmacen,
  normalizeAlmacenText,
  ubicacionAlmacenUsaLetras,
} from '@/lib/almacen';
import { listMedicamentosByArea, getMedicamentoByCn, updateMedicamento } from '@/lib/catalogo-neon';
import { loadPedidosResumenAlmacenPorCns, cnClavePedidos } from '@/lib/pedidos-pendientes';
import { loadAlertasSuministroPorCnsSafe, alertaSuministroParaCn } from '@/lib/alertas-suministro';
import { isMSE } from '@/lib/utils';
import {
  crearRecuento,
  eliminarLineaPedidoAlmacenPorCn,
  getBorradorPropuesta,
  getCantidadesPedidoAlmacen,
  getLineasRecuento,
  getPedidoAlmacenPendiente,
  getPendienteRecuento,
  incorporarFaltantesRecuento,
  recalcularTotalLineasPedidoAlmacen,
  recalcularTotalLineasRecuento,
  upsertLineaRecuento,
} from '@/lib/stock-propuesta-neon';

export const runtime = 'nodejs';
const AREA_COOKIE_MAX_AGE = 60 * 60 * 12;

type BodyLinea = {
  cn?: unknown;
  cajas?: unknown;
  unidadesSueltas?: unknown;
};

function normalizeText(value: string | null | undefined): string {
  return normalizeAlmacenText(value);
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseNonNegativeInteger(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  if (!Number.isInteger(num)) return null;
  return num;
}

function buildUbicacionesMap(
  rows: Array<{ ubicacion: string | null }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const raw = String(row.ubicacion ?? '').trim();
    if (!raw) continue;
    const key = normalizeText(raw);
    if (!map.has(key)) map.set(key, raw);
  }
  return map;
}

function getAreaFromCookie(req: NextRequest): AreaId | null {
  const areaCookie = req.cookies.get('area_session')?.value;
  if (isValidArea(areaCookie)) return areaCookie;
  return null;
}

function withAreaCookie(res: NextResponse, area: AreaId): NextResponse {
  res.cookies.set('area_session', area, {
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: AREA_COOKIE_MAX_AGE,
  });
  return res;
}

export async function GET(req: NextRequest) {
  try {
    const areaQuery = req.nextUrl.searchParams.get('area');
    if (areaQuery && !isValidArea(areaQuery)) {
      return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
    }
    const area = isValidArea(areaQuery) ? areaQuery : getAreaFromCookie(req);
    if (!area) {
      return NextResponse.json({ error: 'Area no seleccionada o no valida.' }, { status: 400 });
    }

    const catalogo = await listMedicamentosByArea(area);
    const ubicacionesDesdeCatalogo = catalogo
      .map((m) => m.ubicacion)
      .filter((u): u is string => Boolean(u?.trim()));
    const ubicaciones = isAlmacenArea(area)
      ? mergeUbicacionesAlmacen(ubicacionesDesdeCatalogo)
      : [...buildUbicacionesMap(catalogo).values()].sort((a, b) =>
          a.localeCompare(b, 'es', { sensitivity: 'base' })
        );

    const ubicacionParam = req.nextUrl.searchParams.get('ubicacion');
    const ubicacionParamKey = normalizeText(ubicacionParam);
    const selectedKey =
      ubicacionParamKey && ubicaciones.some((u) => normalizeText(u) === ubicacionParamKey)
        ? ubicacionParamKey
        : normalizeText(ubicaciones[0] ?? '');
    const ubicacionSeleccionada =
      ubicaciones.find((u) => normalizeText(u) === selectedKey) ?? null;

    const letraParam = req.nextUrl.searchParams.get('letra');

    if (isAlmacenArea(area)) {
      const pedidoPendiente = await getPedidoAlmacenPendiente(area);
      let cantidadesPedido: Record<string, number> = {};
      if (pedidoPendiente) {
        const propuesta = await getBorradorPropuesta(area, pedidoPendiente.id);
        if (propuesta) {
          cantidadesPedido = await getCantidadesPedidoAlmacen(propuesta.id);
        }
      }

      const medsUbicacion = catalogo
        .filter((med) => med.activo && normalizeText(med.ubicacion) === selectedKey)
        .sort((a, b) => {
          const pa = (a.principioActivo ?? a.nombre).localeCompare(
            b.principioActivo ?? b.nombre,
            'es',
            { sensitivity: 'base' }
          );
          if (pa !== 0) return pa;
          return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
        });

      const usaLetras = ubicacionAlmacenUsaLetras(ubicacionSeleccionada);
      const letras = usaLetras ? letrasDisponibles(medsUbicacion) : [];
      const filtrados = usaLetras
        ? filtrarPorLetra(medsUbicacion, letraParam)
        : medsUbicacion;

      let pedidosPorCn: Awaited<ReturnType<typeof loadPedidosResumenAlmacenPorCns>> = {};
      let alertasPorCn: Awaited<ReturnType<typeof loadAlertasSuministroPorCnsSafe>> = {};
      try {
        pedidosPorCn = await loadPedidosResumenAlmacenPorCns(filtrados.map((med) => med.cn));
      } catch {
        pedidosPorCn = {};
      }
      try {
        alertasPorCn = await loadAlertasSuministroPorCnsSafe(filtrados.map((med) => med.cn));
      } catch {
        alertasPorCn = {};
      }

      const medicamentos = filtrados.map((med) => {
        const unidadesPorCaja = Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 1;
        const tieneStockOrientativo =
          med.stockMinimo != null || med.puntoPedido != null || med.stockMaximo != null;
        const pedidos = pedidosPorCn[cnClavePedidos(med.cn) ?? med.cn] ?? {
          pedidosRecibidos14d: 0,
          unidadesRecibidas14d: 0,
          pedidosPendientes: 0,
          unidadesPendientes: 0,
          ultimoRecibidoFecha: null,
          ultimoRecibidoUnidades: 0,
        };

        return {
          cn: med.cn,
          principioActivo: med.principioActivo,
          nombre: med.nombre,
          presentacion: med.presentacion,
          ubicacion: med.ubicacion,
          activo: med.activo,
          unidadesPorCaja: Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 0,
          cajasPedidas: cantidadesPedido[med.cn] ?? 0,
          stockMinimo: med.stockMinimo,
          puntoPedido: med.puntoPedido,
          stockMaximo: med.stockMaximo,
          tieneStockOrientativo,
          pedidosRecibidos14d: pedidos.pedidosRecibidos14d,
          unidadesRecibidas14d: pedidos.unidadesRecibidas14d,
          pedidosPendientes: pedidos.pedidosPendientes,
          unidadesPendientes: pedidos.unidadesPendientes,
          ultimoRecibidoFecha: pedidos.ultimoRecibidoFecha,
          ultimoRecibidoUnidades: pedidos.ultimoRecibidoUnidades,
          alertaSuministro: alertaSuministroParaCn(alertasPorCn, med.cn),
        };
      });

      const res = NextResponse.json({
        area,
        modo: 'pedido-almacen',
        pedidoPendiente,
        ubicaciones,
        ubicacionSeleccionada,
        letraSeleccionada: usaLetras ? letraParam?.trim().toLocaleUpperCase('es') || null : null,
        letrasDisponibles: letras,
        usaLetrasUbicacion: usaLetras,
        medicamentos,
        totalUbicacion: medsUbicacion.length,
      });
      return withAreaCookie(res, area);
    }

    const ubicacionesMap = buildUbicacionesMap(catalogo);

    const pendiente = await getPendienteRecuento(area);
    const lineasPendiente = pendiente ? await getLineasRecuento(pendiente.id) : [];
    const lineasByCn = new Map(lineasPendiente.map((linea) => [linea.cn, linea]));

    const lineasCn = new Set(lineasPendiente.map((l) => l.cn));
    const faltantesActivosArea = catalogo.filter((med) => med.activo && !lineasCn.has(med.cn)).length;
    const faltantesActivosUbicacion = ubicacionSeleccionada
      ? catalogo.filter(
          (med) =>
            med.activo &&
            normalizeText(med.ubicacion) === selectedKey &&
            !lineasCn.has(med.cn)
        ).length
      : 0;

    const medicamentos = ubicacionSeleccionada
      ? catalogo
          .filter((med) => med.activo && normalizeText(med.ubicacion) === selectedKey)
          .map((med) => {
            const unidadesPorCaja = Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 1;
            const linea = lineasByCn.get(med.cn);
            const stockUnidades = linea
              ? Math.max(0, Math.round(Number(linea.stockUnidades)))
              : 0;
            const cajas = Math.floor(stockUnidades / unidadesPorCaja);
            const unidadesSueltas = stockUnidades - cajas * unidadesPorCaja;

            return {
              cn: med.cn,
              principioActivo: med.principioActivo,
              nombre: med.nombre,
              activo: med.activo,
              unidadesPorCaja,
              cajas,
              unidadesSueltas,
              registradoEnRecuento: Boolean(linea),
              stockMaximo: med.stockMaximo ?? null,
            };
          })
      : [];

    const res = NextResponse.json({
      area,
      modo: 'recuento',
      pendiente,
      ubicaciones,
      ubicacionSeleccionada,
      medicamentos,
      faltantesActivosArea,
      faltantesActivosUbicacion,
    });
    return withAreaCookie(res, area);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action?: unknown;
      area?: unknown;
      ubicacion?: unknown;
      fechaRecuento?: unknown;
      lineas?: unknown;
      cn?: unknown;
      principioActivo?: unknown;
      nombre?: unknown;
      presentacion?: unknown;
      unidadesPorCaja?: unknown;
    };

    const action = String(body.action ?? '').trim().toLowerCase();
    const areaRaw = String(body.area ?? '').trim();
    if (areaRaw && !isValidArea(areaRaw)) {
      return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
    }
    const area = isValidArea(areaRaw) ? areaRaw : getAreaFromCookie(req);
    if (!area) {
      return NextResponse.json({ error: 'Area no seleccionada o no valida.' }, { status: 400 });
    }

    if (action === 'editar-catalogo') {
      if (!isAlmacenArea(area)) {
        return NextResponse.json({ error: 'Edición de catálogo solo disponible en Almacén.' }, { status: 400 });
      }

      const cn = String(body.cn ?? '').trim();
      if (!cn) {
        return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
      }

      const existing = await getMedicamentoByCn(cn);
      if (!existing) {
        return NextResponse.json({ error: 'Medicamento no encontrado.' }, { status: 404 });
      }
      if (existing.area !== area) {
        return NextResponse.json({ error: 'No autorizado para esta area.' }, { status: 403 });
      }

      const nombre = body.nombre != null ? String(body.nombre).trim() : existing.nombre;
      if (!nombre) {
        return NextResponse.json({ error: 'Nombre requerido.' }, { status: 400 });
      }

      const principioActivo =
        body.principioActivo != null
          ? String(body.principioActivo).trim() || null
          : existing.principioActivo;
      const presentacion =
        body.presentacion != null
          ? String(body.presentacion).trim() || null
          : existing.presentacion;
      const ubicacionEdit =
        body.ubicacion != null ? String(body.ubicacion).trim() : (existing.ubicacion ?? '');
      if (!ubicacionEdit) {
        return NextResponse.json({ error: 'Ubicación requerida.' }, { status: 400 });
      }

      let unidadesPorCaja = existing.unidadesPorCaja;
      if (body.unidadesPorCaja != null) {
        const n = Number(body.unidadesPorCaja);
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json({ error: 'Uds/caja inválidas.' }, { status: 400 });
        }
        unidadesPorCaja = Math.round(n);
      }

      await updateMedicamento({
        cn,
        nombre,
        principioActivo,
        presentacion,
        via: existing.via,
        area: existing.area,
        ubicacion: ubicacionEdit,
        unidadesPorCaja,
        activo: existing.activo,
        comprable: existing.comprable,
        mse: isMSE(cn),
        tipoMse: existing.tipoMse,
        precioUnidad: existing.precioUnidad,
        precioCaja: existing.precioCaja,
      });

      const res = NextResponse.json({ ok: true, action: 'editar-catalogo', cn });
      return withAreaCookie(res, area);
    }

    if (action === 'marcar-inactivo') {
      if (!isAlmacenArea(area)) {
        return NextResponse.json({ error: 'Solo disponible en Almacén.' }, { status: 400 });
      }

      const cn = String(body.cn ?? '').trim();
      if (!cn) {
        return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
      }

      const existing = await getMedicamentoByCn(cn);
      if (!existing) {
        return NextResponse.json({ error: 'Medicamento no encontrado.' }, { status: 404 });
      }
      if (existing.area !== area) {
        return NextResponse.json({ error: 'No autorizado para esta area.' }, { status: 403 });
      }

      if (existing.activo) {
        await updateMedicamento({
          cn,
          nombre: existing.nombre,
          principioActivo: existing.principioActivo,
          presentacion: existing.presentacion,
          via: existing.via,
          area: existing.area,
          ubicacion: existing.ubicacion,
          unidadesPorCaja: existing.unidadesPorCaja,
          activo: false,
          comprable: existing.comprable,
          mse: isMSE(cn),
          tipoMse: existing.tipoMse,
          precioUnidad: existing.precioUnidad,
          precioCaja: existing.precioCaja,
        });

        const pedidoPendiente = await getPedidoAlmacenPendiente(area);
        if (pedidoPendiente) {
          const propuesta = await getBorradorPropuesta(area, pedidoPendiente.id);
          if (propuesta) {
            await eliminarLineaPedidoAlmacenPorCn(propuesta.id, cn);
            await recalcularTotalLineasPedidoAlmacen(pedidoPendiente.id, propuesta.id);
          }
        }
      }

      const res = NextResponse.json({ ok: true, action: 'marcar-inactivo', cn });
      return withAreaCookie(res, area);
    }

    if (isAlmacenArea(area)) {
      return NextResponse.json(
        { error: 'En Almacén use el flujo de pedido (/api/pedido-almacen), no recuento de stock.' },
        { status: 400 }
      );
    }

    if (action === 'incorporar-faltantes') {
      const catalogo = await listMedicamentosByArea(area);
      const pendiente = await getPendienteRecuento(area);
      if (!pendiente) {
        return NextResponse.json({ error: 'No hay recuento pendiente en esta area.' }, { status: 404 });
      }

      const ubicacionRaw = String(body.ubicacion ?? '').trim();
      const ubicacionesMap = buildUbicacionesMap(catalogo);
      let ubicacionKey: string | undefined;
      if (ubicacionRaw) {
        ubicacionKey = normalizeText(ubicacionRaw);
        if (!ubicacionesMap.has(ubicacionKey)) {
          return NextResponse.json({ error: 'Ubicacion no valida para el area seleccionada.' }, { status: 400 });
        }
      }

      const { insertadas, totalLineas } = await incorporarFaltantesRecuento(
        pendiente.id,
        catalogo,
        ubicacionKey ? { ubicacionNormalizada: ubicacionKey } : undefined
      );

      const res = NextResponse.json({
        ok: true,
        action: 'incorporar-faltantes',
        importacionId: pendiente.id,
        insertadas,
        totalLineas,
        alcance: ubicacionKey ? 'ubicacion' : 'area',
      });
      return withAreaCookie(res, area);
    }

    const ubicacionRaw = String(body.ubicacion ?? '').trim();
    if (!ubicacionRaw) {
      return NextResponse.json({ error: 'Ubicacion requerida.' }, { status: 400 });
    }

    const fechaRecuentoRaw = String(body.fechaRecuento ?? '').trim();
    if (fechaRecuentoRaw && !/^\d{4}-\d{2}-\d{2}$/.test(fechaRecuentoRaw)) {
      return NextResponse.json({ error: 'Fecha de recuento no valida.' }, { status: 400 });
    }
    const fechaRecuento = fechaRecuentoRaw || todayIsoDate();

    const inputLineas = Array.isArray(body.lineas) ? (body.lineas as BodyLinea[]) : [];
    if (inputLineas.length === 0) {
      return NextResponse.json({ error: 'No hay lineas para guardar.' }, { status: 400 });
    }

    const catalogo = await listMedicamentosByArea(area);
    const ubicacionesMap = buildUbicacionesMap(catalogo);
    const ubicacionKey = normalizeText(ubicacionRaw);
    const ubicacionSeleccionada = ubicacionesMap.get(ubicacionKey);
    if (!ubicacionSeleccionada) {
      return NextResponse.json({ error: 'Ubicacion no valida para el area seleccionada.' }, { status: 400 });
    }

    const catalogoByCn = new Map(catalogo.map((med) => [med.cn, med]));
    const errores: string[] = [];

    const preparadas: Array<{
      cn: string;
      stockUnidades: number;
      stockCajas: number;
    }> = [];

    for (const raw of inputLineas) {
      const cn = String(raw.cn ?? '').trim();
      const cajas = parseNonNegativeInteger(raw.cajas);
      const unidadesSueltas = parseNonNegativeInteger(raw.unidadesSueltas);

      if (!cn) {
        errores.push('Linea sin CN.');
        continue;
      }
      if (cajas == null || unidadesSueltas == null) {
        errores.push(`CN ${cn}: cajas y unidades sueltas deben ser enteros >= 0.`);
        continue;
      }

      const med = catalogoByCn.get(cn);
      if (!med) {
        errores.push(`CN ${cn}: no existe en el catalogo del area activa.`);
        continue;
      }
      if (normalizeText(med.ubicacion) !== ubicacionKey) {
        errores.push(`CN ${cn}: no pertenece a la ubicacion seleccionada (${ubicacionSeleccionada}).`);
        continue;
      }

      const unidadesPorCaja = Number(med.unidadesPorCaja) > 0 ? Number(med.unidadesPorCaja) : 1;
      const extraCajas = Math.floor(unidadesSueltas / unidadesPorCaja);
      const sueltasNormalizadas = unidadesSueltas % unidadesPorCaja;
      const cajasNormalizadas = cajas + extraCajas;
      const stockUnidades = cajasNormalizadas * unidadesPorCaja + sueltasNormalizadas;
      const stockCajas = stockUnidades / unidadesPorCaja;

      preparadas.push({
        cn,
        stockUnidades,
        stockCajas,
      });
    }

    if (errores.length > 0) {
      return NextResponse.json(
        { error: 'Hay lineas invalidas en el recuento manual.', errores },
        { status: 400 }
      );
    }

    const pendiente = await getPendienteRecuento(area);

    if (!pendiente && preparadas.length === 0) {
      return NextResponse.json(
        { error: 'No hay líneas para guardar en el recuento manual.' },
        { status: 400 }
      );
    }

    const importacionId =
      pendiente?.id ??
      (await crearRecuento({
        area,
        origen: 'Manual',
        fechaRecuento,
        ficheroNombre: 'APP Recuento Manual',
        totalLineas: 0,
      }));

    const existentes = await getLineasRecuento(importacionId);
    const existentesByCn = new Map(existentes.map((linea) => [linea.cn, linea]));

    let insertadas = 0;
    let actualizadas = 0;
    let sinCambios = 0;

    for (const linea of preparadas) {
      const actual = existentesByCn.get(linea.cn);
      const stockActual = actual != null
        ? Math.max(0, Math.round(Number(actual.stockUnidades)))
        : null;

      if (stockActual !== null && stockActual === linea.stockUnidades) {
        sinCambios += 1;
        continue;
      }

      const result = await upsertLineaRecuento(importacionId, {
        cn: linea.cn,
        stockUnidades: linea.stockUnidades,
        stockCajas: linea.stockCajas,
        valorTotal: null,
      });
      if (result === 'inserted') insertadas += 1;
      else actualizadas += 1;
    }

    if (insertadas === 0 && actualizadas === 0) {
      return NextResponse.json(
        { error: 'No hay cambios para guardar en esta ubicacion.' },
        { status: 400 }
      );
    }

    const totalLineas = await recalcularTotalLineasRecuento(importacionId);

    const res = NextResponse.json({
      ok: true,
      importacionId,
      totalLineas,
      ubicacion: ubicacionSeleccionada,
      insertadas,
      actualizadas,
      sinCambios,
    });
    return withAreaCookie(res, area);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
