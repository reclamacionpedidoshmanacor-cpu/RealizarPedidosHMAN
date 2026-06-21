import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getAlertasCompra } from '@/lib/consumo-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const alertas = await getAlertasCompra(session.area);
    return NextResponse.json({ alertas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
