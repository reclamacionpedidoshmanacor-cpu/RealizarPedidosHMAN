import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  actualizarNotasInventario,
  eliminarInventario,
  getInventarioDetalle,
} from '@/lib/inventario-neon';

export const runtime = 'nodejs';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'ID no válido.' }, { status: 400 });
    }

    const detalle = await getInventarioDetalle(id, session.area);
    if (!detalle) {
      return NextResponse.json({ error: 'Inventario no encontrado.' }, { status: 404 });
    }

    const { cabecera, lineas } = detalle;
    return NextResponse.json({
      inventarioId: cabecera.id,
      manualRecuento: {
        id: cabecera.manualRecuentoId,
        fechaRecuento: cabecera.manualFechaRecuento ?? '',
        estado: cabecera.manualEstado ?? '',
        totalLineas: cabecera.totalLineas,
        ubicaciones: cabecera.ubicaciones,
      },
      sapFileName: cabecera.sapFicheroNombre,
      guardadoEn: cabecera.guardadoEn,
      warnings: cabecera.warnings,
      notas: cabecera.notas,
      notasActualizadasEn: cabecera.notasActualizadasEn,
      resumen: cabecera.resumen,
      rows: lineas.map((l) => ({
        cn: l.cn,
        principioActivo: l.principioActivo,
        medicamento: l.medicamento,
        unidadesPorCaja: l.unidadesPorCaja,
        precioCaja: l.precioCaja,
        precioUnidad: l.precioUnidad,
        manualUnidades: l.manualUnidades,
        sapUnidades: l.sapUnidades,
        ajusteUnidades: l.ajusteUnidades,
        manualImporte: l.manualImporte,
        sapImporte: l.sapImporte,
        ajusteImporte: l.ajusteImporte,
        materialSap: l.materialSap,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'ID no válido.' }, { status: 400 });
    }

    const body = (await req.json()) as { notas?: unknown };
    if (body.notas != null && typeof body.notas !== 'string') {
      return NextResponse.json({ error: 'Las notas no son válidas.' }, { status: 400 });
    }

    const notas = typeof body.notas === 'string' ? (body.notas.trim() || null) : null;
    if (notas && notas.length > 2000) {
      return NextResponse.json({ error: 'Las notas no pueden superar 2.000 caracteres.' }, { status: 400 });
    }

    const updated = await actualizarNotasInventario(id, session.area, notas);
    if (!updated) {
      return NextResponse.json({ error: 'Inventario no encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, ...updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id: idRaw } = await params;
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'ID no válido.' }, { status: 400 });
    }

    const deleted = await eliminarInventario(id, session.area);
    if (!deleted) {
      return NextResponse.json({ error: 'Inventario no encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
