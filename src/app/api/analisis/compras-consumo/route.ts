import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getComprasConsumoDatos } from '@/lib/analisis-neon';

export const runtime = 'nodejs';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CNS = 30;

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  if (session.area !== 'oncologia') {
    return NextResponse.json(
      { error: 'La comparación de compras y consumo sólo está disponible para el área de Oncología.' },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const desde = searchParams.get('desde') ?? '';
  const hasta = searchParams.get('hasta') ?? '';
  if (!ISO_DATE_RE.test(desde) || !ISO_DATE_RE.test(hasta) || desde > hasta) {
    return NextResponse.json({ error: 'Período no válido.' }, { status: 400 });
  }
  const cns = (searchParams.get('cns') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, MAX_CNS);

  try {
    const datos = await getComprasConsumoDatos(session.area, desde, hasta, cns);
    return NextResponse.json(datos);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
