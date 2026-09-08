import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getPedidoConLineas, ensureTablesReposicion } from '@/lib/reposicion-neon';
import { sendReposicionEmail } from '@/lib/reposicion-email';

export const runtime = 'nodejs';

/* ── POST /api/reposicion/email ── envía varios albaranes en un solo correo ── */
export async function POST(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    await ensureTablesReposicion();

    const body = await req.json().catch(() => ({}));
    const rawIds = (body as { ids?: unknown }).ids;
    if (!Array.isArray(rawIds) || rawIds.length === 0) {
      return NextResponse.json({ error: 'Selecciona al menos un pedido.' }, { status: 400 });
    }

    const ids = [...new Set(rawIds.map(Number))];
    if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      return NextResponse.json({ error: 'Hay identificadores de pedido no válidos.' }, { status: 400 });
    }

    for (const id of ids) {
      const pedido = await getPedidoConLineas(id);
      if (!pedido) {
        return NextResponse.json({ error: `Pedido #${id} no encontrado.` }, { status: 404 });
      }
      if (pedido.cabecera.area !== session.area) {
        return NextResponse.json(
          { error: `El pedido #${id} no pertenece al área activa.` },
          { status: 403 },
        );
      }
    }

    const result = await sendReposicionEmail(ids);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true, enviados: ids.length, ids });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error enviando email';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
