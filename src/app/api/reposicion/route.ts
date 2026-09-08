import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { isValidArea, type AreaId } from '@/lib/areas';
import {
  ensureTablesReposicion,
  getHistorialReposicion,
  getPedidoBorrador,
  getPedidosBorrador,
  getPedidoConLineas,
  crearPedidoBorrador,
  reemplazarLineasReposicionUbicacion,
  type LineaInput,
} from '@/lib/reposicion-neon';
import {
  isReposicionArea,
  listReposicionCatalogo,
  type ReposicionArea,
} from '@/lib/reposicion-catalogo-neon';
import {
  consultasDeArea,
  esConsultaValida,
  normalizarConsulta,
} from '@/lib/reposicion-consultas';

async function getAreaFromCookie(): Promise<AreaId | null> {
  const jar = await cookies();
  const area = jar.get('area_session')?.value;
  return isValidArea(area) ? area : null;
}

async function requireReposicionArea(): Promise<
  | { ok: true; area: ReposicionArea }
  | { ok: false; response: NextResponse }
> {
  const area = await getAreaFromCookie();
  if (!area) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Area no seleccionada o no valida.' }, { status: 400 }),
    };
  }
  if (!isReposicionArea(area)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Pedidos de reposición solo disponibles para UPE y Oncología.' },
        { status: 403 }
      ),
    };
  }
  return { ok: true, area };
}

/* ── GET /api/reposicion ── lista historial + borrador activo */
export async function GET() {
  try {
    await ensureTablesReposicion();
    const access = await requireReposicionArea();
    if (!access.ok) return access.response;

    const area = access.area;
    const [historial, borradores] = await Promise.all([
      getHistorialReposicion(area),
      getPedidosBorrador(area),
    ]);
    return NextResponse.json({
      area,
      // Se conserva por compatibilidad con las pantallas que aún resumen uno solo.
      borrador: borradores[0] ?? null,
      borradores,
      historial,
      consultas: consultasDeArea(area),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/* ── POST /api/reposicion ── añadir líneas a borrador (crea si no existe) */
export async function POST(req: NextRequest) {
  try {
    await ensureTablesReposicion();
    const access = await requireReposicionArea();
    if (!access.ok) return access.response;

    const area = access.area;

    const body = await req.json() as {
      ubicacion: string;
      lineas: { catalogoId: number; cantidadCajas: number }[];
      consultaDestino?: unknown;
      pedidoId?: unknown;
      crearNuevo?: boolean;
    };

    if (!body.ubicacion || !Array.isArray(body.lineas)) {
      return NextResponse.json({ error: 'Falta ubicacion o lineas.' }, { status: 400 });
    }
    const consultaDestino = normalizarConsulta(body.consultaDestino);
    if (!esConsultaValida(area, consultaDestino)) {
      return NextResponse.json(
        { error: `Selecciona una consulta válida (${consultasDeArea(area).join(', ')}).` },
        { status: 400 },
      );
    }

    const catalogo = await listReposicionCatalogo(area);
    const catMap = new Map(catalogo.map((item) => [item.id, item]));

    const lineasInput: LineaInput[] = [];
    const errores: string[] = [];

    for (const l of body.lineas) {
      if (!Number.isInteger(l.cantidadCajas) || l.cantidadCajas < 0) {
        errores.push(`Cantidad no válida para la configuración ${l.catalogoId}.`);
        continue;
      }
      if (l.cantidadCajas === 0) continue;
      const item = catMap.get(Number(l.catalogoId));
      if (!item || item.ubicacionDestino !== body.ubicacion) {
        errores.push(`Configuración ${l.catalogoId} no encontrada en esta ubicación.`);
        continue;
      }
      lineasInput.push({
        ubicacion: body.ubicacion,
        cn: item.cn ?? item.codigo,
        codigo: item.codigo,
        tipo: item.tipo,
        areaOrigen: item.areaOrigen,
        ubicacionOrigen: item.ubicacionOrigen,
        principioActivo: item.principioActivo,
        nombre: item.nombre,
        cantidadCajas: l.cantidadCajas,
        stockMaximo: item.stockMaximo,
        puntoPedido: item.puntoPedido,
        notas: item.notas,
        unidadPedido: item.unidadPedido,
        catalogoId: item.id,
      });
    }

    // Solo se abre un pedido nuevo si hay algo que añadir: evita borradores vacíos
    // que después bloquean la finalización.
    const pedidoIdSolicitado =
      body.pedidoId == null ? null : Number(body.pedidoId);
    if (
      pedidoIdSolicitado != null &&
      (!Number.isInteger(pedidoIdSolicitado) || pedidoIdSolicitado <= 0)
    ) {
      return NextResponse.json({ error: 'Pedido no válido.' }, { status: 400 });
    }

    let borrador = null;
    if (pedidoIdSolicitado != null) {
      const pedido = await getPedidoConLineas(pedidoIdSolicitado);
      if (
        !pedido ||
        pedido.cabecera.area !== area ||
        pedido.cabecera.estado !== 'borrador' ||
        pedido.cabecera.consultaDestino !== consultaDestino
      ) {
        return NextResponse.json(
          { error: 'El pedido ya no está disponible para esta consulta.' },
          { status: 409 },
        );
      }
      borrador = pedido.cabecera;
    } else if (!body.crearNuevo) {
      borrador = await getPedidoBorrador(area, consultaDestino);
    }

    if (!borrador) {
      if (lineasInput.length === 0) {
        return NextResponse.json(
          {
            error: errores[0] ?? 'No hay cantidades válidas que añadir al pedido.',
            errores,
          },
          { status: 400 },
        );
      }
      borrador = await crearPedidoBorrador(area, consultaDestino);
    }

    const { upserted } = await reemplazarLineasReposicionUbicacion(
      borrador.id,
      body.ubicacion,
      lineasInput,
    );

    return NextResponse.json({
      pedidoId: borrador.id,
      consultaDestino,
      upserted,
      errores,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
