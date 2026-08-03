import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type DatabasePing = {
  ok: boolean;
  ms: number;
};

async function pingDatabase(connectionString: string | undefined): Promise<DatabasePing> {
  if (!connectionString) {
    throw new Error('Cadena de conexión no configurada.');
  }

  const startedAt = performance.now();
  const sql = neon(connectionString);
  await sql`SELECT 1`;

  return {
    ok: true,
    ms: Math.round(performance.now() - startedAt),
  };
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado.' },
      { status: 503 },
    );
  }

  if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const [realizarPedidos, pedidosPendientes] = await Promise.allSettled([
    pingDatabase(process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL),
    pingDatabase(process.env.PEDIDOS_PENDIENTES_DATABASE_URL),
  ]);

  const realizarPedidosOk = realizarPedidos.status === 'fulfilled';
  const pedidosPendientesOk = pedidosPendientes.status === 'fulfilled';
  const ok = realizarPedidosOk && pedidosPendientesOk;

  if (!realizarPedidosOk) {
    console.error('[cron/keep-alive] RealizarPedidos:', realizarPedidos.reason);
  }
  if (!pedidosPendientesOk) {
    console.error('[cron/keep-alive] PedidosPendientes:', pedidosPendientes.reason);
  }

  return NextResponse.json(
    {
      ok,
      realizarPedidos: realizarPedidosOk
        ? realizarPedidos.value
        : { ok: false, ms: 0 },
      pedidosPendientes: pedidosPendientesOk
        ? pedidosPendientes.value
        : { ok: false, ms: 0 },
      timestamp: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
