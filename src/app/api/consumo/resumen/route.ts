import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getResumenConsumo, getTemporalGlobal } from '@/lib/consumo-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { searchParams } = new URL(req.url);
  const importacionId = Number(searchParams.get('importacionId'));
  const fechaDesde = searchParams.get('fechaDesde');
  const fechaHasta = searchParams.get('fechaHasta');
  if (!Number.isFinite(importacionId) || importacionId <= 0) {
    return NextResponse.json({ error: 'importacionId requerido.' }, { status: 400 });
  }

  try {
    const [medicamentos, temporal] = await Promise.all([
      getResumenConsumo(importacionId, fechaDesde, fechaHasta),
      getTemporalGlobal(importacionId, fechaDesde, fechaHasta),
    ]);
    return NextResponse.json({ medicamentos, temporal });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
