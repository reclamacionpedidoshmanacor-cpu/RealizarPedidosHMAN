import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getCurvaMedicamento } from '@/lib/consumo-neon';
import { loadPedidosRecibidosPorMesByCn } from '@/lib/pedidos-pendientes';

export const runtime = 'nodejs';

/** Últimos 6 dígitos numéricos de un CN para comparar con PedidosPendientes */
function toCn6(cn: string): string {
  const digits = cn.replace(/\D/g, '');
  if (digits.length > 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  const { searchParams } = new URL(req.url);
  const cn = searchParams.get('cn');
  if (!cn) return NextResponse.json({ error: 'cn requerido.' }, { status: 400 });

  try {
    // Consumo: últimos 6 meses naturales (relativo a hoy)
    const consumo = await getCurvaMedicamento(cn, session.area);

    // Fecha inicio de la ventana visible (6 meses naturales)
    const fechaDesde = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);

    // Pedidos no anulados (recibidos + pendientes): query directa por CN en PedidosPendientes
    let pedidosMes: { anio: number; mes: number; label: string; cantidad: number }[] = [];
    try {
      const cn6 = toCn6(cn);
      const rows = await loadPedidosRecibidosPorMesByCn(cn6, fechaDesde);
      pedidosMes = rows.map(r => ({
        anio: r.anio, mes: r.mes,
        label: `${MESES[r.mes - 1]} ${r.anio}`,
        cantidad: r.cantidad,
      }));
    } catch {
      // Sin conexión con PedidosPendientes — devolvemos solo consumo
    }

    return NextResponse.json({ consumo, pedidos: pedidosMes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
