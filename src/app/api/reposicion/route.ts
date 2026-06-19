import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import {
  ensureTablesReposicion,
  getHistorialReposicion,
  getPedidoBorrador,
  crearPedidoBorrador,
  upsertLineasReposicion,
  type LineaInput,
} from '@/lib/reposicion-neon';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';

const AREA_UPE = 'upe';

async function getArea(): Promise<string> {
  const jar = await cookies();
  return jar.get('area_session')?.value ?? AREA_UPE;
}

/* ── GET /api/reposicion ── lista historial + borrador activo */
export async function GET() {
  try {
    await ensureTablesReposicion();
    const area = await getArea();
    if (area !== AREA_UPE) {
      return NextResponse.json({ error: 'Pedidos de reposición solo disponibles para Pac. Externos.' }, { status: 403 });
    }
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
    const area = await getArea();
    if (area !== AREA_UPE) {
      return NextResponse.json({ error: 'Pedidos de reposición solo disponibles para Pac. Externos.' }, { status: 403 });
    }

    const body = await req.json() as {
      ubicacion: string;
      lineas: { cn: string; cantidadCajas: number }[];
    };

    if (!body.ubicacion || !Array.isArray(body.lineas)) {
      return NextResponse.json({ error: 'Falta ubicacion o lineas.' }, { status: 400 });
    }

    // Obtener borrador activo o crear uno nuevo
    let borrador = await getPedidoBorrador(area);
    if (!borrador) {
      borrador = await crearPedidoBorrador(area);
    }

    // Enriquecer con datos del catálogo (principio activo, nombre, stock máximo)
    const catalogo = await listMedicamentosByArea(area);
    const catMap = new Map(catalogo.map((m) => [m.cn, m]));

    const lineasInput: LineaInput[] = [];
    const errores: string[] = [];

    for (const l of body.lineas) {
      if (l.cantidadCajas <= 0) continue; // ignorar ceros
      const med = catMap.get(l.cn);
      if (!med) {
        errores.push(`CN ${l.cn} no encontrado en el catálogo.`);
        continue;
      }
      lineasInput.push({
        ubicacion: body.ubicacion,
        cn: l.cn,
        principioActivo: med.principioActivo ?? null,
        nombre: med.nombre,
        cantidadCajas: l.cantidadCajas,
        stockMaximo: med.stockMaximo ?? null,
      });
    }

    const { upserted } = await upsertLineasReposicion(borrador.id, lineasInput);

    return NextResponse.json({ pedidoId: borrador.id, upserted, errores });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
