import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import { agruparAlertasPorPrincipioActivo, getAlertasCompra } from '@/lib/consumo-neon';
import { cnClavePedidos, loadRecepcionesSemanalPorCns } from '@/lib/pedidos-pendientes';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  // Las alertas de consumo/cobertura son exclusivas de Oncología.
  // Las alertas de proveedor permanecen en sus flujos independientes de
  // Catálogo y Propuestas para todas las áreas.
  if (session.area !== 'oncologia') {
    return NextResponse.json({ grupos: [] });
  }

  try {
    const alertas = await getAlertasCompra(session.area);

    if (alertas.length > 0) {
      try {
        const cns = alertas.map(a => a.cn);
        const recepcionesPorCn = await loadRecepcionesSemanalPorCns(cns, 56);

        for (const alerta of alertas) {
          const cn6 = cnClavePedidos(alerta.cn);
          const cnRecepciones = cn6 ? (recepcionesPorCn[cn6] ?? []) : [];
          for (const entry of alerta.semanasSeries) {
            const match = cnRecepciones.find(
              r => r.semana === entry.semana && r.anio === entry.anio
            );
            entry.recepciones = match?.cantidad ?? 0;
          }
        }
      } catch (err) {
        // La indisponibilidad de PedidosPendientes no debe ocultar las alertas
        // de consumo/cobertura calculadas correctamente en la base principal.
        console.warn(
          '[inicio/alertas-compra] No se pudieron cargar recepciones:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    return NextResponse.json({ grupos: agruparAlertasPorPrincipioActivo(alertas) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error inesperado';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
