import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getMedicamentoByCn, updateMedicamento } from '@/lib/catalogo-neon';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const body = (await req.json()) as { cn?: unknown; accion?: unknown };
    const cn = String(body.cn ?? '').trim();
    const accion = String(body.accion ?? '').trim();

    if (!cn) {
      return NextResponse.json({ error: 'CN requerido.' }, { status: 400 });
    }
    if (accion !== 'mover-a-area-actual') {
      return NextResponse.json({ error: 'Acción no válida.' }, { status: 400 });
    }

    const existing = await getMedicamentoByCn(cn);
    if (!existing) {
      return NextResponse.json({ error: 'Medicamento no encontrado.' }, { status: 404 });
    }
    if (existing.area === session.area) {
      return NextResponse.json({ ok: true, moved: false, message: 'El CN ya está en el área activa.' });
    }

    await updateMedicamento({
      ...existing,
      area: session.area,
    });

    return NextResponse.json({
      ok: true,
      moved: true,
      cn,
      areaAnterior: existing.area,
      areaNueva: session.area,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
