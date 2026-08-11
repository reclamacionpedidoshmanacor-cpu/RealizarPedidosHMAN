import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { isValidArea, type AreaId } from '@/lib/areas';
import {
  ensureTablesReposicion,
  getHistorialReposicion,
  getPedidoBorrador,
  crearPedidoBorrador,
  reemplazarLineasReposicionUbicacion,
  type LineaInput,
} from '@/lib/reposicion-neon';
import {
  isReposicionArea,
  listReposicionCatalogo,
  type ReposicionArea,
} from '@/lib/reposicion-catalogo-neon';

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
    const [historial, borrador] = await Promise.all([
      getHistorialReposicion(area),
      getPedidoBorrador(area),
    ]);
    return NextResponse.json({ area, borrador, historial });
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
    };

    if (!body.ubicacion || !Array.isArray(body.lineas)) {
      return NextResponse.json({ error: 'Falta ubicacion o lineas.' }, { status: 400 });
    }

    // Obtener borrador activo o crear uno nuevo
    let borrador = await getPedidoBorrador(area);
    if (!borrador) {
      borrador = await crearPedidoBorrador(area);
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

    const { upserted } = await reemplazarLineasReposicionUbicacion(
      borrador.id,
      body.ubicacion,
      lineasInput,
    );

    return NextResponse.json({ pedidoId: borrador.id, upserted, errores });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
