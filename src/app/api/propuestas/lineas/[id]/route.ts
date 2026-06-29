import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { actualizarLineaPropuesta, getLineaConPropuesta } from '@/lib/stock-propuesta-neon';
import { roundCajas } from '@/lib/utils';

export const runtime = 'nodejs';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const { id } = await params;
    const lineaId = Number(id);
    if (!Number.isFinite(lineaId)) {
      return NextResponse.json({ error: 'ID de linea no valido.' }, { status: 400 });
    }

    const body = await req.json();
    const cajasRaw = Number(body.cajasValidadas);
    const cajasValidadas =
      session.area === 'nutricion' ? roundCajas(cajasRaw) : Math.round(cajasRaw);
    const motivoAjuste = body.motivoAjuste ? String(body.motivoAjuste) : null;
    const motivoAjusteOtro = body.motivoAjusteOtro ? String(body.motivoAjusteOtro).trim() : null;
    const proveedorLocal =
      body.proveedorLocal !== undefined ? Boolean(body.proveedorLocal) : undefined;

    if (!Number.isFinite(cajasValidadas) || cajasValidadas < 0) {
      return NextResponse.json({ error: 'Cantidad validada no valida.' }, { status: 400 });
    }

    const linea = await getLineaConPropuesta(lineaId);
    if (!linea) return NextResponse.json({ error: 'Linea no encontrada.' }, { status: 404 });
    if (linea.areaPropuesta !== session.area) return NextResponse.json({ error: 'No autorizado.' }, { status: 403 });
    if (linea.estadoPropuesta !== 'borrador') {
      return NextResponse.json({ error: 'La propuesta ya no es editable.' }, { status: 409 });
    }

    const ajustado = cajasValidadas !== linea.cajasPropuestas;
    if (ajustado && !motivoAjuste) {
      return NextResponse.json({ error: 'Debes indicar motivo para un ajuste manual.' }, { status: 400 });
    }
    if (motivoAjuste === 'Otro' && !motivoAjusteOtro) {
      return NextResponse.json({ error: 'Debes escribir el motivo personalizado.' }, { status: 400 });
    }

    await actualizarLineaPropuesta(
      lineaId,
      linea.propuestaId,
      linea.areaPropuesta,
      cajasValidadas,
      Math.round(cajasValidadas * linea.unidadesPorCaja),
      ajustado ? motivoAjuste : null,
      ajustado && motivoAjuste === 'Otro' ? motivoAjusteOtro : null,
      ajustado,
      proveedorLocal,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
