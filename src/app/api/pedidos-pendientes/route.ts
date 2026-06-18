import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  loadPedidosConRespuestas,
  loadPedidosResumen,
  type PedidoEstadoFiltro,
} from '@/lib/pedidos-pendientes';

export const runtime = 'nodejs';

function parseEstado(value: string | null): PedidoEstadoFiltro {
  if (value === 'pendientes' || value === 'recibidos' || value === 'anulados' || value === 'todos') {
    return value;
  }
  return 'todos';
}

function parseLimit(value: string | null): number {
  if (!value) return 100;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 100;
  return Math.min(Math.trunc(num), 500);
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const estado = parseEstado(req.nextUrl.searchParams.get('estado'));
    const soloReclamados = req.nextUrl.searchParams.get('reclamados') === 'true';
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'));

    const [resumen, pedidos] = await Promise.all([
      loadPedidosResumen(),
      loadPedidosConRespuestas({ estado, soloReclamados, limit }),
    ]);

    return NextResponse.json({
      fuente: 'PedidosPendientes (solo lectura)',
      filtro: { estado, soloReclamados, limit },
      resumen,
      pedidos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return NextResponse.json(
      { error: 'No se pudo consultar PedidosPendientes.', detail: message },
      { status: 500 }
    );
  }
}
