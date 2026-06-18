import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/api-auth';
import {
  loadPedidosConRespuestas,
  type PedidoPendienteRow,
  type PedidoEstadoFiltro,
} from '@/lib/pedidos-pendientes';
import { listMedicamentosByArea } from '@/lib/catalogo-neon';

export const runtime = 'nodejs';

function parseEstado(value: string | null): PedidoEstadoFiltro {
  if (value === 'pendientes' || value === 'recibidos' || value === 'anulados' || value === 'todos') {
    return value;
  }
  return 'todos';
}

function parseLimit(value: string | null): number {
  if (!value) return 300;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 300;
  return Math.min(Math.trunc(num), 1000);
}

function toCn6(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length > 6) return digits.slice(-6);
  return digits.padStart(6, '0');
}

function parseSearch(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export async function GET(req: NextRequest) {
  const session = requireApiSession(req);
  if (!session.ok) return session.response;

  try {
    const estado = parseEstado(req.nextUrl.searchParams.get('estado'));
    const soloReclamados = req.nextUrl.searchParams.get('reclamados') === 'true';
    const limit = parseLimit(req.nextUrl.searchParams.get('limit'));
    const search = parseSearch(req.nextUrl.searchParams.get('search'));

    const [catalogo, pedidos] = await Promise.all([
      listMedicamentosByArea(session.area),
      loadPedidosConRespuestas({ estado, soloReclamados, limit }),
    ]);

    const medsByCn = new Map<
      string,
      {
        cn: string;
        nombre: string;
        principioActivo: string;
      }
    >();
    for (const med of catalogo) {
      const cn6 = toCn6(med.cn);
      if (!cn6) continue;
      medsByCn.set(cn6, {
        cn: cn6,
        nombre: med.nombre,
        principioActivo: med.principioActivo ?? '',
      });
    }
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
    const groupsMap = new Map<
      string,
      {
        cn: string;
        nombre: string;
        principioActivo: string;
        pendientes: number;
        recibidos: number;
        anulados: number;
        reclamados: number;
        detallePendientes: PedidoPendienteRow[];
        detalleRecibidos: PedidoPendienteRow[];
      }
    >();

    for (const pedido of pedidos) {
      const cnPedido = toCn6(pedido.cnRaw);
      if (!cnPedido) continue;
      const med = medsByCn.get(cnPedido);
      if (!med) continue;

      if (search) {
        const hayMatch =
          med.cn.toLowerCase().includes(search) ||
          med.principioActivo.toLowerCase().includes(search) ||
          med.nombre.toLowerCase().includes(search);
        if (!hayMatch) continue;
      }

      const groupKey = med.cn;
      let group = groupsMap.get(groupKey);
      if (!group) {
        group = {
          cn: med.cn,
          nombre: med.nombre,
          principioActivo: med.principioActivo,
          pendientes: 0,
          recibidos: 0,
          anulados: 0,
          reclamados: 0,
          detallePendientes: [],
          detalleRecibidos: [],
        };
        groupsMap.set(groupKey, group);
      }

      if (pedido.anulado) group.anulados += 1;
      else if (pedido.recibido) group.recibidos += 1;
      else group.pendientes += 1;
      if (pedido.reclamado) group.reclamados += 1;

      const fecha = new Date(pedido.fechaDocumento);
      const enVentana = !Number.isNaN(fecha.getTime()) && fecha >= twoMonthsAgo;
      if (!enVentana) continue;
      if (pedido.anulado) continue;
      if (pedido.recibido) group.detalleRecibidos.push(pedido);
      else group.detallePendientes.push(pedido);
    }

    const grupos = [...groupsMap.values()]
      .sort((a, b) =>
        (a.principioActivo || a.nombre).localeCompare(b.principioActivo || b.nombre, 'es', { sensitivity: 'base' })
      )
      .map((g) => ({
        ...g,
        detallePendientes: g.detallePendientes.slice(0, 40),
        detalleRecibidos: g.detalleRecibidos.slice(0, 40),
      }));

    const resumen = grupos.reduce(
      (acc, g) => {
        acc.totalOrders += g.pendientes + g.recibidos + g.anulados;
        acc.pendientes += g.pendientes;
        acc.recibidos += g.recibidos;
        acc.anulados += g.anulados;
        acc.reclamados += g.reclamados;
        return acc;
      },
      { totalOrders: 0, pendientes: 0, recibidos: 0, anulados: 0, reclamados: 0 }
    );

    return NextResponse.json({
      fuente: 'PedidosPendientes (solo lectura)',
      filtro: { estado, soloReclamados, limit, search },
      area: session.area,
      resumen,
      grupos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado';
    return NextResponse.json(
      { error: 'No se pudo consultar PedidosPendientes.', detail: message },
      { status: 500 }
    );
  }
}
