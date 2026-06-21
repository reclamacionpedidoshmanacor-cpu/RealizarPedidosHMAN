import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { getAlertasCompra } from '@/lib/consumo-neon';
import { loadRecepcionesSemanalPorCns } from '@/lib/pedidos-pendientes';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const alertas = await getAlertasCompra(session.area);

    if (alertas.length > 0) {
      const cns = alertas.map(a => a.cn);
      const recepcionesPorCn = await loadRecepcionesSemanalPorCns(cns, 112);

      for (const alerta of alertas) {
        const cnRecepciones = recepcionesPorCn[alerta.cn] ?? [];
        for (const entry of alerta.semanasSeries) {
          const match = cnRecepciones.find(
            r => r.semana === entry.semana && r.anio === entry.anio
          );
          entry.recepciones = match?.cantidad ?? 0;
        }
      }
    }

    return NextResponse.json({ alertas });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
