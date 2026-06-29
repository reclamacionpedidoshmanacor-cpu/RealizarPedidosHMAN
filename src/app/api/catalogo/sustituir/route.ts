import { NextRequest, NextResponse } from 'next/server';
import { isAlmacenArea } from '@/lib/almacen';
import { requireApiSession } from '@/lib/api-auth';
import { sustituirCnEnCatalogoAlmacen } from '@/lib/sustitucion-cn-almacen';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  if (!isAlmacenArea(session.area)) {
    return NextResponse.json({ error: 'Sustitución de catálogo solo disponible en Almacén.' }, { status: 403 });
  }

  const body = (await req.json()) as {
    cnViejo?: unknown;
    cnNuevo?: unknown;
    ubicacion?: unknown;
    nombre?: unknown;
    principioActivo?: unknown;
    presentacion?: unknown;
    unidadesPorCaja?: unknown;
  };

  const cnViejo = String(body.cnViejo ?? '').trim();
  const cnNuevoRaw = String(body.cnNuevo ?? '').trim();
  const ubicacion = String(body.ubicacion ?? '').trim();

  if (!cnViejo || !cnNuevoRaw || !ubicacion) {
    return NextResponse.json({ error: 'CN anterior, CN nuevo y ubicación son obligatorios.' }, { status: 400 });
  }

  const tieneDatosEditados =
    body.nombre != null ||
    body.principioActivo != null ||
    body.presentacion != null ||
    body.unidadesPorCaja != null;

  const outcome = await sustituirCnEnCatalogoAlmacen({
    area: session.area,
    cnViejo,
    cnNuevoRaw,
    ubicacion,
    datosNuevo: tieneDatosEditados
      ? {
          nombre: String(body.nombre ?? '').trim(),
          principioActivo: body.principioActivo != null ? String(body.principioActivo) : null,
          presentacion: body.presentacion != null ? String(body.presentacion) : null,
          unidadesPorCaja: body.unidadesPorCaja != null ? Number(body.unidadesPorCaja) : undefined,
        }
      : undefined,
  });

  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.err.error }, { status: outcome.err.status });
  }

  const { result } = outcome;

  return NextResponse.json({
    ok: true,
    cnViejo: result.cnViejo,
    cnNuevo: result.cnNuevo,
    medicamento: {
      cn: result.cnNuevo,
      nombre: result.nombre,
      principioActivo: result.principioActivo,
      presentacion: result.presentacion,
      unidadesPorCaja: result.unidadesPorCaja,
      ubicacion: result.ubicacion,
      activo: true,
      stockMinimo: result.stockMinimo,
      puntoPedido: result.puntoPedido,
      stockMaximo: result.stockMaximo,
      consumoMedio: result.consumoMedio,
    },
  });
}
