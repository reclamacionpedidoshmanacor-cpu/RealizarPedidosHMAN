import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { listImportacionesConsumo, ensureConsumoTables } from '@/lib/consumo-neon';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    await ensureConsumoTables();
    const importaciones = await listImportacionesConsumo(session.area);
    return NextResponse.json({ importaciones });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
