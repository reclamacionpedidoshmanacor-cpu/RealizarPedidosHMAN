import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getGrupoIntercambio } from '@/lib/cn-equivalencia-neon';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;
  const cn = req.nextUrl.searchParams.get('cn')?.trim();
  if (!cn) return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
  try {
    const grupo = await getGrupoIntercambio(cn);
    return NextResponse.json({ grupo });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo cargar el intercambio.' },
      { status: 500 },
    );
  }
}
