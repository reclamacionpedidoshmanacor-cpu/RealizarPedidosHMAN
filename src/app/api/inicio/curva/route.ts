import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getCurvaMedicamento } from '@/lib/consumo-neon';
import { loadPedidosConRespuestas } from '@/lib/pedidos-pendientes';

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
    // Consumo últimos 3 meses (relativo al dato más reciente del área)
    const consumo = await getCurvaMedicamento(cn, session.area);

    // Rango de fechas del consumo para filtrar pedidos en el mismo período
    const fechaMinConsumo = consumo.length > 0
      ? new Date(consumo[0].anio, consumo[0].mes - 1, 1)
      : null;

    // Pedidos recibidos del sistema externo agrupados por mes
    let pedidosMes: { anio: number; mes: number; label: string; cantidad: number }[] = [];
    try {
      const cn6 = toCn6(cn);
      const pedidos = await loadPedidosConRespuestas({
        estado: 'recibidos',
        soloReclamados: false,
        limit: 5000,
      });

      const map = new Map<string, { anio: number; mes: number; cantidad: number }>();
      for (const p of pedidos) {
        // Comparar CN6
        const pCn6 = p.cnRaw
          ? p.cnRaw.replace(/\D/g, '').padStart(6, '0').slice(-6)
          : null;
        if (pCn6 !== cn6) continue;
        if (!p.fechaDocumento) continue;

        const d = new Date(p.fechaDocumento);
        if (isNaN(d.getTime())) continue;

        // Solo pedidos dentro del período del consumo
        if (fechaMinConsumo && d < fechaMinConsumo) continue;

        const anio = d.getFullYear();
        const mes  = d.getMonth() + 1;
        const key  = `${anio}-${mes}`;
        const prev = map.get(key) ?? { anio, mes, cantidad: 0 };
        const qty  = parseFloat(p.cantidadPedido ?? '0') || 0;
        map.set(key, { ...prev, cantidad: prev.cantidad + qty });
      }

      pedidosMes = Array.from(map.values())
        .sort((a, b) => a.anio !== b.anio ? a.anio - b.anio : a.mes - b.mes)
        .map(r => ({
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
