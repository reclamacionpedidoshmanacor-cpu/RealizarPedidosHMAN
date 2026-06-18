import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { importacionesStock, medicamentos, stockRegistros } from '@/db/schema';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { id } = await params;
  const recuentoId = Number(id);
  if (!Number.isFinite(recuentoId)) {
    return NextResponse.json({ error: 'ID de recuento no valido.' }, { status: 400 });
  }

  const body = await req.json();
  const cn = String(body.cn ?? '').trim();
  const stockCajas = Number(body.stockCajas);

  if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
  if (!Number.isFinite(stockCajas) || stockCajas < 0) {
    return NextResponse.json({ error: 'Stock en cajas no valido.' }, { status: 400 });
  }

  const recuento = await db
    .select({ id: importacionesStock.id, estado: importacionesStock.estado, area: importacionesStock.area })
    .from(importacionesStock)
    .where(eq(importacionesStock.id, recuentoId))
    .get();

  if (!recuento) return NextResponse.json({ error: 'Recuento no encontrado.' }, { status: 404 });
  if (recuento.area !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
  if (recuento.estado !== 'pendiente') {
    return NextResponse.json({ error: 'Solo se puede editar un recuento pendiente.' }, { status: 409 });
  }

  const med = await db
    .select({ cn: medicamentos.cn, unidadesPorCaja: medicamentos.unidadesPorCaja, area: medicamentos.area })
    .from(medicamentos)
    .where(eq(medicamentos.cn, cn))
    .get();
  if (!med || med.area !== session.area) {
    return NextResponse.json({ error: 'Medicamento no encontrado en area activa.' }, { status: 404 });
  }

  const updated = await db
    .update(stockRegistros)
    .set({
      stockCajas,
      stockUnidades: stockCajas * med.unidadesPorCaja,
    })
    .where(and(eq(stockRegistros.importacionId, recuentoId), eq(stockRegistros.cn, cn)))
    .returning({ id: stockRegistros.id })
    .get();

  if (!updated) {
    return NextResponse.json({ error: 'Linea de recuento no encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
