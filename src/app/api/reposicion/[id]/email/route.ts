import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getPedidoConLineas, ensureTablesReposicion } from '@/lib/reposicion-neon';
import { sendReposicionEmail } from '@/lib/reposicion-email';

export const runtime = 'nodejs';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    await ensureTablesReposicion();
    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isFinite(pedidoId)) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const pedido = await getPedidoConLineas(pedidoId);
    if (!pedido) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (pedido.cabecera.area !== session.area) {
      return NextResponse.json({ error: 'No autorizado para este pedido.' }, { status: 403 });
    }

    const result = await sendReposicionEmail(pedidoId);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error enviando email';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
