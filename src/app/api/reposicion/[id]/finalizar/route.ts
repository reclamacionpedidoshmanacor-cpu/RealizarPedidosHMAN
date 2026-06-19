import { NextRequest, NextResponse } from 'next/server';
import { finalizarPedido, getPedidoConLineas, ensureTablesReposicion } from '@/lib/reposicion-neon';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureTablesReposicion();
    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isFinite(pedidoId)) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const result = await getPedidoConLineas(pedidoId);
    if (!result) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (result.cabecera.estado !== 'borrador') {
      return NextResponse.json({ error: 'El pedido ya está finalizado.' }, { status: 400 });
    }
    if (result.cabecera.totalLineas === 0) {
      return NextResponse.json({ error: 'No se puede finalizar un pedido sin líneas.' }, { status: 400 });
    }

    const cabecera = await finalizarPedido(pedidoId);
    return NextResponse.json({ cabecera });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
