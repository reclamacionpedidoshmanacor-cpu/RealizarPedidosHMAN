import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getInventarioDetalle } from '@/lib/inventario-neon';

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
      },
      sapFileName: cabecera.sapFicheroNombre,
      guardadoEn: cabecera.guardadoEn,
      warnings: cabecera.warnings,
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
