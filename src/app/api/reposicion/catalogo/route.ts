import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { searchMedicamentosTodasAreas } from '@/lib/catalogo-neon';
import {
  isReposicionArea,
  listReposicionCatalogo,
  upsertReposicionCatalogoItem,
  type ReposicionCatalogoInput,
} from '@/lib/reposicion-catalogo-neon';

export async function GET(req: NextRequest) {
  try {
    const area = req.cookies.get('area_session')?.value;
    if (!isReposicionArea(area)) {
      return NextResponse.json({ error: 'Reposición no disponible para esta área.' }, { status: 403 });
    }
    const search = req.nextUrl.searchParams.get('search')?.trim() ?? '';
    if (search) {
      const resultados = await searchMedicamentosTodasAreas(search);
      return NextResponse.json({ area, resultados });
    }
    const includeInactive = req.cookies.get('auth_session')?.value === 'authenticated';
    const items = await listReposicionCatalogo(area, includeInactive);
    return NextResponse.json({ area, items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Error cargando catálogo de reposición.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return save(req);
}

export async function PATCH(req: NextRequest) {
  return save(req);
}

async function save(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (!isReposicionArea(session.area)) {
    return NextResponse.json({ error: 'Reposición no disponible para esta área.' }, { status: 403 });
  }
  try {
    const body = await req.json() as Partial<ReposicionCatalogoInput> & { id?: number };
    const item = await upsertReposicionCatalogoItem({
      areaDestino: session.area,
      ubicacionDestino: String(body.ubicacionDestino ?? ''),
      cn: body.cn == null ? null : String(body.cn),
      codigo: body.codigo == null ? undefined : String(body.codigo),
      tipo: body.tipo === 'formula' ? 'formula' : 'medicamento',
      nombre: body.nombre == null ? undefined : String(body.nombre),
      principioActivo: body.principioActivo == null ? null : String(body.principioActivo),
      unidadesPorCaja: body.unidadesPorCaja == null ? undefined : Number(body.unidadesPorCaja),
      unidadPedido: body.unidadPedido === 'unidades' ? 'unidades' : 'cajas',
      stockMaximo: body.stockMaximo == null ? null : Number(body.stockMaximo),
      puntoPedido: body.puntoPedido == null ? null : Number(body.puntoPedido),
      notas: body.notas == null ? null : String(body.notas),
      activo: body.activo ?? true,
    }, body.id == null ? undefined : Number(body.id));
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar.' },
      { status: 400 },
    );
  }
}
