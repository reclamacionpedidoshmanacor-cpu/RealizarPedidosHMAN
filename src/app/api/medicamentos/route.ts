import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { medicamentos, stockObjetivo } from '@/db/schema';
import { eq, asc } from 'drizzle-orm';
import { isMSE } from '@/lib/utils';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';

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

  const rows = await db
    .select({
      cn:              medicamentos.cn,
      nombre:          medicamentos.nombre,
      principioActivo: medicamentos.principioActivo,
      via:             medicamentos.via,
      area:            medicamentos.area,
      ubicacion:       medicamentos.ubicacion,
      unidadesPorCaja: medicamentos.unidadesPorCaja,
      activo:          medicamentos.activo,
      comprable:       medicamentos.comprable,
      mse:             medicamentos.mse,
      tipoMse:         medicamentos.tipoMse,
      precioUnidad:    medicamentos.precioUnidad,
      precioCaja:      medicamentos.precioCaja,
      stockMinimo:     stockObjetivo.stockMinimo,
      puntoPedido:     stockObjetivo.puntoPedido,
      stockMaximo:     stockObjetivo.stockMaximo,
    })
    .from(medicamentos)
    .leftJoin(stockObjetivo, eq(medicamentos.cn, stockObjetivo.cn))
    .where(eq(medicamentos.area, area))
    .orderBy(asc(medicamentos.principioActivo));

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

  const existing = await db
    .select({ cn: medicamentos.cn, area: medicamentos.area })
    .from(medicamentos)
    .where(eq(medicamentos.cn, cn))
    .get();

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

  await db.insert(medicamentos).values({
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
  });

  if (body.stockMinimo != null || body.puntoPedido != null) {
    await db.insert(stockObjetivo).values({
      cn,
      stockMinimo: Number(body.stockMinimo ?? 0),
      puntoPedido: Number(body.puntoPedido ?? 0),
      stockMaximo: body.stockMaximo != null ? Number(body.stockMaximo) : undefined,
    });
  }

  return NextResponse.json({ ok: true });
}
