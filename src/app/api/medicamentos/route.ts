import { NextRequest, NextResponse } from 'next/server';
import { isMSE } from '@/lib/utils';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';
import {
  getMedicamentoByCn,
  insertMedicamento,
  listMedicamentosByArea,
  upsertStockObjetivo,
} from '@/lib/catalogo-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const queryArea = req.nextUrl.searchParams.get('area');
  if (queryArea && !isValidArea(queryArea)) {
    return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
  }

  const area = queryArea ?? session.area;
  if (area !== session.area) {
    return NextResponse.json({ error: 'No autorizado para otra area.' }, { status: 403 });
  }

  const rows = await listMedicamentosByArea(area);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const body = await req.json();
  const cn = String(body.cn ?? '').trim();
  if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });

  const area = body.area ?? session.area;
  if (!isValidArea(area)) {
    return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
  }
  if (area !== session.area) {
    return NextResponse.json({ error: 'No autorizado para crear en otra area.' }, { status: 403 });
  }

  const existing = await getMedicamentoByCn(cn);

  if (existing) {
    if (existing.area !== area) {
      return NextResponse.json(
        { error: `El CN ${cn} ya existe en el area ${existing.area} y no puede reasignarse.` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `El CN ${cn} ya existe en el catalogo del area ${area}.` },
      { status: 409 }
    );
  }

  await insertMedicamento({
    cn,
    nombre:          body.nombre,
    principioActivo: body.principioActivo ?? null,
    via:             body.via ?? null,
    area,
    ubicacion:       body.ubicacion ?? null,
    unidadesPorCaja: Number(body.unidadesPorCaja),
    activo:          body.activo ?? true,
    comprable:       body.comprable ?? true,
    mse:             isMSE(cn),
    tipoMse:         body.tipoMse ?? null,
    precioUnidad:    body.precioUnidad != null ? Number(body.precioUnidad) : null,
    precioCaja:      body.precioCaja != null ? Number(body.precioCaja) : null,
  });

  if (body.stockMinimo != null || body.puntoPedido != null) {
    await upsertStockObjetivo(
      cn,
      Number(body.stockMinimo ?? 0),
      Number(body.puntoPedido ?? 0),
      body.stockMaximo != null ? Number(body.stockMaximo) : null
    );
  }

  return NextResponse.json({ ok: true });
}
