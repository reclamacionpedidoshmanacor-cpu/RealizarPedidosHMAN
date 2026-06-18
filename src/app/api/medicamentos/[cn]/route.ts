import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { medicamentos, stockObjetivo } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ cn: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { cn } = await params;
  const body = await req.json();
  const existing = await db
    .select({ cn: medicamentos.cn, area: medicamentos.area })
    .from(medicamentos)
    .where(eq(medicamentos.cn, cn))
    .get();

  if (!existing) {
    return NextResponse.json({ error: 'Medicamento no encontrado.' }, { status: 404 });
  }
  if (existing.area !== session.area) {
    return NextResponse.json({ error: 'No autorizado para esta area.' }, { status: 403 });
  }
  if ('area' in body) {
    if (!isValidArea(body.area)) {
      return NextResponse.json({ error: 'Area no valida.' }, { status: 400 });
    }
    if (body.area !== existing.area) {
      return NextResponse.json(
        { error: `El CN ${cn} pertenece al area ${existing.area} y no puede reasignarse.` },
        { status: 409 }
      );
    }
    delete body.area;
  }

  const medUpdate: Record<string, unknown> = { actualizadoEn: new Date().toISOString() };
  const objUpdate: Record<string, unknown> = { actualizadoEn: new Date().toISOString() };

  const medFields = ['nombre','principioActivo','via','area','ubicacion','unidadesPorCaja','activo','comprable','tipoMse'];
  const objFields = ['stockMinimo','puntoPedido','stockMaximo'];

  for (const f of medFields) if (f in body) medUpdate[f] = body[f];
  for (const f of objFields) if (f in body) objUpdate[f] = body[f];

  if (Object.keys(medUpdate).length > 1) {
    await db.update(medicamentos).set(medUpdate as never).where(eq(medicamentos.cn, cn));
  }

  if (Object.keys(objUpdate).length > 1) {
    const existing = await db.select({ id: stockObjetivo.id }).from(stockObjetivo)
      .where(eq(stockObjetivo.cn, cn)).get();
    if (existing) {
      await db.update(stockObjetivo).set(objUpdate as never).where(eq(stockObjetivo.cn, cn));
    } else {
      await db.insert(stockObjetivo).values({ cn, stockMinimo: 0, puntoPedido: 0, ...objUpdate });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ cn: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { cn } = await params;
  const existing = await db
    .select({ cn: medicamentos.cn, area: medicamentos.area })
    .from(medicamentos)
    .where(eq(medicamentos.cn, cn))
    .get();

  if (!existing) {
    return NextResponse.json({ error: 'Medicamento no encontrado.' }, { status: 404 });
  }
  if (existing.area !== session.area) {
    return NextResponse.json({ error: 'No autorizado para esta area.' }, { status: 403 });
  }

  await db.delete(stockObjetivo).where(eq(stockObjetivo.cn, cn));
  await db.delete(medicamentos).where(eq(medicamentos.cn, cn));
  return NextResponse.json({ ok: true });
}
