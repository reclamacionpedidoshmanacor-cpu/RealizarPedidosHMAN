import { NextRequest, NextResponse } from 'next/server';
import { isValidArea } from '@/lib/areas';
import { requireApiSession } from '@/lib/api-auth';
import {
  eliminarPedidoReposicion,
  getPedidoConLineas,
  ensureTablesReposicion,
} from '@/lib/reposicion-neon';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await ensureTablesReposicion();
    const area = req.cookies.get('area_session')?.value;
    if (!isValidArea(area)) {
      return NextResponse.json({ error: 'Area no seleccionada o no valida.' }, { status: 400 });
    }
    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isFinite(pedidoId)) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }
    const result = await getPedidoConLineas(pedidoId);
    if (!result) {
      return NextResponse.json({ error: 'Pedido no encontrado.' }, { status: 404 });
    }
    if (result.cabecera.area !== area) {
      return NextResponse.json({ error: 'No autorizado para este pedido.' }, { status: 403 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = requireApiSession(req);
    if (!session.ok) return session.response;
    await ensureTablesReposicion();

    const { id } = await params;
    const pedidoId = Number(id);
    if (!Number.isInteger(pedidoId) || pedidoId <= 0) {
      return NextResponse.json({ error: 'ID inválido.' }, { status: 400 });
    }

    const eliminado = await eliminarPedidoReposicion(pedidoId, session.area);
    if (!eliminado) {
      return NextResponse.json({ error: 'Pedido no encontrado en el área activa.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, eliminado });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
