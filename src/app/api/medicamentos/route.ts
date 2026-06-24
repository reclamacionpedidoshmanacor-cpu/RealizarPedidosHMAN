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
import { isAlmacenArea } from '@/lib/almacen';
import {
  alertaSuministroParaCn,
  loadAlertasSuministroPorCnsSafe,
} from '@/lib/alertas-suministro';

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
  const alertas = await loadAlertasSuministroPorCnsSafe(rows.map((r) => r.cn));
  const enriched = rows.map((row) => ({
    ...row,
    alertaSuministro: alertaSuministroParaCn(alertas, row.cn),
  }));
  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const body = await req.json();
  const cn = String(body.cn ?? '').trim();
  if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });

  const area = String(body.area ?? '').trim();
  if (!area) {
    return NextResponse.json({ error: 'Area requerida.' }, { status: 400 });
  }
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
    presentacion:    body.presentacion ?? null,
    via:             body.via ?? null,
    area,
    ubicacion:       body.ubicacion ?? null,
    unidadesPorCaja: Number(body.unidadesPorCaja) || 1,
    activo:          body.activo ?? true,
    comprable:       body.comprable ?? true,
    mse:             isMSE(cn),
    tipoMse:         body.tipoMse ?? null,
    precioUnidad:    body.precioUnidad != null ? Number(body.precioUnidad) : null,
    precioCaja:      body.precioCaja != null ? Number(body.precioCaja) : null,
  });

  const tieneStockObjetivo =
    body.stockMinimo != null ||
    body.puntoPedido != null ||
    body.stockMaximo != null;

  if (tieneStockObjetivo) {
    await upsertStockObjetivo(
      cn,
      Number(body.stockMinimo ?? 0),
      Number(body.puntoPedido ?? 0),
      body.stockMaximo != null && body.stockMaximo !== '' ? Number(body.stockMaximo) : null
    );
  } else if (!isAlmacenArea(area)) {
    await upsertStockObjetivo(cn, 0, 0, null);
  }

  return NextResponse.json({ ok: true });
}
