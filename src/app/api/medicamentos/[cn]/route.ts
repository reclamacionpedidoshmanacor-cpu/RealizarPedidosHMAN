import { NextRequest, NextResponse } from 'next/server';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';
import { isMSE, roundCajas } from '@/lib/utils';
import {
  deleteMedicamentoByCn,
  deleteStockObjetivo,
  getMedicamentoByCn,
  getStockObjetivoByCn,
  updateMedicamento,
  upsertStockObjetivo,
} from '@/lib/catalogo-neon';
import { isAlmacenArea } from '@/lib/almacen';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ cn: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { cn } = await params;
  const body = await req.json();
  const existing = await getMedicamentoByCn(cn);

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
  const objUpdate: Record<string, unknown> = {};

  const medFields = ['nombre','principioActivo','presentacion','via','area','ubicacion','unidadesPorCaja','activo','comprable','tipoMse'];
  const objFields = ['stockMinimo','puntoPedido','stockMaximo'];
  const clearStockObjetivo = body.clearStockObjetivo === true;

  for (const f of medFields) if (f in body) medUpdate[f] = body[f];
  for (const f of objFields) if (f in body) objUpdate[f] = body[f];

  if (Object.keys(medUpdate).length > 1) {
    await updateMedicamento({
      cn,
      nombre: (medUpdate.nombre as string | undefined) ?? existing.nombre,
      principioActivo: (medUpdate.principioActivo as string | null | undefined) ?? existing.principioActivo,
      presentacion: (medUpdate.presentacion as string | null | undefined) ?? existing.presentacion ?? null,
      via: (medUpdate.via as string | null | undefined) ?? existing.via,
      area: existing.area,
      ubicacion: (medUpdate.ubicacion as string | null | undefined) ?? existing.ubicacion,
      unidadesPorCaja: Number((medUpdate.unidadesPorCaja as number | undefined) ?? existing.unidadesPorCaja),
      activo: (medUpdate.activo as boolean | undefined) ?? existing.activo,
      comprable: (medUpdate.comprable as boolean | undefined) ?? existing.comprable,
      mse: isMSE(cn),
      tipoMse: (() => {
        if (!('tipoMse' in medUpdate)) return existing.tipoMse;
        const raw = medUpdate.tipoMse as string | null | undefined;
        if (raw == null) return null;
        const trimmed = raw.trim();
        return trimmed || null;
      })(),
      precioUnidad: existing.precioUnidad,
      precioCaja: existing.precioCaja,
    });
  }

  if (clearStockObjetivo && isAlmacenArea(existing.area)) {
    await deleteStockObjetivo(cn);
  } else if (Object.keys(objUpdate).length > 0) {
    const current = await getStockObjetivoByCn(cn);
    const roundStock = (value: number) =>
      existing.area === 'nutricion' ? roundCajas(value) : Math.round(value);
    const roundStockNullable = (value: number | null) =>
      value == null ? null : roundStock(value);

    await upsertStockObjetivo(
      cn,
      roundStock(Number((objUpdate.stockMinimo as number | undefined) ?? current?.stockMinimo ?? 0)),
      roundStock(Number((objUpdate.puntoPedido as number | undefined) ?? current?.puntoPedido ?? 0)),
      roundStockNullable(
        (objUpdate.stockMaximo as number | null | undefined) ?? current?.stockMaximo ?? null
      )
    );
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
  const existing = await getMedicamentoByCn(cn);

  if (!existing) {
    return NextResponse.json({ error: 'Medicamento no encontrado.' }, { status: 404 });
  }
  if (existing.area !== session.area) {
    return NextResponse.json({ error: 'No autorizado para esta area.' }, { status: 403 });
  }

  await deleteMedicamentoByCn(cn);
  return NextResponse.json({ ok: true });
}
