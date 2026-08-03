import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Endpoint de keep-alive: ejecuta una consulta trivial para mantener
 * el compute de Neon activo y evitar el cold start (~20s) en la primera
 * petición real del día.
 * Llamado periódicamente por un cron externo (cron-job.org cada 4 minutos).
 */
export async function GET() {
  try {
    const url = process.env.REALIZAR_PEDIDOS_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!url) return NextResponse.json({ ok: false, error: 'No DB URL' }, { status: 500 });

    const sql = neon(url);
    await sql`SELECT 1`;

    return NextResponse.json({ ok: true, ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
